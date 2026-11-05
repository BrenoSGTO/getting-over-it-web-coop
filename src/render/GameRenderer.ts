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
    this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
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

    const targetX = potPos.x + Math.max(Math.min(potVel.x * 0.2, 1.8), -1.8);
    const targetY = Math.max(potPos.y + 0.9 + Math.max(Math.min(potVel.y * 0.16, 2.0), -1.4), 1.8);

    const diffX = targetX - this.camPos.x;
    const diffY = targetY - this.camPos.y;

    this.camVel.x += 60.0 * diffX * dt - 0.14 * this.camVel.x;
    this.camVel.y += 60.0 * diffY * dt - 0.14 * this.camVel.y;

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

    // 1. Lush Tropical Jungle Sky & Canopy Gradient
    const altRatio = Math.min(Math.max(this.camPos.y / level.summitY, 0), 1);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (altRatio < 0.7) {
      grad.addColorStop(0, '#052e16');
      grad.addColorStop(0.55, '#064e3b');
      grad.addColorStop(1, '#14532d');
    } else {
      // Golden sunlit treetop canopy near the summit
      grad.addColorStop(0, '#065f46');
      grad.addColorStop(0.5, '#115e59');
      grad.addColorStop(1, '#14532d');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Parallax Jungle Trees, Vines & Fireflies
    this.drawJungleParallax(ctx, w, h, altRatio);

    ctx.save();
    // Transform to World Coordinates (Y up, centered on camPos)
    ctx.translate(w / 2, h / 2);
    ctx.scale(ppm, -ppm);
    ctx.translate(-this.camPos.x, -this.camPos.y);

    // 2. Draw Decorative Hanging Vines in Background
    this.drawDecorativeVines(ctx, level);

    // 3. Draw Signposts in Background
    this.drawSignposts(ctx, level);

    // 4. Draw Jungle Terrain Blocks (Branches, Vine Knots, Mossy Rocks)
    for (const b of level.blocks) {
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.angle) ctx.rotate(b.angle);

      ctx.fillStyle = b.color;
      ctx.strokeStyle = b.strokeColor;
      ctx.lineWidth = 0.07;

      if (b.shapeType === 'box' && b.width && b.height) {
        ctx.beginPath();
        ctx.roundRect(-b.width / 2, -b.height / 2, b.width, b.height, 0.14);
        ctx.fill();
        ctx.stroke();

        // Lush green moss/foliage strip along the top of branches & stones
        ctx.fillStyle = b.material === 'ice' ? '#5eead4' : '#22c55e';
        ctx.beginPath();
        ctx.roundRect(-b.width / 2 + 0.08, b.height / 2 - 0.14, b.width - 0.16, 0.12, 0.06);
        ctx.fill();
      } else if (b.shapeType === 'circle' && b.radius) {
        ctx.beginPath();
        ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Braided vine spiral pattern on vine knots
        ctx.strokeStyle = 'rgba(187, 247, 208, 0.45)';
        ctx.lineWidth = 0.045;
        ctx.beginPath();
        ctx.arc(0, 0, b.radius * 0.58, 0.3, Math.PI * 1.6);
        ctx.stroke();

        // If this is the summit trophy, draw a Giant Golden Banana on top!
        if (b.id === 'summit-trophy') {
          this.drawBananaHead(ctx, 1.35, true);
        }
      }
      ctx.restore();
    }

    // 5. Draw Elastic Co-op Vine Tether if enabled
    if (tetherEnabled && remotePlayers.size > 0) {
      const myPot = localPlayer.potBody.getPosition();
      for (const r of remotePlayers.values()) {
        if (!r.potBody) continue;
        const rPos = r.potBody.getPosition();
        const dist = planck.Vec2.sub(rPos, myPot).length();
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(myPot.x, myPot.y);
        const midX = (myPot.x + rPos.x) / 2;
        const sag = Math.max(0, 4.2 - dist) * 0.25;
        const midY = (myPot.y + rPos.y) / 2 - sag;
        ctx.quadraticCurveTo(midX, midY, rPos.x, rPos.y);
        ctx.strokeStyle = dist > 4.2 ? '#ef4444' : '#4ade80';
        ctx.lineWidth = 0.07;
        ctx.setLineDash([0.14, 0.06]);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 6. Draw Remote Co-op Players
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

    // 7. Draw Local Player (Skibidi Monkey + Fortnite Banana Pickaxe)
    const potPos = localPlayer.potBody.getPosition();
    const tipPos = localPlayer.tipBody.getPosition();
    this.drawClimberCharacter(
      ctx,
      potPos.x,
      potPos.y,
      localPlayer.visualPotTilt,
      tipPos.x,
      tipPos.y,
      playerColor,
      playerName,
      false,
      !localPlayer.tipSlide
    );

    // 8. Draw Sparks / Leaf Particles
    for (const p of localPlayer.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(p.life / p.maxLife, 0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / ppm, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 9. Draw Decompiled FakeCursor Target
    const fc = localPlayer.fakeCursorPos;
    ctx.save();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.arc(fc.x, fc.y, 0.13, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tipPos.x, tipPos.y);
    ctx.lineTo(fc.x, fc.y);
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.25)';
    ctx.lineWidth = 0.025;
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  /**
   * Draws the Monkey inside a Skibidi Toilet + Fortnite Banana Pickaxe!
   */
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
    const shoulderX = potX;
    const shoulderY = potY + 0.35;
    const armAngle = Math.atan2(tipY - shoulderY, tipX - shoulderX);

    ctx.save();
    if (isRemote) ctx.globalAlpha = 0.88;

    // --- A. Bamboo / Jungle Wood Pickaxe Shaft ---
    const gripX = shoulderX + (tipX - shoulderX) * 0.36;
    const gripY = shoulderY + (tipY - shoulderY) * 0.36;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 0.095;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Inner highlight on the shaft
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    ctx.restore();

    // --- B. Skibidi Toilet + Monkey Character ---
    ctx.save();
    ctx.translate(potX, potY);
    ctx.rotate(potAngle);

    // 1. Porcelain Toilet Water Tank (Caixa Acoplada) at the back
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.roundRect(-0.5, -0.05, 0.26, 0.56, 0.05);
    ctx.fill();
    ctx.stroke();

    // Toilet Tank Lid
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(-0.53, 0.47, 0.32, 0.09, 0.04);
    ctx.fill();
    ctx.stroke();

    // Chrome Flush Handle on the tank
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(-0.44, 0.38);
    ctx.lineTo(-0.56, 0.35);
    ctx.stroke();

    // 2. Monkey Torso emerging from the toilet bowl
    ctx.fillStyle = '#7c2d12'; // Furry monkey brown
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.roundRect(-0.22, 0.02, 0.44, 0.46, 0.16);
    ctx.fill();
    ctx.stroke();

    // Monkey Belly Patch
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.ellipse(0.03, 0.24, 0.13, 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Monkey Head (looking toward the banana pickaxe!)
    const lookDirX = Math.cos(armAngle - potAngle) * 0.05;
    const headX = lookDirX;
    const headY = 0.66;

    // Monkey Round Ears (Left & Right)
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#7c2d12';
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.arc(headX + side * 0.22, headY + 0.02, 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fdba74';
      ctx.beginPath();
      ctx.arc(headX + side * 0.22, headY + 0.02, 0.05, 0, Math.PI * 2);
      ctx.fill();
    }

    // Monkey Cranium
    ctx.fillStyle = '#7c2d12';
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.arc(headX, headY, 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Colored Jungle Bandana on forehead
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.roundRect(headX - 0.21, headY + 0.08, 0.42, 0.075, 0.03);
    ctx.fill();

    // Monkey Tan Face Mask & Muzzle
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.ellipse(headX + 0.02, headY - 0.05, 0.16, 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Expressive Skibidi Monkey Eyes (wide & focused on the banana)
    for (const side of [-0.07, 0.09]) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(headX + side, headY + 0.03, 0.048, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(headX + side + lookDirX * 0.3, headY + 0.03, 0.024, 0, Math.PI * 2);
      ctx.fill();
    }

    // Monkey Nostrils & Cheeky Grin
    ctx.fillStyle = '#451a03';
    ctx.beginPath();
    ctx.arc(headX - 0.01, headY - 0.03, 0.015, 0, Math.PI * 2);
    ctx.arc(headX + 0.04, headY - 0.03, 0.015, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 0.024;
    ctx.beginPath();
    ctx.arc(headX + 0.015, headY - 0.06, 0.08, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // 4. Porcelain Toilet Bowl & Pedestal (drawn in front of lower body)
    // Pedestal base
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.roundRect(-0.34, -0.58, 0.68, 0.24, 0.08);
    ctx.fill();
    ctx.stroke();

    // Rounded Porcelain Bowl
    const bowlGrad = ctx.createRadialGradient(-0.1, -0.15, 0.05, 0, -0.18, 0.55);
    bowlGrad.addColorStop(0, '#ffffff');
    bowlGrad.addColorStop(0.65, '#f1f5f9');
    bowlGrad.addColorStop(1, '#cbd5e1');

    ctx.fillStyle = bowlGrad;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.arc(0, -0.14, 0.48, Math.PI * 0.88, Math.PI * 2.12, false);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Toilet Seat Rim
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.roundRect(-0.5, 0.02, 1.02, 0.13, 0.065);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // --- C. Furry Monkey Arms gripping the Banana Pickaxe Shaft ---
    ctx.save();
    ctx.strokeStyle = '#7c2d12';
    ctx.lineWidth = 0.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(gripX, gripY);
    ctx.stroke();

    // Monkey Hands at grip
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(gripX, gripY, 0.065, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- D. Fortnite-Style Banana Pickaxe Head at tipPos ---
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(armAngle);

    // Emerald glow ring when static friction is locked
    if (isStaticLocked) {
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.85)';
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.arc(0, 0, 0.38, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawBananaHead(ctx, 1.0, isStaticLocked);
    ctx.restore();

    // --- E. Player Name Tag above Monkey ---
    ctx.save();
    ctx.translate(potX, potY + 1.18);
    ctx.scale(1 / this.pixelsPerMeter, -1 / this.pixelsPerMeter);
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(5, 46, 22, 0.82)';
    const textWidth = ctx.measureText(name).width + 14;
    ctx.beginPath();
    ctx.roundRect(-textWidth / 2, -10, textWidth, 20, 6);
    ctx.fill();
    ctx.fillStyle = accentColor;
    ctx.fillText(name, 0, 4);
    ctx.restore();

    ctx.restore();
  }

  /**
   * Draws a curved Fortnite-style Banana Pickaxe head (crescent banana perpendicular to shaft)
   */
  private drawBananaHead(ctx: CanvasRenderingContext2D, scale = 1.0, isGlowing = false) {
    ctx.save();
    ctx.scale(scale, scale);

    // Main curved banana body (crescent arcing from -Y hook to +Y hook)
    ctx.fillStyle = isGlowing ? '#fde047' : '#facc15';
    ctx.strokeStyle = '#713f12';
    ctx.lineWidth = 0.035;

    ctx.beginPath();
    ctx.moveTo(-0.08, -0.34); // Bottom banana tip
    // Outer convex curve of the banana (facing +X)
    ctx.bezierCurveTo(0.22, -0.22, 0.22, 0.22, -0.08, 0.34); // Top banana tip
    // Inner concave curve of the banana (facing -X, curving back for hooking!)
    ctx.bezierCurveTo(0.02, 0.16, 0.02, -0.16, -0.08, -0.34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Golden shading ridge along the banana
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(-0.04, -0.27);
    ctx.quadraticCurveTo(0.12, 0, -0.04, 0.27);
    ctx.stroke();

    // Dark brown banana stem at top tip (+Y) and bottom tip (-Y)
    ctx.fillStyle = '#451a03';
    ctx.beginPath();
    ctx.arc(-0.08, 0.34, 0.045, 0, Math.PI * 2);
    ctx.arc(-0.08, -0.34, 0.04, 0, Math.PI * 2);
    ctx.fill();

    // Green Jungle Vine Wrap binding the banana to the pickaxe shaft
    ctx.fillStyle = '#16a34a';
    ctx.strokeStyle = '#052e16';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.roundRect(-0.06, -0.08, 0.18, 0.16, 0.04);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawDecorativeVines(ctx: CanvasRenderingContext2D, level: LevelBuilder) {
    ctx.save();
    for (const v of level.decorativeVines) {
      const midX = (v.x1 + v.x2) / 2;
      const midY = Math.min(v.y1, v.y2) - v.sag;

      // Main hanging vine rope
      ctx.strokeStyle = 'rgba(22, 163, 74, 0.55)';
      ctx.lineWidth = 0.06;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(v.x1, v.y1);
      ctx.quadraticCurveTo(midX, midY, v.x2, v.y2);
      ctx.stroke();

      // Little jungle leaves along the vine
      ctx.fillStyle = 'rgba(74, 222, 128, 0.6)';
      for (let t = 0.2; t <= 0.8; t += 0.2) {
        const u = 1 - t;
        const lx = u * u * v.x1 + 2 * u * t * midX + t * t * v.x2;
        const ly = u * u * v.y1 + 2 * u * t * midY + t * t * v.y2;
        ctx.beginPath();
        ctx.ellipse(lx, ly + 0.08, 0.12, 0.06, t * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawSignposts(ctx: CanvasRenderingContext2D, level: LevelBuilder) {
    for (const s of level.signposts) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(1 / this.pixelsPerMeter, -1 / this.pixelsPerMeter);

      ctx.fillStyle = 'rgba(5, 46, 22, 0.82)';
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-155, -28, 310, 52, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.title, 0, -7);

      ctx.fillStyle = '#dcfce7';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(s.subtitle, 0, 12);
      ctx.restore();
    }
  }

  private drawJungleParallax(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number
  ) {
    ctx.save();

    // Distant giant jungle tree trunks in background parallax
    ctx.fillStyle = 'rgba(2, 44, 34, 0.45)';
    for (let i = 0; i < 7; i++) {
      const tx = ((i * 290 - this.camPos.x * 8) % (w + 200) + (w + 200)) % (w + 200) - 100;
      const trunkW = 55 + (i % 3) * 25;
      ctx.fillRect(tx, 0, trunkW, h);
    }

    // Glowing jungle fireflies / pollen particles
    const glowAlpha = 0.25 + altRatio * 0.45;
    ctx.fillStyle = `rgba(250, 204, 21, ${glowAlpha})`;
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 197 + this.camPos.x * -5) % w + w) % w;
      const sy = ((i * 131 + this.camPos.y * 7) % h + h) % h;
      const r = (i % 3) * 1.1 + 1.2;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
