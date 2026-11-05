import * as planck from 'planck-js';
import { FoddyPlayer } from '../physics/FoddyPlayer';
import { LevelBuilder } from '../physics/LevelBuilder';
import { RemotePlayerState } from '../net/CoopNetwork';

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  // Decompiled CameraControl.cs fields
  public camPos = { x: 0, y: 2.5 };
  public camVel = { x: 0, y: 0 };
  public pixelsPerMeter = 46; // Ortho zoom scale

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  public resize() {
    this.canvas.width = window.innerWidth * window.devicePixelRatio;
    this.canvas.height = window.innerHeight * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  /**
   * Decompiled CameraControl.FixedUpdate (token 0x06000156):
   * Spring-damper camera following player + velocity lookahead:
   * vel += (60f * (target - pos) * dt) - 0.12f * vel;
   * pos += vel * dt;
   */
  public updateCamera(dt: number, player: FoddyPlayer) {
    const potPos = player.potBody.getPosition();
    const potVel = player.potBody.getLinearVelocity();

    const targetX = potPos.x + Math.max(Math.min(potVel.x * 0.22, 2.0), -2.0);
    const targetY = Math.max(potPos.y + 0.9 + Math.max(Math.min(potVel.y * 0.18, 2.2), -1.5), 1.8);

    const diffX = targetX - this.camPos.x;
    const diffY = targetY - this.camPos.y;

    this.camVel.x += 60.0 * diffX * dt - 0.12 * this.camVel.x;
    this.camVel.y += 60.0 * diffY * dt - 0.12 * this.camVel.y;

    this.camPos.x += this.camVel.x * dt;
    this.camPos.y += this.camVel.y * dt;
  }

  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const wx = this.camPos.x + (screenX - w / 2) / this.pixelsPerMeter;
    const wy = this.camPos.y - (screenY - h / 2) / this.pixelsPerMeter;
    return { x: wx, y: wy };
  }

  public render(
    level: LevelBuilder,
    localPlayer: FoddyPlayer,
    playerName: string,
    playerColor: string,
    remotePlayers: Map<string, RemotePlayerState>,
    tetherEnabled: boolean
  ) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ppm = this.pixelsPerMeter;

    // 1. Dynamic Sky Gradient based on Altitude
    const altRatio = Math.min(Math.max(this.camPos.y / level.summitY, 0), 1);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (altRatio < 0.6) {
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#1e293b');
    } else {
      // Approaching space / starNest (GravityControl.cs)
      grad.addColorStop(0, '#020617');
      grad.addColorStop(1, '#0f172a');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle parallax background mountains/stars
    this.drawParallaxBackground(ctx, w, h, altRatio);

    ctx.save();
    // Transform to World Coordinates (Y up, centered on camPos)
    ctx.translate(w / 2, h / 2);
    ctx.scale(ppm, -ppm);
    ctx.translate(-this.camPos.x, -this.camPos.y);

    // 2. Draw Signposts in Background
    this.drawSignposts(ctx, level);

    // 3. Draw Level Terrain Blocks
    for (const b of level.blocks) {
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.angle) ctx.rotate(b.angle);

      ctx.fillStyle = b.color;
      ctx.strokeStyle = b.strokeColor;
      ctx.lineWidth = 0.07;

      if (b.shapeType === 'box' && b.width && b.height) {
        ctx.beginPath();
        ctx.roundRect(-b.width / 2, -b.height / 2, b.width, b.height, 0.08);
        ctx.fill();
        ctx.stroke();
      } else if (b.shapeType === 'circle' && b.radius) {
        ctx.beginPath();
        ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 4. Draw Elastic Co-op Tether Rope if enabled
    if (tetherEnabled && remotePlayers.size > 0) {
      const myPot = localPlayer.potBody.getPosition();
      for (const r of remotePlayers.values()) {
        if (!r.potBody) continue;
        const rPos = r.potBody.getPosition();
        const dist = planck.Vec2.sub(rPos, myPot).length();
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(myPot.x, myPot.y);
        // Slight sag in the rope when slack
        const midX = (myPot.x + rPos.x) / 2;
        const sag = Math.max(0, 4.2 - dist) * 0.25;
        const midY = (myPot.y + rPos.y) / 2 - sag;
        ctx.quadraticCurveTo(midX, midY, rPos.x, rPos.y);
        ctx.strokeStyle = dist > 4.2 ? '#ef4444' : '#fbbf24';
        ctx.lineWidth = 0.06;
        ctx.setLineDash([0.12, 0.08]);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 5. Draw Remote Co-op Players
    for (const r of remotePlayers.values()) {
      const rPotPos = r.potBody ? r.potBody.getPosition() : { x: r.potX, y: r.potY };
      const rTipPos = r.tipBody ? r.tipBody.getPosition() : { x: r.tipX, y: r.tipY };
      this.drawClimberCharacter(
        ctx,
        rPotPos.x,
        rPotPos.y,
        r.potAngle,
        rTipPos.x,
        rTipPos.y,
        r.color,
        r.name,
        true,
        false
      );
    }

    // 6. Draw Local Player
    const potPos = localPlayer.potBody.getPosition();
    const tipPos = localPlayer.tipBody.getPosition();
    this.drawClimberCharacter(
      ctx,
      potPos.x,
      potPos.y,
      localPlayer.potBody.getAngle(),
      tipPos.x,
      tipPos.y,
      playerColor,
      playerName,
      false,
      !localPlayer.tipSlide
    );

    // 7. Draw Sparks & Debris Particles
    for (const p of localPlayer.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(p.life / p.maxLife, 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / ppm, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 8. Draw Decompiled FakeCursor Ghost Target (`fakeCursor` from PlayerControl.cs)
    const fc = localPlayer.fakeCursorPos;
    ctx.save();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.arc(fc.x, fc.y, 0.14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tipPos.x, tipPos.y);
    ctx.lineTo(fc.x, fc.y);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.25)';
    ctx.lineWidth = 0.025;
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  private drawClimberCharacter(
    ctx: CanvasRenderingContext2D,
    potX: number,
    potY: number,
    potAngle: number,
    tipX: number,
    tipY: number,
    accentColor: string,
    name: string,
    isRemote: boolean,
    isStaticLocked: boolean
  ) {
    const shoulderX = potX - Math.sin(potAngle) * 0.35;
    const shoulderY = potY + Math.cos(potAngle) * 0.35;
    const armAngle = Math.atan2(tipY - shoulderY, tipX - shoulderX);

    ctx.save();
    if (isRemote) ctx.globalAlpha = 0.88;

    // --- A. 2-Bone Inverse Kinematics Arms & Hammer Shaft ---
    const gripX = shoulderX + (tipX - shoulderX) * 0.38;
    const gripY = shoulderY + (tipY - shoulderY) * 0.38;

    // Wooden handle from shoulder through hands to hammer tip
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 0.09;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // Character Torso & Head emerging from the Cauldron
    ctx.save();
    ctx.translate(potX, potY);
    ctx.rotate(potAngle);

    // Torso
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.roundRect(-0.22, 0.05, 0.44, 0.48, 0.14);
    ctx.fill();

    // Head looking toward the hammer tip
    const headLookX = Math.cos(armAngle - potAngle) * 0.05;
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(headLookX, 0.68, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.03;
    ctx.stroke();

    // Headband
    ctx.fillStyle = accentColor;
    ctx.fillRect(-0.2 + headLookX, 0.72, 0.4, 0.07);

    // Cauldron / Pot Body (drawn over lower torso)
    const potGrad = ctx.createRadialGradient(-0.15, -0.1, 0.05, 0, -0.15, 0.6);
    potGrad.addColorStop(0, '#475569');
    potGrad.addColorStop(0.7, '#1e293b');
    potGrad.addColorStop(1, '#0f172a');

    ctx.fillStyle = potGrad;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    ctx.arc(0, -0.18, 0.55, Math.PI * 0.85, Math.PI * 2.15, false);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cauldron Rim
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(-0.54, 0.04, 1.08, 0.13, 0.06);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Arms reaching for the handle grip
    ctx.save();
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(gripX, gripY);
    ctx.stroke();
    ctx.restore();

    // --- B. Yosemite Hammer Head at tipPos ---
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(armAngle);

    // Glow ring when static friction is locked (exact visual feedback of HammerCollisions.slide == false)
    if (isStaticLocked) {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.arc(0, 0, 0.34, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = isStaticLocked ? '#10b981' : '#e2e8f0';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.roundRect(-0.14, -0.26, 0.28, 0.52, 0.05);
    ctx.fill();
    ctx.stroke();

    // Pick spike on top of the hammer
    ctx.beginPath();
    ctx.moveTo(0, 0.26);
    ctx.lineTo(0.08, 0.38);
    ctx.lineTo(-0.08, 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // --- C. Player Name Tag above Head ---
    ctx.save();
    ctx.translate(potX, potY + 1.18);
    ctx.scale(1 / this.pixelsPerMeter, -1 / this.pixelsPerMeter);
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    const textWidth = ctx.measureText(name).width + 12;
    ctx.beginPath();
    ctx.roundRect(-textWidth / 2, -10, textWidth, 20, 6);
    ctx.fill();
    ctx.fillStyle = accentColor;
    ctx.fillText(name, 0, 4);
    ctx.restore();

    ctx.restore();
  }

  private drawSignposts(ctx: CanvasRenderingContext2D, level: LevelBuilder) {
    for (const s of level.signposts) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(1 / this.pixelsPerMeter, -1 / this.pixelsPerMeter);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-145, -28, 290, 52, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.title, 0, -7);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(s.subtitle, 0, 12);
      ctx.restore();
    }
  }

  private drawParallaxBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number
  ) {
    ctx.save();
    // Distant stars that become brighter as you climb higher
    const starAlpha = 0.15 + altRatio * 0.75;
    ctx.fillStyle = `rgba(248, 250, 252, ${starAlpha})`;
    for (let i = 0; i < 45; i++) {
      const sx = ((i * 197 + this.camPos.x * -4) % w + w) % w;
      const sy = ((i * 131 + this.camPos.y * 6) % h + h) % h;
      const r = (i % 3) * 0.8 + 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
