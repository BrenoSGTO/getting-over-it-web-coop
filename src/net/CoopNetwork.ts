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

export class CoopNetwork {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  public remotePlayers: Map<string, RemotePlayerState> = new Map();

  public roomCode = '';
  public myPeerId = '';
  public myName = 'Escalador';
  public myColor = '#f59e0b';
  public isConnected = false;

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

  public hostRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      const code = this.generateShortCode();
      const peerId = `getting-over-it-coop-${code}`;

      this.cleanup();
      this.onStatusChange?.('Criando sala Co-op...', false, '');

      this.peer = new Peer(peerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
          ],
        },
      });

      this.peer.on('open', (id) => {
        this.myPeerId = id;
        this.roomCode = code;
        this.isConnected = true;
        this.onStatusChange?.(`Sala Ativa (${code})`, true, code);
        this.onToast?.(`Sala ${code} criada! Copie o link para convidar amigos.`);
        resolve(code);
      });

      this.peer.on('connection', (conn) => {
        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Host Error:', err);
        this.onToast?.(`Erro de rede: ${err.type}`);
        reject(err);
      });
    });
  }

  public joinRoom(rawCode: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanCode = rawCode.trim().toUpperCase();
      const formattedCode = cleanCode.startsWith('GOI-') ? cleanCode : `GOI-${cleanCode}`;
      const hostPeerId = `getting-over-it-coop-${formattedCode}`;

      this.cleanup();
      this.onStatusChange?.(`Conectando à sala ${formattedCode}...`, false, '');

      this.peer = new Peer({
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
          ],
        },
      });

      this.peer.on('open', (id) => {
        this.myPeerId = id;
        this.roomCode = formattedCode;
        const conn = this.peer!.connect(hostPeerId, { reliable: false });
        this.setupConnection(conn, () => {
          this.isConnected = true;
          this.onStatusChange?.(`Conectado (${formattedCode})`, true, formattedCode);
          this.onToast?.(`Conectado à sala ${formattedCode}!`);
          resolve();
        });
      });

      this.peer.on('connection', (conn) => {
        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Join Error:', err);
        this.onStatusChange?.('Falha ao conectar', false, '');
        this.onToast?.(`Não foi possível encontrar a sala ${formattedCode}`);
        reject(err);
      });
    });
  }

  private setupConnection(conn: DataConnection, onOpenCallback?: () => void) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      onOpenCallback?.();

      // Send welcome packet and existing peer list so mesh connects everyone
      const knownPeers = Array.from(this.connections.keys());
      conn.send({
        type: 'peer-list',
        peerId: this.myPeerId,
        name: this.myName,
        color: this.myColor,
        peers: knownPeers,
      } satisfies NetPacket);
    });

    conn.on('data', (rawData) => {
      const data = rawData as NetPacket;
      if (!data || !data.peerId || data.peerId === this.myPeerId) return;

      if (data.type === 'peer-list' && data.peers) {
        for (const otherPeerId of data.peers) {
          if (otherPeerId !== this.myPeerId && !this.connections.has(otherPeerId) && this.peer) {
            const meshConn = this.peer.connect(otherPeerId, { reliable: false });
            this.setupConnection(meshConn);
          }
        }
      }

      if (data.type === 'state' && data.potX !== undefined && data.potY !== undefined) {
        let remote = this.remotePlayers.get(data.peerId);
        if (!remote) {
          remote = this.createRemotePlayerBodies(data);
          this.remotePlayers.set(data.peerId, remote);
          this.onToast?.(`👋 ${remote.name} entrou na escalada!`);
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
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.removeRemotePlayer(conn.peer);
    });
  }

  private createRemotePlayerBodies(data: NetPacket): RemotePlayerState {
    const potX = data.potX || 0;
    const potY = data.potY || 1.5;

    // Create a kinematic body for the remote player's cauldron so local player can stand on it or push off it!
    const potBody = this.world.createBody({
      type: 'kinematic',
      position: planck.Vec2(potX, potY),
    });
    const f = potBody.createFixture(planck.Circle(planck.Vec2(0, -0.15), 0.54), {
      friction: 0.9,
      restitution: 0.1,
    });
    f.setUserData({ isTerrain: true, material: 'metal' });

    const tipBody = this.world.createBody({
      type: 'kinematic',
      position: planck.Vec2(data.tipX || potX + 1, data.tipY || potY + 1),
    });
    const tf = tipBody.createFixture(planck.Circle(0.18), {
      friction: 0.8,
    });
    tf.setUserData({ isTerrain: true, material: 'metal' });

    return {
      peerId: data.peerId,
      name: data.name || 'Amigo',
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
    if (!this.isConnected || this.connections.size === 0) return;

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

    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(packet);
      }
    }
  }

  /**
   * Smoothly interpolates remote players' kinematic bodies and applies optional elastic Co-op tether
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

        // Optional Elastic Co-op Tether (Chained Together style!)
        if (tetherEnabled) {
          const myPos = localPotBody.getPosition();
          const diff = planck.Vec2.sub(planck.Vec2(nextPotX, nextPotY), myPos);
          const dist = diff.length();
          const maxRopeLength = 4.2; // meters
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
    for (const peerId of Array.from(this.remotePlayers.keys())) {
      this.removeRemotePlayer(peerId);
    }
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.isConnected = false;
  }
}
