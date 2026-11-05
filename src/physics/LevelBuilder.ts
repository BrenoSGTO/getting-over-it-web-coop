import * as planck from 'planck-js';

export type SurfaceMaterial = 'rock' | 'wood' | 'metal' | 'ice';

export interface TerrainBlock {
  id: string;
  label?: string;
  material: SurfaceMaterial;
  color: string;
  strokeColor: string;
  /** Vertices in local space around (x, y) or box/circle definition */
  shapeType: 'polygon' | 'box' | 'circle';
  x: number;
  y: number;
  angle?: number;
  width?: number;
  height?: number;
  radius?: number;
  vertices?: { x: number; y: number }[];
  friction: number;
}

export interface Signpost {
  x: number;
  y: number;
  title: string;
  subtitle: string;
}

export class LevelBuilder {
  public blocks: TerrainBlock[] = [];
  public signposts: Signpost[] = [];
  public spawnPoint = { x: 0, y: 1.5 };
  public summitY = 62;

  constructor(private world: planck.World) {
    this.buildValidationMountain();
  }

  private addBox(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    angleDeg = 0,
    material: SurfaceMaterial = 'rock',
    label?: string
  ) {
    const palette: Record<SurfaceMaterial, { fill: string; stroke: string; friction: number }> = {
      rock: { fill: '#334155', stroke: '#64748b', friction: 0.95 },
      wood: { fill: '#78350f', stroke: '#b45309', friction: 0.85 },
      metal: { fill: '#1e293b', stroke: '#38bdf8', friction: 0.7 },
      ice: { fill: '#0ea5e9', stroke: '#bae6fd', friction: 0.12 },
    };
    const style = palette[material];
    const angle = (angleDeg * Math.PI) / 180;

    const body = this.world.createBody({
      type: 'static',
      position: planck.Vec2(x, y),
      angle,
    });

    const fixture = body.createFixture(planck.Box(width / 2, height / 2), {
      friction: style.friction,
      restitution: 0.0,
      filterCategoryBits: 0x0001,
    });
    fixture.setUserData({ isTerrain: true, material, id });

    this.blocks.push({
      id,
      label,
      material,
      color: style.fill,
      strokeColor: style.stroke,
      shapeType: 'box',
      x,
      y,
      angle,
      width,
      height,
      friction: style.friction,
    });
  }

  private addCircle(
    id: string,
    x: number,
    y: number,
    radius: number,
    material: SurfaceMaterial = 'rock'
  ) {
    const palette: Record<SurfaceMaterial, { fill: string; stroke: string; friction: number }> = {
      rock: { fill: '#475569', stroke: '#94a3b8', friction: 0.95 },
      wood: { fill: '#78350f', stroke: '#d97706', friction: 0.85 },
      metal: { fill: '#0f172a', stroke: '#f59e0b', friction: 0.8 },
      ice: { fill: '#0284c7', stroke: '#e0f2fe', friction: 0.1 },
    };
    const style = palette[material];

    const body = this.world.createBody({
      type: 'static',
      position: planck.Vec2(x, y),
    });

    const fixture = body.createFixture(planck.Circle(radius), {
      friction: style.friction,
      restitution: 0.0,
      filterCategoryBits: 0x0001,
    });
    fixture.setUserData({ isTerrain: true, material, id });

    this.blocks.push({
      id,
      material,
      color: style.fill,
      strokeColor: style.stroke,
      shapeType: 'circle',
      x,
      y,
      radius,
      friction: style.friction,
    });
  }

  private buildValidationMountain() {
    // =====================================================
    // BASE FLOOR & SPAWN VALLEY (0m - 5m)
    // =====================================================
    this.addBox('ground-main', 0, -1.5, 42, 3, 0, 'rock');
    this.addBox('wall-left-bound', -20, 12, 3, 30, 0, 'rock');
    this.addBox('wall-right-bound', 20, 12, 3, 30, 0, 'rock');

    // Starting Tree / Dead Branch (Classic Getting Over It warm-up)
    this.addCircle('start-boulder-1', 3.2, 0.4, 0.95, 'rock');
    this.addBox('start-trunk', 5.2, 1.8, 1.1, 3.8, -12, 'wood');
    this.addBox('start-branch-left', 3.6, 3.3, 2.8, 0.45, 16, 'wood');
    this.addBox('start-branch-right', 7.2, 4.1, 3.2, 0.45, 12, 'wood');
    this.addCircle('start-knot', 8.8, 4.5, 0.65, 'wood');

    this.signposts.push({
      x: 0,
      y: 2.2,
      title: '1. A Árvore Seca',
      subtitle: 'Enganche a marreta no galho e puxe o mouse para baixo',
    });

    // =====================================================
    // SECTION 2: THE ROCK STEPS & CHIMNEY (5m - 18m)
    // =====================================================
    this.addBox('ledge-1', 11.5, 5.2, 4.5, 1.2, 0, 'rock');
    this.addCircle('boulder-step-1', 13.5, 6.2, 1.1, 'rock');
    this.addBox('chimney-right', 15.2, 10.5, 1.4, 8.5, 0, 'rock');
    this.addBox('chimney-left', 11.4, 11.2, 1.3, 6.8, 0, 'rock');
    // Small pegs inside the chimney for hammer leverage
    this.addCircle('chimney-peg-1', 14.3, 8.2, 0.45, 'metal');
    this.addCircle('chimney-peg-2', 12.2, 10.4, 0.45, 'metal');
    this.addCircle('chimney-peg-3', 14.3, 12.6, 0.45, 'metal');

    this.addBox('chimney-exit-plat', 9.2, 14.5, 4.8, 1.1, 0, 'rock');

    this.signposts.push({
      x: 13.3,
      y: 7.0,
      title: '2. A Chaminé do Diógenes',
      subtitle: 'Alterne a marreta entre os pinos de metal ou dê um pogo jump!',
    });

    // =====================================================
    // SECTION 3: THE CONSTRUCTION CRANE & OARS (15m - 30m)
    // =====================================================
    this.addBox('beam-1', 4.8, 16.5, 4.2, 0.55, -14, 'metal');
    this.addCircle('gear-1', 1.8, 18.2, 0.9, 'metal');
    this.addBox('beam-2', -2.0, 20.0, 4.6, 0.55, -15, 'metal');
    this.addCircle('gear-2', -5.2, 21.8, 0.85, 'metal');
    this.addBox('crane-rest', -8.8, 23.0, 4.2, 1.0, 0, 'wood');

    // Vertical Hook Climb
    this.addBox('pillar-left', -11.5, 27.5, 1.2, 8.5, 0, 'rock');
    this.addBox('hook-1', -9.8, 25.5, 1.8, 0.4, 8, 'metal');
    this.addBox('hook-2', -7.2, 27.8, 2.0, 0.4, -10, 'metal');
    this.addBox('hook-3', -9.6, 30.2, 2.0, 0.4, 8, 'metal');
    this.addBox('plat-32', -5.0, 32.0, 4.8, 1.1, 0, 'rock');

    this.signposts.push({
      x: 2.0,
      y: 19.8,
      title: '3. Vigas Metálicas',
      subtitle: 'Cuidado para não escorregar de volta para a base!',
    });

    // =====================================================
    // SECTION 4: ORANGE HELL / THE ANVIL CLIFF (32m - 48m)
    // =====================================================
    this.addCircle('orange-rock-1', -1.2, 33.8, 1.15, 'rock');
    this.addCircle('orange-rock-2', 2.2, 35.8, 1.05, 'rock');
    this.addCircle('orange-rock-3', 5.6, 38.0, 1.1, 'rock');
    this.addBox('anvil-ledge', 9.2, 40.2, 3.6, 0.9, 0, 'metal');

    // Steep Ice Slope + Rock Grips
    this.addBox('ice-slope', 5.0, 44.0, 6.5, 0.7, -32, 'ice');
    this.addCircle('ice-saver-knob', 7.4, 43.2, 0.48, 'metal');
    this.addCircle('ice-top-knob', 2.2, 46.5, 0.65, 'rock');
    this.addBox('pre-summit-ledge', -1.5, 48.0, 4.5, 1.1, 0, 'wood');

    this.signposts.push({
      x: 9.2,
      y: 41.8,
      title: '4. Penhasco & Rampa de Gelo',
      subtitle: 'O gelo quase não tem atrito — use os pinos de ferro!',
    });

    // =====================================================
    // SECTION 5: FINAL GAUNTLET & GOLDEN SUMMIT (48m - 62m)
    // =====================================================
    this.addCircle('final-step-1', -4.8, 50.4, 0.75, 'rock');
    this.addCircle('final-step-2', -2.2, 53.0, 0.7, 'metal');
    this.addCircle('final-step-3', 0.8, 55.6, 0.7, 'metal');
    this.addCircle('final-step-4', -1.5, 58.4, 0.75, 'rock');

    // Summit Crown Platform
    this.addBox('summit-platform', 0, 61.5, 8.0, 1.4, 0, 'metal', 'TOPO DA MONTANHA');
    this.addCircle('summit-trophy', 0, 63.0, 0.8, 'metal');

    this.signposts.push({
      x: 0,
      y: 64.5,
      title: '🏆 TOPO DA MONTANHA (62m)',
      subtitle: 'Parabéns! Você dominou a física original do Getting Over It!',
    });
  }
}
