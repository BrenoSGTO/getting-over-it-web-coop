import Peer, { DataConnection } from 'peerjs';
import * as planck from 'planck-js';

export interface RemotePlayerState {
  peerId: string;
  name: string;
  color: string;
  // Smoothly interpolated positions rendered at 60fps
  potX: number;
  potY: number;
  potAngle: number;
  potVX: number;
  potVY: number;
  tipX: number;
  tipY: number;
  tipAngle: number;
  // Network snapshot targets & velocities for dead-reckoning interpolation
  netPotX: number;
  netPotY: number;
  netPotVX: number;
  netPotVY: number;
  netTipX: number;
  netTipY: number;
  netTipVX: number;
  netTipVY: number;
  lastPacketTime: number;
  lastSeen: number;
  // Kinematic physics bodies in the local world so players can collide/push each other!
  potBody?: planck.Body;
  tipBody?: planck.Body;
}

/**
 * Ultra-compact network wire format to minimize bandwidth (~35 bytes per state packet!):
 * - State tuple: ['s', peerId, potX*100, potY*100, potVX*20, potVY*20, tipX*100, tipY*100]
 * - Meta tuple:  ['m', peerId, name, color]
 */
export type CompactPacket =
  | ['s', string, number, number, number, number, number, number]
  | ['m', string, string, string];

/**
 * Lightweight MQTT v3.1.1 over WSS Relay Client
 * Guarantees 100% connectivity on 3G / 4G / 5G mobile networks (Symmetric CGNAT)
 */
class MqttWssRelay {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  public isReady = false;
  private brokerIndex = 0;
  private destroyed = false;

  private readonly BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
  ];

  constructor(
    private clientId: string,
    private topic: string,
    private onMessage: (packet: CompactPacket) => void,
    private onConnected: () => void
  ) {
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;
    const url = this.BROKERS[this.brokerIndex % this.BROKERS.length];

    try {
      this.ws = new WebSocket(url, 'mqtt');
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        if (this.destroyed || !this.ws) return;
        this.sendConnectPacket();
      };

      this.ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        const buf = new Uint8Array(ev.data);
        if (buf.length < 2) return;

        const packetType = buf[0] & 0xf0;
        if (packetType === 0x20) {
          // CONNACK
          this.isReady = true;
          this.sendSubscribePacket(this.topic);
          this.onConnected();
          if (this.pingTimer) clearInterval(this.pingTimer);
          this.pingTimer = window.setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(new Uint8Array([0xc0, 0x00]));
            }
          }, 25000);
        } else if (packetType === 0x30) {
          // PUBLISH
          this.parsePublishPacket(buf);
        }
      };

      this.ws.onclose = () => {
        this.isReady = false;
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        if (!this.destroyed) {
          this.brokerIndex++;
          setTimeout(() => this.connect(), 1500);
        }
      };
    } catch {
      this.brokerIndex++;
      setTimeout(() => this.connect(), 2000);
    }
  }

  private encodeLength(len: number): number[] {
    const out: number[] = [];
    do {
      let digit = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) digit |= 0x80;
      out.push(digit);
    } while (len > 0);
    return out;
  }

  private encodeString(str: string): Uint8Array {
    const bytes = new TextEncoder().encode(str);
    const res = new Uint8Array(2 + bytes.length);
    res[0] = (bytes.length >> 8) & 0xff;
    res[1] = bytes.length & 0xff;
    res.set(bytes, 2);
    return res;
  }

  private sendConnectPacket() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const varHeader = new Uint8Array([
      0x00, 0x04, 0x4d, 0x51, 0x54, 0x54,
      0x04,
      0x02,
      0x00, 0x3c,
    ]);
    const payload = this.encodeString(`goi_${this.clientId}`);
    const remLen = varHeader.length + payload.length;
    const remLenBytes = this.encodeLength(remLen);

    const pkt = new Uint8Array(1 + remLenBytes.length + remLen);
    pkt[0] = 0x10;
    pkt.set(remLenBytes, 1);
    pkt.set(varHeader, 1 + remLenBytes.length);
    pkt.set(payload, 1 + remLenBytes.length + varHeader.length);
    this.ws.send(pkt);
  }

  private sendSubscribePacket(topic: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pktId = new Uint8Array([0x00, 0x01]);
    const topicBytes = this.encodeString(topic);
    const qos = new Uint8Array([0x00]);
    const remLen = pktId.length + topicBytes.length + qos.length;
    const remLenBytes = this.encodeLength(remLen);

    const pkt = new Uint8Array(1 + remLenBytes.length + remLen);
    pkt[0] = 0x82;
    pkt.set(remLenBytes, 1);
    pkt.set(pktId, 1 + remLenBytes.length);
    pkt.set(topicBytes, 1 + remLenBytes.length + pktId.length);
    pkt.set(qos, 1 + remLenBytes.length + pktId.length + topicBytes.length);
    this.ws.send(pkt);
  }

  public publish(packet: CompactPacket) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) return;
    // Drop outgoing state packet if WebSocket send buffer is backed up on slow 3G
    if (this.ws.bufferedAmount > 2048 && packet[0] === 's') return;

    const topicBytes = this.encodeString(this.topic);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(packet));
    const remLen = topicBytes.length + payloadBytes.length;
    const remLenBytes = this.encodeLength(remLen);

    const pkt = new Uint8Array(1 + remLenBytes.length + remLen);
    pkt[0] = 0x30;
    pkt.set(remLenBytes, 1);
    pkt.set(topicBytes, 1 + remLenBytes.length);
    pkt.set(payloadBytes, 1 + remLenBytes.length + topicBytes.length);
    this.ws.send(pkt);
  }

  private parsePublishPacket(buf: Uint8Array) {
    let offset = 1;
    let multiplier = 1;
    let remLen = 0;
    while (offset < buf.length) {
      const encodedByte = buf[offset++];
      remLen += (encodedByte & 127) * multiplier;
      if ((encodedByte & 128) === 0) break;
      multiplier *= 128;
    }
    if (offset + 2 > buf.length) return;
    const topicLen = (buf[offset] << 8) | buf[offset + 1];
    offset += 2 + topicLen;

    const qos = (buf[0] >> 1) & 0x03;
    if (qos > 0) offset += 2;

    if (offset >= buf.length) return;
    const payloadBytes = buf.subarray(offset, Math.min(buf.length, offset + remLen));
    try {
      const jsonStr = new TextDecoder().decode(payloadBytes);
      const data = JSON.parse(jsonStr) as CompactPacket;
      this.onMessage(data);
    } catch {
      // Ignore malformed payload
    }
  }

  public destroy() {
    this.destroyed = true;
    this.isReady = false;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
      } catch {
        // Ignore
      }
      this.ws = null;
    }
  }
}

export class CoopNetwork {
  private peer: Peer | null = null;
  private mqttRelay: MqttWssRelay | null = null;
  private connections: Map<string, DataConnection> = new Map();
  public remotePlayers: Map<string, RemotePlayerState> = new Map();

  public roomCode = '';
  // Short 4-char peer ID saves bandwidth in every packet
  public myPeerId = Math.random().toString(36).substring(2, 6);
  public myName = 'Macaco';
  public myColor = '#f59e0b';
  public isConnected = false;
  private isConnectingCode = '';

  // Delta-compression & rate-limiting state
  private lastSentPotX = -999;
  private lastSentPotY = -999;
  private lastSentTipX = -999;
  private lastSentTipY = -999;
  private lastStateSendTime = 0;
  private lastMetaSendTime = 0;

  private onStatusChange?: (status: string, online: boolean, roomCode: string) => void;
  private onToast?: (msg: string) => void;

  constructor(
    private world: planck.World,
    callbacks?: {
      onStatusChange?: (status: string, online: boolean, roomCode: string) => void;
      onToast?: (msg: string) => void;
    }
  ) {
    this.onStatusChange = callbacks?.onStatusChange;
    this.onToast = callbacks?.onToast;
  }

  private generateShortCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'GOI-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private getIceServers(): RTCIceServer[] {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:80?transport=tcp',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
          'turns:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ];
  }

  public hostRoom(customCode?: string): Promise<string> {
    const raw = customCode ? customCode.trim().toUpperCase() : this.generateShortCode();
    const code = raw.startsWith('GOI-') ? raw : `GOI-${raw}`;
    return this.connectToRoom(code, true);
  }

  public joinRoom(rawCode: string): Promise<void> {
    const cleanCode = rawCode.trim().toUpperCase();
    const formattedCode = cleanCode.startsWith('GOI-') ? cleanCode : `GOI-${cleanCode}`;
    return this.connectToRoom(formattedCode, false).then(() => {});
  }

  private connectToRoom(code: string, asHost: boolean): Promise<string> {
    if (this.isConnectingCode === code || (this.isConnected && this.roomCode === code)) {
      return Promise.resolve(code);
    }

    this.cleanup();
    this.isConnectingCode = code;
    this.roomCode = code;
    this.onStatusChange?.(`Conectando à sala ${code}...`, false, '');

    return new Promise((resolve) => {
      let resolved = false;
      const markOnline = () => {
        this.isConnectingCode = '';
        if (!this.isConnected) {
          this.isConnected = true;
          this.onStatusChange?.(`Sala Ativa (${code})`, true, code);
          this.onToast?.(`Sala ${code} conectada! Envie o link para seu amigo.`);
          this.sendMetadataPacket();
        }
        if (!resolved) {
          resolved = true;
          resolve(code);
        }
      };

      // 1. Primary 3G-proof WSS Relay (compact binary/tuple packets)
      const topic = `goi-skibidi-v3/${code}`;
      this.mqttRelay = new MqttWssRelay(
        this.myPeerId,
        topic,
        (packet) => this.handleIncomingPacket(packet),
        () => markOnline()
      );

      // 2. Optional P2P DataChannel (if direct WebRTC succeeds, uses P2P instead of relay)
      try {
        const hostPeerId = `getting-over-it-coop-${code}`;
        this.peer = asHost
          ? new Peer(hostPeerId, { config: { iceServers: this.getIceServers() } })
          : new Peer({ config: { iceServers: this.getIceServers() } });

        this.peer.on('open', () => {
          if (!asHost && this.peer) {
            const conn = this.peer.connect(hostPeerId, { reliable: false });
            this.setupConnection(conn, () => markOnline());
          } else {
            markOnline();
          }
        });

        this.peer.on('connection', (conn) => {
          this.setupConnection(conn);
        });

        this.peer.on('error', () => {
          // Handled seamlessly by MqttWssRelay
        });
      } catch {
        // Ignore PeerJS init errors
      }
    });
  }

  private setupConnection(conn: DataConnection, onOpenCallback?: () => void) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      onOpenCallback?.();
      this.sendMetadataPacket();
    });

    conn.on('data', (rawData) => {
      this.handleIncomingPacket(rawData as CompactPacket);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
    });
  }

  public sendMetadataPacket() {
    if (!this.isConnected) return;
    const pkt: CompactPacket = ['m', this.myPeerId, this.myName.slice(0, 14), this.myColor];
    this.sendRawPacket(pkt);
    this.lastMetaSendTime = performance.now();
  }

  private sendRawPacket(pkt: CompactPacket) {
    // Prefer direct P2P DataChannel if open; otherwise send via WSS Relay (never duplicate!)
    let sentViaP2P = false;
    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(pkt);
        sentViaP2P = true;
      }
    }
    if (!sentViaP2P && this.mqttRelay && this.mqttRelay.isReady) {
      this.mqttRelay.publish(pkt);
    }
  }

  private handleIncomingPacket(pkt: CompactPacket) {
    if (!Array.isArray(pkt) || pkt.length < 2) return;
    const type = pkt[0];
    const peerId = pkt[1];
    if (!peerId || peerId === this.myPeerId) return;

    const now = performance.now();

    if (type === 'm') {
      const [, , name, color] = pkt;
      const remote = this.remotePlayers.get(peerId);
      if (remote) {
        remote.name = name || remote.name;
        remote.color = color || remote.color;
        remote.lastSeen = now;
      }
      return;
    }

    if (type === 's') {
      const [, , qPotX, qPotY, qVX, qVY, qTipX, qTipY] = pkt;
      const potX = qPotX / 100;
      const potY = qPotY / 100;
      const potVX = qVX / 20;
      const potVY = qVY / 20;
      const tipX = qTipX / 100;
      const tipY = qTipY / 100;

      let remote = this.remotePlayers.get(peerId);
      if (!remote) {
        remote = this.createRemotePlayerBodies(peerId, potX, potY, tipX, tipY);
        this.remotePlayers.set(peerId, remote);
        this.onToast?.(`🐒 Um Macaco entrou na selva!`);
        // Reply with our metadata so the newcomer gets our name & color immediately
        this.sendMetadataPacket();
      }

      const dtNet = Math.max((now - remote.lastPacketTime) / 1000, 0.04);
      remote.netTipVX = Math.max(-25, Math.min(25, (tipX - remote.netTipX) / dtNet));
      remote.netTipVY = Math.max(-25, Math.min(25, (tipY - remote.netTipY) / dtNet));

      remote.netPotX = potX;
      remote.netPotY = potY;
      remote.netPotVX = potVX;
      remote.netPotVY = potVY;
      remote.netTipX = tipX;
      remote.netTipY = tipY;
      remote.lastPacketTime = now;
      remote.lastSeen = now;
    }
  }

  private createRemotePlayerBodies(
    peerId: string,
    potX: number,
    potY: number,
    tipX: number,
    tipY: number
  ): RemotePlayerState {
    const potBody = this.world.createBody({
      type: 'kinematic',
      position: planck.Vec2(potX, potY),
    });
    const f = potBody.createFixture(planck.Circle(planck.Vec2(0, -0.15), 0.45), {
      friction: 0.9,
      restitution: 0.1,
    });
    f.setUserData({ isTerrain: true, material: 'wood' });

    const tipBody = this.world.createBody({
      type: 'kinematic',
      position: planck.Vec2(tipX, tipY),
    });
    const tf = tipBody.createFixture(planck.Circle(0.18), {
      friction: 0.8,
    });
    tf.setUserData({ isTerrain: true, material: 'wood' });

    const now = performance.now();
    return {
      peerId,
      name: `Macaco ${peerId.slice(0, 3).toUpperCase()}`,
      color: '#38bdf8',
      potX,
      potY,
      potAngle: 0,
      potVX: 0,
      potVY: 0,
      tipX,
      tipY,
      tipAngle: 0,
      netPotX: potX,
      netPotY: potY,
      netPotVX: 0,
      netPotVY: 0,
      netTipX: tipX,
      netTipY: tipY,
      netTipVX: 0,
      netTipVY: 0,
      lastPacketTime: now,
      lastSeen: now,
      potBody,
      tipBody,
    };
  }

  private removeRemotePlayer(peerId: string) {
    const remote = this.remotePlayers.get(peerId);
    if (remote) {
      if (remote.potBody) this.world.destroyBody(remote.potBody);
      if (remote.tipBody) this.world.destroyBody(remote.tipBody);
      this.remotePlayers.delete(peerId);
      this.onToast?.(`${remote.name} saiu da sala.`);
    }
  }

  /**
   * Bandwidth-Optimized State Broadcast:
   * - Throttled to 12Hz (every ~80ms) instead of 30Hz
   * - Delta-compressed: skips sending when the player is stationary
   * - Quantized tuple format (~34 bytes instead of 190 bytes!)
   */
  public broadcastState(
    potX: number,
    potY: number,
    _potAngle: number,
    potVX: number,
    potVY: number,
    tipX: number,
    tipY: number,
    _tipAngle: number
  ) {
    if (!this.isConnected) return;

    const now = performance.now();

    // Refresh metadata every 4 seconds (tiny 28-byte packet)
    if (now - this.lastMetaSendTime > 4000) {
      this.sendMetadataPacket();
    }

    // Throttle state packets to 12Hz (80ms interval) to keep 3G buffer 100% lag-free
    if (now - this.lastStateSendTime < 80) return;

    // Delta check: if player & hammer barely moved, only send a heartbeat every 1.5s
    const movedDist =
      Math.abs(potX - this.lastSentPotX) +
      Math.abs(potY - this.lastSentPotY) +
      Math.abs(tipX - this.lastSentTipX) +
      Math.abs(tipY - this.lastSentTipY);

    if (movedDist < 0.015 && now - this.lastStateSendTime < 1500) {
      return;
    }

    this.lastSentPotX = potX;
    this.lastSentPotY = potY;
    this.lastSentTipX = tipX;
    this.lastSentTipY = tipY;
    this.lastStateSendTime = now;

    const compactState: CompactPacket = [
      's',
      this.myPeerId,
      Math.round(potX * 100),
      Math.round(potY * 100),
      Math.round(potVX * 20),
      Math.round(potVY * 20),
      Math.round(tipX * 100),
      Math.round(tipY * 100),
    ];

    this.sendRawPacket(compactState);
  }

  /**
   * 60Hz Client-Side Dead-Reckoning (Velocity Extrapolation) + Smooth Hermite Blending:
   * Predicts remote player motion between 12Hz packets so remote players move at a
   * silky-smooth 60fps even on high-latency 3G connections!
   */
  public updateRemotePlayers(
    dt: number,
    localPotBody: planck.Body,
    tetherEnabled: boolean
  ) {
    const now = performance.now();
    for (const [peerId, r] of this.remotePlayers.entries()) {
      if (now - r.lastSeen > 12000) {
        this.removeRemotePlayer(peerId);
        continue;
      }

      if (r.potBody && r.tipBody) {
        // Time elapsed since the last network packet arrived (capped at 120ms for prediction)
        const ageSec = Math.min(Math.max((now - r.lastPacketTime) / 1000, 0), 0.12);

        // Dead-reckoning predicted position using velocity at snapshot time
        const predPotX = r.netPotX + r.netPotVX * ageSec;
        const predPotY = r.netPotY + r.netPotVY * ageSec;

        const predTipX = r.netTipX + r.netTipVX * ageSec * 0.75;
        const predTipY = r.netTipY + r.netTipVY * ageSec * 0.75;

        // Exponential smoothing (frame-rate independent) toward the moving predicted target
        const potBlend = 1.0 - Math.exp(-16.0 * dt);
        const tipBlend = 1.0 - Math.exp(-22.0 * dt);

        const distErr = Math.hypot(predPotX - r.potX, predPotY - r.potY);
        if (distErr > 6.0) {
          // Teleport immediately if over 6 meters desynced
          r.potX = predPotX;
          r.potY = predPotY;
          r.tipX = predTipX;
          r.tipY = predTipY;
        } else {
          r.potX += (predPotX - r.potX) * potBlend;
          r.potY += (predPotY - r.potY) * potBlend;
          r.tipX += (predTipX - r.tipX) * tipBlend;
          r.tipY += (predTipY - r.tipY) * tipBlend;
        }

        // Smooth visual tilt and arm angle derived from interpolated positions
        const targetTilt = Math.max(-0.18, Math.min(0.18, -r.netPotVX * 0.025));
        r.potAngle += (targetTilt - r.potAngle) * 0.2;
        r.tipAngle = Math.atan2(r.tipY - (r.potY + 0.35), r.tipX - r.potX);

        // Update kinematic bodies with smooth velocity so collisions feel solid
        const curPot = r.potBody.getPosition();
        r.potBody.setLinearVelocity(
          planck.Vec2((r.potX - curPot.x) / dt, (r.potY - curPot.y) / dt)
        );
        r.potBody.setPosition(planck.Vec2(r.potX, r.potY));

        const curTip = r.tipBody.getPosition();
        r.tipBody.setLinearVelocity(
          planck.Vec2((r.tipX - curTip.x) / dt, (r.tipY - curTip.y) / dt)
        );
        r.tipBody.setPosition(planck.Vec2(r.tipX, r.tipY));

        // Optional Elastic Co-op Vine Tether
        if (tetherEnabled) {
          const myPos = localPotBody.getPosition();
          const diff = planck.Vec2.sub(planck.Vec2(r.potX, r.potY), myPos);
          const dist = diff.length();
          const maxRopeLength = 4.2;
          if (dist > maxRopeLength) {
            diff.normalize();
            const stretch = Math.min(dist - maxRopeLength, 8.0);
            const springForce = stretch * 145.0;
            localPotBody.applyForceToCenter(planck.Vec2.mul(diff, springForce), true);
          }
        }
      }
    }
  }

  public cleanup() {
    this.isConnectingCode = '';
    for (const peerId of Array.from(this.remotePlayers.keys())) {
      this.removeRemotePlayer(peerId);
    }
    this.connections.clear();
    if (this.mqttRelay) {
      this.mqttRelay.destroy();
      this.mqttRelay = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // Ignore
      }
      this.peer = null;
    }
    this.isConnected = false;
  }
}
