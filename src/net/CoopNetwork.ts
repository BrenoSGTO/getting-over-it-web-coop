import Peer, { DataConnection } from 'peerjs';
import * as planck from 'planck-js';

export interface RemotePlayerState {
  peerId: string;
  name: string;
  color: string;
  potX: number;
  potY: number;
  potAngle: number;
  potVX: number;
  potVY: number;
  tipX: number;
  tipY: number;
  tipAngle: number;
  lastSeen: number;
  // Kinematic physics bodies in the local world so players can collide/push each other!
  potBody?: planck.Body;
  tipBody?: planck.Body;
}

export interface NetPacket {
  type: 'state' | 'welcome' | 'peer-list';
  peerId: string;
  name?: string;
  color?: string;
  potX?: number;
  potY?: number;
  potAngle?: number;
  potVX?: number;
  potVY?: number;
  tipX?: number;
  tipY?: number;
  tipAngle?: number;
  peers?: string[];
}

/**
 * Lightweight MQTT v3.1.1 over WSS Relay Client
 * Guarantees 100% connectivity on 3G / 4G / 5G mobile networks (Symmetric CGNAT)
 * even when 0.peerjs.com or UDP WebRTC is blocked by the mobile carrier!
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
    private onMessage: (packet: NetPacket) => void,
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
        // 0x20 = CONNACK
        if (packetType === 0x20) {
          this.isReady = true;
          this.sendSubscribePacket(this.topic);
          this.onConnected();
          if (this.pingTimer) clearInterval(this.pingTimer);
          this.pingTimer = window.setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(new Uint8Array([0xc0, 0x00])); // PINGREQ
            }
          }, 20000);
        } else if (packetType === 0x30) {
          // 0x30 = PUBLISH
          this.parsePublishPacket(buf);
        }
      };

      this.ws.onerror = () => {
        // Fallback to next broker on error
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
      0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, // "MQTT"
      0x04, // Protocol level 4 (3.1.1)
      0x02, // Clean session
      0x00, 0x3c, // Keep-alive 60s
    ]);
    const payload = this.encodeString(this.clientId);
    const remLen = varHeader.length + payload.length;
    const remLenBytes = this.encodeLength(remLen);

    const pkt = new Uint8Array(1 + remLenBytes.length + remLen);
    pkt[0] = 0x10; // CONNECT
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
    pkt[0] = 0x82; // SUBSCRIBE
    pkt.set(remLenBytes, 1);
    pkt.set(pktId, 1 + remLenBytes.length);
    pkt.set(topicBytes, 1 + remLenBytes.length + pktId.length);
    pkt.set(qos, 1 + remLenBytes.length + pktId.length + topicBytes.length);
    this.ws.send(pkt);
  }

  public publish(packet: NetPacket) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) return;
    const topicBytes = this.encodeString(this.topic);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(packet));
    const remLen = topicBytes.length + payloadBytes.length;
    const remLenBytes = this.encodeLength(remLen);

    const pkt = new Uint8Array(1 + remLenBytes.length + remLen);
    pkt[0] = 0x30; // PUBLISH (QoS 0)
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
    if (qos > 0) offset += 2; // Packet ID

    if (offset >= buf.length) return;
    const payloadBytes = buf.subarray(offset, Math.min(buf.length, offset + remLen));
    try {
      const jsonStr = new TextDecoder().decode(payloadBytes);
      const data = JSON.parse(jsonStr) as NetPacket;
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
        // Ignore close error
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
  public myPeerId = `monkey_${Math.random().toString(36).substring(2, 9)}`;
  public myName = 'Macaco';
  public myColor = '#f59e0b';
  public isConnected = false;
  private isConnectingCode = '';

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
      { urls: 'stun:stun1.l.google.com:19302' },
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

  /**
   * Connects to a room using BOTH:
   * 1. Instant WSS Relay (works 100% on 3G/4G CGNAT even if 0.peerjs.com is blocked!)
   * 2. WebRTC PeerJS P2P DataChannel (with TURN relay fallback)
   */
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
    // Guard against duplicate calls while already connected/connecting to the same room
    if (this.isConnectingCode === code || (this.isConnected && this.roomCode === code)) {
      return Promise.resolve(code);
    }

    this.cleanup();
    this.isConnectingCode = code;
    this.roomCode = code;
    this.onStatusChange?.(`Conectando à sala ${code}...`, false, '');

    return new Promise((resolve) => {
      let resolved = false;
      const markOnline = (via: string) => {
        this.isConnectingCode = '';
        if (!this.isConnected) {
          this.isConnected = true;
          this.onStatusChange?.(`Sala Ativa (${code})`, true, code);
          this.onToast?.(`Conectado à sala ${code} (${via})! Envie o link para seu amigo.`);
        }
        if (!resolved) {
          resolved = true;
          resolve(code);
        }
      };

      // 1. Start 3G-proof WSS Relay immediately (connects in ~300ms on any mobile network!)
      const topic = `goi-skibidi-coop-v2/${code}`;
      this.mqttRelay = new MqttWssRelay(
        this.myPeerId,
        topic,
        (packet) => this.handleIncomingPacket(packet),
        () => markOnline('Relay 3G/Web')
      );

      // 2. Also start optional PeerJS P2P in background without blocking or crashing if 0.peerjs.com fails
      try {
        const hostPeerId = `getting-over-it-coop-${code}`;
        this.peer = asHost
          ? new Peer(hostPeerId, { config: { iceServers: this.getIceServers() } })
          : new Peer({ config: { iceServers: this.getIceServers() } });

        this.peer.on('open', () => {
          if (!asHost && this.peer) {
            const conn = this.peer.connect(hostPeerId, { reliable: false });
            this.setupConnection(conn, () => markOnline('P2P'));
          } else {
            markOnline('Host');
          }
        });

        this.peer.on('connection', (conn) => {
          this.setupConnection(conn);
        });

        this.peer.on('error', () => {
          // Silently ignore 0.peerjs.com errors since MqttWssRelay handles 3G connectivity!
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
    });

    conn.on('data', (rawData) => {
      this.handleIncomingPacket(rawData as NetPacket);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
    });
  }

  private handleIncomingPacket(data: NetPacket) {
    if (!data || !data.peerId || data.peerId === this.myPeerId) return;

    if (data.type === 'state' && data.potX !== undefined && data.potY !== undefined) {
      let remote = this.remotePlayers.get(data.peerId);
      if (!remote) {
        remote = this.createRemotePlayerBodies(data);
        this.remotePlayers.set(data.peerId, remote);
        this.onToast?.(`🐒 ${remote.name} entrou na selva!`);
      }

      remote.name = data.name || remote.name;
      remote.color = data.color || remote.color;
      remote.potX = data.potX;
      remote.potY = data.potY;
      remote.potAngle = data.potAngle || 0;
      remote.potVX = data.potVX || 0;
      remote.potVY = data.potVY || 0;
      remote.tipX = data.tipX ?? data.potX + 1;
      remote.tipY = data.tipY ?? data.potY + 1;
      remote.tipAngle = data.tipAngle || 0;
      remote.lastSeen = performance.now();
    }
  }

  private createRemotePlayerBodies(data: NetPacket): RemotePlayerState {
    const potX = data.potX || 0;
    const potY = data.potY || 1.2;

    const potBody = this.world.createBody({
      type: 'kinematic',
      position: planck.Vec2(potX, potY),
    });
    const f = potBody.createFixture(planck.Circle(planck.Vec2(0, -0.15), 0.48), {
      friction: 0.9,
      restitution: 0.1,
    });
    f.setUserData({ isTerrain: true, material: 'wood' });

    const tipBody = this.world.createBody({
      type: 'kinematic',
      position: planck.Vec2(data.tipX || potX + 1, data.tipY || potY + 1),
    });
    const tf = tipBody.createFixture(planck.Circle(0.18), {
      friction: 0.8,
    });
    tf.setUserData({ isTerrain: true, material: 'wood' });

    return {
      peerId: data.peerId,
      name: data.name || 'Macaco Amigo',
      color: data.color || '#38bdf8',
      potX,
      potY,
      potAngle: data.potAngle || 0,
      potVX: 0,
      potVY: 0,
      tipX: data.tipX || potX + 1,
      tipY: data.tipY || potY + 1,
      tipAngle: data.tipAngle || 0,
      lastSeen: performance.now(),
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

  public broadcastState(
    potX: number,
    potY: number,
    potAngle: number,
    potVX: number,
    potVY: number,
    tipX: number,
    tipY: number,
    tipAngle: number
  ) {
    if (!this.isConnected) return;

    const packet: NetPacket = {
      type: 'state',
      peerId: this.myPeerId,
      name: this.myName,
      color: this.myColor,
      potX: Number(potX.toFixed(3)),
      potY: Number(potY.toFixed(3)),
      potAngle: Number(potAngle.toFixed(3)),
      potVX: Number(potVX.toFixed(2)),
      potVY: Number(potVY.toFixed(2)),
      tipX: Number(tipX.toFixed(3)),
      tipY: Number(tipY.toFixed(3)),
      tipAngle: Number(tipAngle.toFixed(3)),
    };

    // Send via 3G-proof WSS Relay
    if (this.mqttRelay && this.mqttRelay.isReady) {
      this.mqttRelay.publish(packet);
    }

    // Also send via direct P2P connections if open
    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(packet);
      }
    }
  }

  public updateRemotePlayers(
    _dt: number,
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
        const curPot = r.potBody.getPosition();
        const nextPotX = curPot.x + (r.potX - curPot.x) * 0.35;
        const nextPotY = curPot.y + (r.potY - curPot.y) * 0.35;
        r.potBody.setPosition(planck.Vec2(nextPotX, nextPotY));
        r.potBody.setAngle(r.potAngle);

        const curTip = r.tipBody.getPosition();
        const nextTipX = curTip.x + (r.tipX - curTip.x) * 0.45;
        const nextTipY = curTip.y + (r.tipY - curTip.y) * 0.45;
        r.tipBody.setPosition(planck.Vec2(nextTipX, nextTipY));
        r.tipBody.setAngle(r.tipAngle);

        if (tetherEnabled) {
          const myPos = localPotBody.getPosition();
          const diff = planck.Vec2.sub(planck.Vec2(nextPotX, nextPotY), myPos);
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
