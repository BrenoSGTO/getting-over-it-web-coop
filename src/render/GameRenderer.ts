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
  private monkeyToiletSprite: HTMLCanvasElement | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loadRealisticMonkeyToiletSprite();
  }

  private loadRealisticMonkeyToiletSprite() {
    const img = new Image();
    img.src = 'monkey_toilet.jpg';
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.width;
      off.height = img.height;
      const octx = off.getContext('2d');
      if (!octx) return;
      octx.drawImage(img, 0, 0);
      const imgData = octx.getImageData(0, 0, off.width, off.height);
      const data = imgData.data;

      // Chroma-key out the bright magenta (#FF00FF) background + despill magenta edges
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const magentaDominance = Math.min(r, b) - g;
        if (magentaDominance > 65 && r > 130 && b > 130) {
          // Smooth feathering at the silhouette boundary
          const alpha = Math.max(0, Math.min(1, (115 - magentaDominance) / 50));
          data[i + 3] = Math.round(alpha * 255);
          if (alpha > 0) {
            // Despill magenta fringe on hair/porcelain edges
            data[i] = g;
            data[i + 2] = g;
          }
        }
      }
      octx.putImageData(imgData, 0, 0);
      this.monkeyToiletSprite = off;
    };
  }

  public resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    tetherEnabled: boolean,
    localChatBubble = ''
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

    // 4. Draw Jungle Terrain Blocks (with Viewport Frustum Culling for max FPS)
    const viewHalfW = w / ppm / 2 + 8;
    const viewHalfH = h / ppm / 2 + 8;
    for (const b of level.blocks) {
      const blockHalfW = (b.width || b.radius || 1) / 2;
      const blockHalfH = (b.height || b.radius || 1) / 2;
      if (
        Math.abs(b.x - this.camPos.x) > viewHalfW + blockHalfW ||
        Math.abs(b.y - this.camPos.y) > viewHalfH + blockHalfH
      ) {
        continue;
      }

      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.angle) ctx.rotate(b.angle);

      ctx.fillStyle = b.color;
      ctx.strokeStyle = b.strokeColor;
      ctx.lineWidth = 0.065;
      ctx.lineJoin = 'round';

      if (b.shapeType === 'polygon' && b.vertices && b.vertices.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(b.vertices[0].x, b.vertices[0].y);
        for (let i = 1; i < b.vertices.length; i++) {
          ctx.lineTo(b.vertices[i].x, b.vertices[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Highlight top-facing moss/bark edges on reverse-engineered Getting Over It terrain
        ctx.strokeStyle =
          b.material === 'ice'
            ? '#5eead4'
            : b.material === 'wood'
              ? '#ca8a04'
              : '#4ade80';
        ctx.lineWidth = 0.055;
        ctx.beginPath();
        let hasTopEdge = false;
        for (let i = 0; i < b.vertices.length; i++) {
          const v1 = b.vertices[i];
          const v2 = b.vertices[(i + 1) % b.vertices.length];
          const dx = v2.x - v1.x;
          const dy = v2.y - v1.y;
          // In local coordinates, top edges have substantial horizontal span near the upper half
          if (Math.abs(dx) > Math.abs(dy) * 0.7 && (v1.y + v2.y) * 0.5 >= 0) {
            ctx.moveTo(v1.x, v1.y);
            ctx.lineTo(v2.x, v2.y);
            hasTopEdge = true;
          }
        }
        if (hasTopEdge) ctx.stroke();
      } else if (b.shapeType === 'box' && b.width && b.height) {
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

    // 6. Draw Remote Co-op Players (always use exact interpolated r.potX/r.potY & r.tipX/r.tipY)
    const now = performance.now();
    for (const r of remotePlayers.values()) {
      const rBubble =
        r.chatBubbleText && r.chatBubbleUntil && now < r.chatBubbleUntil ? r.chatBubbleText : '';
      this.drawClimberCharacter(
        ctx,
        r.potX,
        r.potY,
        r.potAngle,
        r.tipX,
        r.tipY,
        r.color,
        r.name,
        true,
        false,
        rBubble
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
      !localPlayer.tipSlide,
      localChatBubble
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
    isStaticLocked: boolean,
    chatBubbleText = ''
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

    if (this.monkeyToiletSprite) {
      // Flip horizontally when the banana pickaxe is on the left side of the monkey!
      const facingDir = Math.cos(armAngle - potAngle) >= -0.15 ? 1 : -1;
      ctx.save();
      // In world space, +Y is up, so scale(facingDir, -1) draws the upright image!
      ctx.scale(facingDir, -1);
      // Align the porcelain base (-0.63m) and monkey head (+0.95m) with the physics collider
      ctx.drawImage(this.monkeyToiletSprite, -0.78, -0.96, 1.56, 1.62);
      ctx.restore();
    } else {
      // Fallback procedural monkey + toilet while image loads
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.roundRect(-0.5, -0.05, 0.26, 0.56, 0.05);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#7c2d12';
      ctx.beginPath();
      ctx.arc(0, 0.62, 0.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, -0.14, 0.48, Math.PI * 0.88, Math.PI * 2.12, false);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

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

    // --- E. Player Name Tag & Chat Speech Bubble above Monkey ---
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

    if (chatBubbleText) {
      ctx.font = '600 12px Inter, sans-serif';
      const bubbleW = Math.min(Math.max(ctx.measureText(chatBubbleText).width + 20, 48), 260);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-bubbleW / 2, -38, bubbleW, 24, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.fillText(chatBubbleText, 0, -22, bubbleW - 14);
    }
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
