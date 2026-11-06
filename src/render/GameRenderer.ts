import * as planck from 'planck-js';
import { FoddyPlayer } from '../physics/FoddyPlayer';
import { LevelBuilder, SurfaceMaterial } from '../physics/LevelBuilder';
import { RemotePlayerState } from '../net/CoopNetwork';

interface TwinkleStar {
  xRatio: number;
  yRatio: number;
  size: number;
  baseAlpha: number;
  phase: number;
  speed: number;
  color: string;
}

interface VoxelCloudBlock {
  rx: number;
  ry: number;
  rw: number;
  rh: number;
}

interface VoxelCloud {
  x: number;
  worldY: number;
  speed: number;
  blocks: VoxelCloudBlock[];
  scale: number;
}

interface SkyKeyframe {
  ratio: number;
  top: [number, number, number];
  mid: [number, number, number];
  bottom: [number, number, number];
}

const SKY_KEYFRAMES: SkyKeyframe[] = [
  // Ground (0m - 50m): Beautiful bright vibrant blue Minecraft sky (#3a88fe to #78b2fe) with warm sunlight
  {
    ratio: 0.0,
    top: [58, 136, 254],     // #3a88fe
    mid: [120, 178, 254],    // #78b2fe
    bottom: [225, 240, 255], // Sunlit horizon
  },
  {
    ratio: 0.14, // ~50m
    top: [58, 136, 254],     // #3a88fe
    mid: [142, 185, 252],
    bottom: [255, 222, 160], // Warm sunlight
  },
  // Mid-mountain (50m - 180m): Sunset / golden twilight with warm amber and purple tones
  {
    ratio: 0.28, // ~100m
    top: [78, 48, 132],      // Warm twilight purple
    mid: [238, 118, 68],     // Amber sunset
    bottom: [251, 191, 36],  // Golden sunset glow
  },
  {
    ratio: 0.42, // ~150m
    top: [52, 28, 88],       // Deep purple
    mid: [195, 68, 85],      // Sunset rose
    bottom: [249, 115, 22],  // Fiery amber horizon
  },
  {
    ratio: 0.50, // 180m
    top: [32, 22, 68],       // Twilight dusk
    mid: [115, 45, 95],      // Twilight magenta
    bottom: [180, 83, 9],    // Deep amber sliver
  },
  // Upper-mountain (180m - 300m): Deep twilight indigo (#0d1430 to #1e1b4b) with glowing stars
  {
    ratio: 0.65, // ~235m
    top: [13, 20, 48],       // #0d1430
    mid: [22, 24, 62],
    bottom: [30, 27, 75],    // #1e1b4b
  },
  {
    ratio: 0.83, // 300m
    top: [8, 12, 28],
    mid: [13, 20, 48],       // #0d1430
    bottom: [30, 27, 75],    // #1e1b4b
  },
  // Space summit (300m - 362m+): Deep black cosmic space with twinkling square stars and nebulae
  {
    ratio: 1.0,  // 362m+
    top: [1, 2, 6],          // Deep black cosmic space
    mid: [4, 5, 12],
    bottom: [8, 9, 18],
  },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

function getSkyColors(ratio: number): {
  top: [number, number, number];
  mid: [number, number, number];
  bottom: [number, number, number];
} {
  const clamped = Math.max(0, Math.min(ratio, 1));
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    const k0 = SKY_KEYFRAMES[i];
    const k1 = SKY_KEYFRAMES[i + 1];
    if (clamped >= k0.ratio && clamped <= k1.ratio) {
      const t = (clamped - k0.ratio) / (k1.ratio - k0.ratio);
      return {
        top: lerpColor(k0.top, k1.top, t),
        mid: lerpColor(k0.mid, k1.mid, t),
        bottom: lerpColor(k0.bottom, k1.bottom, t),
      };
    }
  }
  const last = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
  return { top: last.top, mid: last.mid, bottom: last.bottom };
}

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  // Decompiled CameraControl.cs fields
  public camPos = { x: 0, y: 2.5 };
  public camVel = { x: 0, y: 0 };
  public pixelsPerMeter = 46; // Ortho zoom scale
  private monkeyToiletSprite: HTMLCanvasElement | null = null;
  private slopPatterns: Partial<Record<SurfaceMaterial, CanvasPattern>> = {};
  private stars: TwinkleStar[] = [];
  private voxelClouds: VoxelCloud[] = [];

  // Terrain Chunk Cache (12m x 12m world-space chunks with LRU)
  public texturesLoaded = false;
  private loadedTextureCount = 0;
  private chunkCache: Map<string, { canvas: HTMLCanvasElement; chunkX: number; chunkY: number }> =
    new Map();
  private lastPpm = 46;
  private lastDpr = 1;
  private readonly CHUNK_SIZE = 12; // 12 meters per chunk
  private readonly MAX_CHUNKS = 40;

  // Sky and Nebulae rendering caches
  private cachedSkyGrad: CanvasGradient | null = null;
  private cachedAltBucket = -1;
  private cachedSkyH = 0;
  private nebula1Grad: CanvasGradient | null = null;
  private nebula2Grad: CanvasGradient | null = null;
  private lastNebulaW = 0;
  private lastNebulaH = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loadRealisticMonkeyToiletSprite();
    this.loadRealisticSlopTextures();
    this.initStars();
    this.initVoxelClouds();
  }

  public clearChunkCache() {
    this.chunkCache.clear();
  }

  private loadRealisticSlopTextures() {
    const materials: SurfaceMaterial[] = ['rock', 'wood', 'metal', 'ice'];
    for (const m of materials) {
      const img = new Image();
      img.src = `textures/${m}.png`;
      const onDone = () => {
        this.loadedTextureCount++;
        if (this.loadedTextureCount >= materials.length) {
          this.texturesLoaded = true;
          this.clearChunkCache();
        }
      };
      img.onload = () => {
        const pat = this.ctx.createPattern(img, 'repeat');
        if (pat) {
          const matrix = new DOMMatrix();
          // Scale texture so 1 Minecraft block (32x32 pixel art) ~ 1.0m in world coordinates
          const scale = 1.0 / img.width;
          matrix.scaleSelf(scale, scale);
          if (pat.setTransform) {
            pat.setTransform(matrix);
          }
          this.slopPatterns[m] = pat;
        }
        onDone();
      };
      img.onerror = () => {
        onDone();
      };
    }
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
    this.ctx.imageSmoothingEnabled = false;
    this.clearChunkCache();
    this.cachedSkyGrad = null;
    this.cachedAltBucket = -1;
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

    // 1. Minecraft Dynamic Sky Gradient & Parallax Background
    this.renderMinecraftSkyAndBackground(ctx, w, h, level);

    ctx.save();
    // Transform to World Coordinates (Y up, centered on camPos)
    ctx.translate(w / 2, h / 2);
    ctx.scale(ppm, -ppm);
    ctx.translate(-this.camPos.x, -this.camPos.y);

    const viewHalfW = w / ppm / 2 + 1;
    const viewHalfH = h / ppm / 2 + 1;
    const viewMinX = this.camPos.x - viewHalfW;
    const viewMaxX = this.camPos.x + viewHalfW;
    const viewMinY = this.camPos.y - viewHalfH;
    const viewMaxY = this.camPos.y + viewHalfH;

    // 2. Draw Decorative Hanging Vines in Background (frustum culled)
    this.drawDecorativeVines(ctx, level, viewMinX, viewMaxX, viewMinY, viewMaxY);

    // 3. Draw Signposts in Background (frustum culled)
    this.drawSignposts(ctx, level, viewMinX, viewMaxX, viewMinY, viewMaxY);

    // 4. Draw Jungle Terrain (Cached Chunks with World-Anchored Textures, or Fallback)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    if (this.pixelsPerMeter !== this.lastPpm || dpr !== this.lastDpr) {
      this.clearChunkCache();
      this.lastPpm = this.pixelsPerMeter;
      this.lastDpr = dpr;
    }

    if (this.texturesLoaded) {
      const startChunkX = Math.floor(viewMinX / this.CHUNK_SIZE);
      const endChunkX = Math.floor(viewMaxX / this.CHUNK_SIZE);
      const startChunkY = Math.floor(viewMinY / this.CHUNK_SIZE);
      const endChunkY = Math.floor(viewMaxY / this.CHUNK_SIZE);

      let chunksBuiltThisFrame = 0;
      const MAX_CHUNKS_PER_FRAME = 2;

      for (let cy = startChunkY; cy <= endChunkY; cy++) {
        for (let cx = startChunkX; cx <= endChunkX; cx++) {
          const key = `${cx},${cy}`;
          let chunk = this.chunkCache.get(key);
          if (!chunk) {
            if (chunksBuiltThisFrame < MAX_CHUNKS_PER_FRAME) {
              chunk = this.buildChunk(cx, cy, level);
              this.chunkCache.set(key, chunk);
              chunksBuiltThisFrame++;
              if (this.chunkCache.size > this.MAX_CHUNKS) {
                const oldestKey = this.chunkCache.keys().next().value;
                if (oldestKey) this.chunkCache.delete(oldestKey);
              }
            }
          }

          if (chunk) {
            // Update LRU order
            this.chunkCache.delete(key);
            this.chunkCache.set(key, chunk);

            ctx.save();
            ctx.translate(cx * this.CHUNK_SIZE, (cy + 1) * this.CHUNK_SIZE);
            ctx.scale(1, -1);
            ctx.drawImage(chunk.canvas, 0, 0, this.CHUNK_SIZE, this.CHUNK_SIZE);
            ctx.restore();
          } else {
            // Fallback for chunks queued to build: render blocks in this chunk region
            this.renderBlocksInRegion(
              ctx,
              level,
              cx * this.CHUNK_SIZE,
              (cx + 1) * this.CHUNK_SIZE,
              cy * this.CHUNK_SIZE,
              (cy + 1) * this.CHUNK_SIZE,
              false
            );
          }
        }
      }
    } else {
      // Textures still loading: fall back to flat colors direct render
      this.renderBlocksInRegion(ctx, level, viewMinX, viewMaxX, viewMinY, viewMaxY, true);
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
    if (localPlayer.particles.length > 0) {
      ctx.save();
      for (let i = 0; i < localPlayer.particles.length; i++) {
        const p = localPlayer.particles[i];
        ctx.globalAlpha = Math.max(p.life / p.maxLife, 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / ppm, 0, Math.PI * 2);
        ctx.fill();
      }
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

  private buildChunk(
    chunkX: number,
    chunkY: number,
    level: LevelBuilder
  ): { canvas: HTMLCanvasElement; chunkX: number; chunkY: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const renderScale = this.pixelsPerMeter * dpr;
    const chunkCanvas = document.createElement('canvas');
    chunkCanvas.width = Math.ceil(this.CHUNK_SIZE * renderScale);
    chunkCanvas.height = Math.ceil(this.CHUNK_SIZE * renderScale);
    const octx = chunkCanvas.getContext('2d');
    if (!octx) return { canvas: chunkCanvas, chunkX, chunkY };

    octx.imageSmoothingEnabled = false;

    const minX = chunkX * this.CHUNK_SIZE;
    const maxX = minX + this.CHUNK_SIZE;
    const minY = chunkY * this.CHUNK_SIZE;
    const maxY = minY + this.CHUNK_SIZE;

    // Transform offscreen context: user coordinates match world coordinates in meters, +Y is up
    octx.translate(-minX * renderScale, maxY * renderScale);
    octx.scale(renderScale, -renderScale);

    for (let i = 0; i < level.blocks.length; i++) {
      const b = level.blocks[i];
      if (
        b.minX !== undefined &&
        b.maxX !== undefined &&
        b.minY !== undefined &&
        b.maxY !== undefined
      ) {
        if (b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY) {
          continue;
        }
      }

      const pat = this.slopPatterns[b.material];
      octx.fillStyle = pat || b.color;

      if (b.shapeType === 'polygon' && b.worldVerts && b.worldVerts.length >= 3) {
        octx.beginPath();
        octx.moveTo(b.worldVerts[0].x, b.worldVerts[0].y);
        for (let j = 1; j < b.worldVerts.length; j++) {
          octx.lineTo(b.worldVerts[j].x, b.worldVerts[j].y);
        }
        octx.closePath();
        octx.fill();
      } else if (b.shapeType === 'circle' && b.radius) {
        octx.beginPath();
        octx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        octx.fill();

        if (b.id === 'summit-trophy') {
          octx.save();
          octx.translate(b.x, b.y);
          this.drawBananaHead(octx, 1.35, true);
          octx.restore();
        }
      } else if (b.shapeType === 'box' && b.width && b.height) {
        octx.beginPath();
        octx.rect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
        octx.fill();
      }
    }

    return { canvas: chunkCanvas, chunkX, chunkY };
  }

  private renderBlocksInRegion(
    ctx: CanvasRenderingContext2D,
    level: LevelBuilder,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    useFlatColorsOnly: boolean
  ) {
    for (let i = 0; i < level.blocks.length; i++) {
      const b = level.blocks[i];
      if (
        b.minX !== undefined &&
        b.maxX !== undefined &&
        b.minY !== undefined &&
        b.maxY !== undefined
      ) {
        if (b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY) {
          continue;
        }
      }

      ctx.fillStyle = useFlatColorsOnly ? b.color : (this.slopPatterns[b.material] || b.color);

      if (b.shapeType === 'polygon' && b.worldVerts && b.worldVerts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(b.worldVerts[0].x, b.worldVerts[0].y);
        for (let j = 1; j < b.worldVerts.length; j++) {
          ctx.lineTo(b.worldVerts[j].x, b.worldVerts[j].y);
        }
        ctx.closePath();
        ctx.fill();
      } else if (b.shapeType === 'circle' && b.radius) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();

        if (b.id === 'summit-trophy') {
          ctx.save();
          ctx.translate(b.x, b.y);
          this.drawBananaHead(ctx, 1.35, true);
          ctx.restore();
        }
      } else if (b.shapeType === 'box' && b.width && b.height) {
        ctx.beginPath();
        ctx.rect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
        ctx.fill();
      }
    }
  }

  private drawDecorativeVines(
    ctx: CanvasRenderingContext2D,
    level: LevelBuilder,
    viewMinX: number,
    viewMaxX: number,
    viewMinY: number,
    viewMaxY: number
  ) {
    let hasDrawn = false;
    for (const v of level.decorativeVines) {
      const vMinX = Math.min(v.x1, v.x2);
      const vMaxX = Math.max(v.x1, v.x2);
      const vMinY = Math.min(v.y1, v.y2) - v.sag;
      const vMaxY = Math.max(v.y1, v.y2);
      if (vMaxX < viewMinX || vMinX > viewMaxX || vMaxY < viewMinY || vMinY > viewMaxY) {
        continue;
      }

      if (!hasDrawn) {
        ctx.save();
        ctx.strokeStyle = 'rgba(22, 163, 74, 0.55)';
        ctx.lineWidth = 0.06;
        ctx.lineCap = 'round';
        hasDrawn = true;
      }

      const midX = (v.x1 + v.x2) / 2;
      const midY = Math.min(v.y1, v.y2) - v.sag;

      // Main hanging vine rope
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
    if (hasDrawn) {
      ctx.restore();
    }
  }

  private drawSignposts(
    ctx: CanvasRenderingContext2D,
    level: LevelBuilder,
    viewMinX: number,
    viewMaxX: number,
    viewMinY: number,
    viewMaxY: number
  ) {
    for (const s of level.signposts) {
      if (s.x + 4 < viewMinX || s.x - 4 > viewMaxX || s.y + 2 < viewMinY || s.y - 2 > viewMaxY) {
        continue;
      }

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

  private initStars() {
    const colors = ['#ffffff', '#ffffff', '#e0f2fe', '#fef08a', '#ede9fe'];
    for (let i = 0; i < 90; i++) {
      const seed1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const seed2 = Math.sin((i + 99) * 43.123 + 12.876) * 23421.631;
      const xRatio = seed1 - Math.floor(seed1);
      const yRatio = seed2 - Math.floor(seed2);
      const size = i % 6 === 0 ? 3 : i % 2 === 0 ? 2 : 1.5;
      this.stars.push({
        xRatio,
        yRatio,
        size,
        baseAlpha: 0.45 + 0.55 * ((i % 10) / 10),
        phase: (i * 0.73) % (Math.PI * 2),
        speed: 1.2 + (i % 5) * 0.7,
        color: colors[i % colors.length],
      });
    }
  }

  private initVoxelClouds() {
    const templates: VoxelCloudBlock[][] = [
      // Cloud A: Classic wide Minecraft voxel slab
      [
        { rx: 0, ry: 8, rw: 170, rh: 26 },
        { rx: 24, ry: 0, rw: 116, rh: 14 },
        { rx: -28, ry: 12, rw: 36, rh: 18 },
        { rx: 154, ry: 10, rw: 42, rh: 20 },
      ],
      // Cloud B: Medium elongated stepped cloud
      [
        { rx: 0, ry: 6, rw: 135, rh: 22 },
        { rx: 32, ry: 0, rw: 75, rh: 12 },
        { rx: 125, ry: 8, rw: 34, rh: 16 },
        { rx: -20, ry: 10, rw: 28, rh: 14 },
      ],
      // Cloud C: Chunky tiered cloud
      [
        { rx: 0, ry: 10, rw: 190, rh: 28 },
        { rx: 38, ry: 0, rw: 84, rh: 16 },
        { rx: 105, ry: 4, rw: 64, rh: 14 },
        { rx: -36, ry: 14, rw: 48, rh: 20 },
      ],
      // Cloud D: Compact voxel formation
      [
        { rx: 0, ry: 6, rw: 100, rh: 20 },
        { rx: 22, ry: 0, rw: 58, rh: 10 },
        { rx: 85, ry: 8, rw: 30, rh: 14 },
      ],
    ];

    const cloudAlts = [28, 52, 78, 105, 135, 168, 202, 238];
    for (let i = 0; i < cloudAlts.length; i++) {
      this.voxelClouds.push({
        x: (i * 260) % 1300,
        worldY: cloudAlts[i],
        speed: 0.75 + (i % 3) * 0.4,
        blocks: templates[i % templates.length],
        scale: 0.85 + (i % 3) * 0.2,
      });
    }
  }

  private renderMinecraftSkyAndBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    level: LevelBuilder
  ) {
    const altRatio = Math.max(0, this.camPos.y / level.summitY);
    const now = performance.now();

    // 1. Dynamic sky gradient transitioning smoothly based on altitude altRatio
    // Cache the gradient: recreate only when altitude bucket changes or on resize
    const altBucket = Math.round(altRatio * 200);
    if (altBucket !== this.cachedAltBucket || h !== this.cachedSkyH || !this.cachedSkyGrad) {
      const { top, mid, bottom } = getSkyColors(altRatio);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgb(${top[0]}, ${top[1]}, ${top[2]})`);
      grad.addColorStop(0.55, `rgb(${mid[0]}, ${mid[1]}, ${mid[2]})`);
      grad.addColorStop(1, `rgb(${bottom[0]}, ${bottom[1]}, ${bottom[2]})`);
      this.cachedSkyGrad = grad;
      this.cachedAltBucket = altBucket;
      this.cachedSkyH = h;
    }
    ctx.fillStyle = this.cachedSkyGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Twinkling square stars (Upper-mountain & Cosmic space)
    this.drawMinecraftStars(ctx, w, h, altRatio, now);

    // 3. Cosmic nebulae & summit Overworld planet (Space summit)
    this.drawSpaceNebulaeAndSummitPlanet(ctx, w, h, altRatio);

    // 4. Iconic Minecraft Square Sun (Ground & Mid-mountain sunset)
    this.drawMinecraftSun(ctx, w, h, altRatio);

    // 5. Iconic Minecraft Square Moon (Sunset, Twilight, Cosmic space)
    this.drawMinecraftMoon(ctx, w, h, altRatio);

    // 6. Distant Minecraft stepped hills in parallax (Ground & Lower mid-mountain)
    this.drawMinecraftDistantHills(ctx, w, h, altRatio);

    // 7. Drifting cubic / voxel clouds in parallax
    this.drawVoxelClouds(ctx, w, h, altRatio, now);

    // 8. Ground sunlight ambient sparkles
    this.drawGroundAmbientSunlight(ctx, w, h, altRatio, now);
  }

  private drawMinecraftSun(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number
  ) {
    // Sun is visible from ground (0m) to late sunset (180m / altRatio ~0.50)
    if (altRatio >= 0.58) return;
    const sunAlpha = Math.max(0, Math.min(1, (0.58 - altRatio) / 0.15));
    if (sunAlpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = sunAlpha;

    // Parallax position: sets smoothly towards horizon as player climbs into mid-mountain sunset
    const sunX = ((w * 0.72 - this.camPos.x * 0.7) % (w + 240) + (w + 240)) % (w + 240) - 120;
    const sunY = h * 0.18 + altRatio * (h * 0.44);

    const isSunset = altRatio >= 0.16;
    const tSunset = Math.min(1, Math.max(0, (altRatio - 0.16) / 0.3));

    // Outer soft glare square
    ctx.fillStyle = isSunset
      ? `rgba(249, 115, 22, ${0.2 + tSunset * 0.12})`
      : 'rgba(254, 240, 138, 0.22)';
    ctx.fillRect(sunX - 65, sunY - 65, 130, 130);

    // Middle corona square
    ctx.fillStyle = isSunset
      ? `rgba(234, 88, 12, ${0.45 + tSunset * 0.2})`
      : 'rgba(253, 224, 71, 0.45)';
    ctx.fillRect(sunX - 42, sunY - 42, 84, 84);

    // Iconic Minecraft stepped ray accents
    ctx.fillRect(sunX - 52, sunY - 14, 10, 28);
    ctx.fillRect(sunX + 42, sunY - 14, 10, 28);
    ctx.fillRect(sunX - 14, sunY - 52, 28, 10);
    ctx.fillRect(sunX - 14, sunY + 42, 28, 10);

    // Bright core square
    ctx.fillStyle = isSunset ? '#fed7aa' : '#fffef0';
    ctx.fillRect(sunX - 25, sunY - 25, 50, 50);

    // Minecraft square rim
    ctx.strokeStyle = isSunset ? '#ea580c' : '#fde047';
    ctx.lineWidth = 3;
    ctx.strokeRect(sunX - 25, sunY - 25, 50, 50);

    ctx.restore();
  }

  private drawMinecraftMoon(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number
  ) {
    // Moon rises during sunset (altRatio >= 0.28) and shines bright into space
    if (altRatio < 0.28) return;
    const moonAlpha = Math.max(0, Math.min(1, (altRatio - 0.28) / 0.18));
    if (moonAlpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = moonAlpha;

    // Parallax position: rises higher in the sky as player climbs into space
    const moonX = ((w * 0.24 - this.camPos.x * 0.5) % (w + 240) + (w + 240)) % (w + 240) - 120;
    const moonY = Math.max(h * 0.12, h * 0.32 - (altRatio - 0.28) * (h * 0.24));

    // Outer faint silver halo square
    ctx.fillStyle = 'rgba(186, 230, 253, 0.14)';
    ctx.fillRect(moonX - 55, moonY - 55, 110, 110);

    // Inner halo square
    ctx.fillStyle = 'rgba(224, 242, 254, 0.28)';
    ctx.fillRect(moonX - 36, moonY - 36, 72, 72);

    // Core square moon
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(moonX - 24, moonY - 24, 48, 48);

    // Minecraft square moon crater pixels
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(moonX - 16, moonY - 16, 12, 12);
    ctx.fillRect(moonX + 4, moonY - 12, 12, 10);

    ctx.fillStyle = '#64748b';
    ctx.fillRect(moonX - 10, moonY + 4, 14, 10);

    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(moonX + 6, moonY + 6, 8, 8);

    // Crisp rim
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(moonX - 24, moonY - 24, 48, 48);

    ctx.restore();
  }

  private drawMinecraftStars(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number,
    now: number
  ) {
    if (altRatio < 0.32) return;
    const starAlpha = Math.max(0, Math.min(1, (altRatio - 0.32) / 0.2));
    if (starAlpha <= 0.01) return;

    ctx.save();
    let currentFill = '';
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const twinkle = 0.55 + 0.45 * Math.sin(now * 0.003 * s.speed + s.phase);
      const sx = ((s.xRatio * w - this.camPos.x * 1.2) % w + w) % w;
      const sy = ((s.yRatio * h - (this.camPos.y - 110) * 0.8) % h + h) % h;
      if (currentFill !== s.color) {
        ctx.fillStyle = s.color;
        currentFill = s.color;
      }
      ctx.globalAlpha = starAlpha * s.baseAlpha * twinkle;
      const sz = Math.floor(s.size);
      ctx.fillRect(Math.floor(sx), Math.floor(sy), sz, sz);
    }
    ctx.restore();
  }

  private drawSpaceNebulaeAndSummitPlanet(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number
  ) {
    if (altRatio < 0.72) return;
    const cosmicAlpha = Math.max(0, Math.min(1, (altRatio - 0.72) / 0.16));
    if (cosmicAlpha <= 0.01) return;

    ctx.save();

    const n1x = w * 0.32;
    const n1y = h * 0.28;
    const n2x = w * 0.78;
    const n2y = h * 0.38;

    // Cache static radial gradients on resize or dimension change
    if (
      w !== this.lastNebulaW ||
      h !== this.lastNebulaH ||
      !this.nebula1Grad ||
      !this.nebula2Grad
    ) {
      const g1 = ctx.createRadialGradient(n1x, n1y, 10, n1x, n1y, 280);
      g1.addColorStop(0, 'rgba(168, 85, 247, 0.18)');
      g1.addColorStop(0.5, 'rgba(59, 130, 246, 0.09)');
      g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
      this.nebula1Grad = g1;

      const g2 = ctx.createRadialGradient(n2x, n2y, 10, n2x, n2y, 320);
      g2.addColorStop(0, 'rgba(236, 72, 153, 0.14)');
      g2.addColorStop(0.5, 'rgba(99, 102, 241, 0.07)');
      g2.addColorStop(1, 'rgba(0, 0, 0, 0)');
      this.nebula2Grad = g2;

      this.lastNebulaW = w;
      this.lastNebulaH = h;
    }

    // Cosmic Nebula 1
    ctx.globalAlpha = cosmicAlpha;
    ctx.fillStyle = this.nebula1Grad;
    ctx.fillRect(n1x - 280, n1y - 280, 560, 560);

    // Cosmic Nebula 2
    ctx.fillStyle = this.nebula2Grad;
    ctx.fillRect(n2x - 320, n2y - 320, 640, 640);

    // Iconic Minecraft Overworld Planet visible from the summit!
    if (altRatio >= 0.82) {
      const planetAlpha = Math.max(0, Math.min(1, (altRatio - 0.82) / 0.14));
      if (planetAlpha > 0.01) {
        const px = w * 0.82 - ((this.camPos.x * 0.3) % 80);
        const py = h * 0.68;

        ctx.globalAlpha = cosmicAlpha * planetAlpha;

        // Atmosphere aura
        ctx.fillStyle = 'rgba(96, 165, 250, 0.24)';
        ctx.fillRect(px - 28, py - 28, 56, 56);

        // Ocean globe base
        ctx.fillStyle = '#1d4ed8';
        ctx.fillRect(px - 22, py - 22, 44, 44);

        // Stepped Minecraft green continents
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(px - 16, py - 16, 16, 12);
        ctx.fillRect(px - 10, py - 4, 18, 14);
        ctx.fillRect(px + 4, py + 2, 12, 12);

        // Darker forest green accents
        ctx.fillStyle = '#15803d';
        ctx.fillRect(px - 12, py - 12, 8, 6);
        ctx.fillRect(px - 6, py + 2, 8, 6);

        // Voxel cloud swirls
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.fillRect(px - 20, py - 8, 18, 4);
        ctx.fillRect(px - 4, py + 8, 22, 4);
        ctx.fillRect(px + 6, py - 14, 12, 4);
      }
    }

    ctx.restore();
  }

  private drawVoxelClouds(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number,
    now: number
  ) {
    // Clouds vanish in space
    if (altRatio >= 0.82) return;
    const globalCloudAlpha = Math.max(0, Math.min(1, (0.82 - altRatio) / 0.15));
    if (globalCloudAlpha <= 0.01) return;

    ctx.save();

    // Determine cloud color scheme based on altitude
    let topColor: string;
    let bottomColor: string;

    if (altRatio < 0.18) {
      // Ground Day: Crisp white and cool silver shading
      topColor = `rgba(255, 255, 255, ${0.94 * globalCloudAlpha})`;
      bottomColor = `rgba(203, 213, 225, ${0.88 * globalCloudAlpha})`;
    } else if (altRatio < 0.5) {
      // Mid-mountain Sunset: Warm golden-peach highlight & twilight purple underside
      const t = (altRatio - 0.18) / 0.32;
      const topR = Math.round(lerp(255, 254, t));
      const topG = Math.round(lerp(255, 215, t));
      const topB = Math.round(lerp(255, 170, t));
      const botR = Math.round(lerp(203, 192, t));
      const botG = Math.round(lerp(213, 132, t));
      const botB = Math.round(lerp(225, 252, t));
      topColor = `rgba(${topR}, ${topG}, ${topB}, ${0.92 * globalCloudAlpha})`;
      bottomColor = `rgba(${botR}, ${botG}, ${botB}, ${0.85 * globalCloudAlpha})`;
    } else {
      // Upper-mountain Twilight: Indigo highlights & deep dusk underside
      const t = (altRatio - 0.5) / 0.32;
      const topR = Math.round(lerp(254, 99, t));
      const topG = Math.round(lerp(215, 102, t));
      const topB = Math.round(lerp(170, 241, t));
      const botR = Math.round(lerp(192, 30, t));
      const botG = Math.round(lerp(132, 27, t));
      const botB = Math.round(lerp(252, 75, t));
      topColor = `rgba(${topR}, ${topG}, ${topB}, ${0.75 * globalCloudAlpha})`;
      bottomColor = `rgba(${botR}, ${botG}, ${botB}, ${0.82 * globalCloudAlpha})`;
    }

    for (let i = 0; i < this.voxelClouds.length; i++) {
      const c = this.voxelClouds[i];
      const drift = now * 0.015 * c.speed;
      const cx =
        ((c.x + drift - this.camPos.x * (0.75 + c.speed * 0.35)) % (w + 480) + (w + 480)) %
          (w + 480) -
        240;

      // Vertical altitude placement: clouds sit at natural heights; climber climbs right through them!
      const relY = c.worldY - this.camPos.y;
      const cy = h * 0.45 - relY * 4.8;

      // Screen culling
      if (cy < -120 || cy > h + 120) continue;

      for (let j = 0; j < c.blocks.length; j++) {
        const b = c.blocks[j];
        const bx = cx + b.rx * c.scale;
        const by = cy + b.ry * c.scale;
        const bw = b.rw * c.scale;
        const bh = b.rh * c.scale;
        const topH = Math.floor(bh * 0.65);
        const botH = Math.ceil(bh * 0.35);

        // Top lit surface
        ctx.fillStyle = topColor;
        ctx.fillRect(bx, by, bw, topH);

        // Bottom shaded underside
        ctx.fillStyle = bottomColor;
        ctx.fillRect(bx, by + topH, bw, botH);
      }
    }

    ctx.restore();
  }

  private drawMinecraftDistantHills(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number
  ) {
    if (altRatio >= 0.35) return;
    const hillAlpha = Math.max(0, Math.min(1, (0.35 - altRatio) / 0.15));
    if (hillAlpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = hillAlpha;

    // Far Mountain Ridge (Stepped silhouette)
    const farFill = altRatio < 0.15 ? '#4b7bb5' : '#4a2260';
    ctx.fillStyle = farFill;
    const stepW1 = 48;
    const baseX1 = -((this.camPos.x * 0.3) % (stepW1 * 10));
    const baseY1 = h * 0.72 + altRatio * h * 0.4;
    for (let x = -stepW1 * 2; x < w + stepW1 * 2; x += stepW1) {
      const colIdx = Math.floor((x - baseX1) / stepW1);
      const stepH = 20 + Math.abs(Math.sin(colIdx * 1.3)) * 60 + ((colIdx % 3) * 16);
      ctx.fillRect(x, baseY1 - stepH, stepW1, h - (baseY1 - stepH));
    }

    // Near Mountain Ridge (Stepped Minecraft Oak / Green hills)
    const nearFill = altRatio < 0.15 ? '#235928' : '#31233d';
    ctx.fillStyle = nearFill;
    const stepW2 = 36;
    const baseX2 = -((this.camPos.x * 0.7) % (stepW2 * 10));
    const baseY2 = h * 0.84 + altRatio * h * 0.4;
    for (let x = -stepW2 * 2; x < w + stepW2 * 2; x += stepW2) {
      const colIdx = Math.floor((x - baseX2) / stepW2);
      const stepH = 15 + Math.abs(Math.cos(colIdx * 0.9)) * 45 + ((colIdx % 4) * 12);
      ctx.fillRect(x, baseY2 - stepH, stepW2, h - (baseY2 - stepH));
    }

    ctx.restore();
  }

  private drawGroundAmbientSunlight(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    altRatio: number,
    now: number
  ) {
    if (altRatio >= 0.16) return;
    const sporeAlpha = Math.max(0, (0.16 - altRatio) / 0.16);
    if (sporeAlpha <= 0.01) return;

    ctx.save();
    ctx.fillStyle = 'rgba(254, 240, 138, 0.45)';
    ctx.globalAlpha = sporeAlpha;
    for (let i = 0; i < 20; i++) {
      const sx = ((i * 179 + now * 0.02 - this.camPos.x * 3) % w + w) % w;
      const sy =
        ((i * 127 + Math.sin(now * 0.002 + i) * 20 - this.camPos.y * 3) % h + h) % h;
      ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, 2);
    }
    ctx.restore();
  }
}

