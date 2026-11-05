import * as planck from 'planck-js';

export type SurfaceMaterial = 'rock' | 'wood' | 'metal' | 'ice';

export interface TerrainBlock {
  id: string;
  label?: string;
  material: SurfaceMaterial;
  color: string;
  strokeColor: string;
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

export interface HangingVine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sag: number;
}

export class LevelBuilder {
  public blocks: TerrainBlock[] = [];
  public signposts: Signpost[] = [];
  public decorativeVines: HangingVine[] = [];
  public spawnPoint = { x: 0, y: 1.2 };
  public summitY = 48;

  constructor(private world: planck.World) {
    this.buildJungleMountain();
  }

  private addBox(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    angleDeg = 0,
    material: SurfaceMaterial = 'wood',
    label?: string
  ) {
    // Jungle & Vines color palette:
    // - wood: Giant Jungle Tree Branches & Roots
    // - rock: Mossy Jungle Temple Stones
    // - metal: Thick Braided Vines & Bamboo Grips (High friction!)
    // - ice: Wet Mossy Log (Moderate slip)
    const palette: Record<SurfaceMaterial, { fill: string; stroke: string; friction: number }> = {
      wood: { fill: '#5c2d0c', stroke: '#a16207', friction: 1.1 },
      rock: { fill: '#365314', stroke: '#65a30d', friction: 1.05 },
      metal: { fill: '#14532d', stroke: '#4ade80', friction: 1.25 },
      ice: { fill: '#115e59', stroke: '#2dd4bf', friction: 0.42 },
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
    material: SurfaceMaterial = 'metal'
  ) {
    const palette: Record<SurfaceMaterial, { fill: string; stroke: string; friction: number }> = {
      wood: { fill: '#713f12', stroke: '#ca8a04', friction: 1.1 },
      rock: { fill: '#3f6212', stroke: '#84cc16', friction: 1.05 },
      metal: { fill: '#15803d', stroke: '#86efac', friction: 1.3 },
      ice: { fill: '#0f766e', stroke: '#5eead4', friction: 0.42 },
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

  private addVineDecoration(x1: number, y1: number, x2: number, y2: number, sag = 0.8) {
    this.decorativeVines.push({ x1, y1, x2, y2, sag });
  }

  /**
   * Builds a well-paced, 100% completable Jungle & Vines map (0m -> 48m)
   * Every step is spaced 1.3m - 1.9m apart (well within the 2.85m Banana Pickaxe reach),
   * with wide safety branches at each section so slips don't reset all progress.
   */
  private buildJungleMountain() {
    // =====================================================
    // SECTION 1: RAÍZES DA GRANDE FIGUEIRA (0m - 10m)
    // Gentle staircase of mossy stones and thick tree roots
    // =====================================================
    this.addBox('jungle-floor', 0, -1.5, 46, 3, 0, 'rock');
    this.addBox('wall-left', -21, 24, 3, 56, 0, 'wood');
    this.addBox('wall-right', 21, 24, 3, 56, 0, 'wood');

    // Easy warm-up steps to the right (each ~1.3m higher, ~1.8m horizontally)
    this.addBox('root-step-1', 2.4, 0.5, 2.4, 0.7, 5, 'wood');
    this.addBox('root-step-2', 4.6, 1.7, 2.5, 0.7, 6, 'wood');
    this.addCircle('vine-knot-1', 6.6, 3.0, 0.65, 'metal');
    this.addBox('branch-1', 8.8, 4.2, 3.4, 0.75, 4, 'wood');
    this.addCircle('vine-knot-2', 11.0, 5.6, 0.65, 'metal');
    this.addBox('branch-2', 9.0, 7.2, 3.6, 0.75, -5, 'wood');
    this.addCircle('vine-knot-3', 6.6, 8.6, 0.65, 'metal');

    // Wide Safety Terrace 1 at 10m!
    this.addBox('terrace-1', 3.0, 10.0, 5.8, 0.95, 0, 'wood');

    this.addVineDecoration(2.4, 0.5, 6.6, 3.0, 0.6);
    this.addVineDecoration(6.6, 3.0, 11.0, 5.6, 0.7);
    this.addVineDecoration(11.0, 5.6, 6.6, 8.6, 0.8);

    this.signposts.push({
      x: 0,
      y: 2.3,
      title: '🍌 1. Raízes da Selva',
      subtitle: 'Enganche a Picareta de Banana nos galhos e nós de cipó verdes!',
    });

    // =====================================================
    // SECTION 2: PONTES DE CIPÓ (10m - 20m)
    // Vine knots & wide jungle branches heading left
    // =====================================================
    this.addCircle('vine-bridge-1', -0.2, 11.4, 0.7, 'metal');
    this.addBox('jungle-limb-1', -2.8, 12.8, 3.4, 0.75, -6, 'wood');
    this.addCircle('vine-bridge-2', -5.2, 14.3, 0.7, 'metal');
    this.addBox('jungle-limb-2', -7.8, 15.8, 3.6, 0.75, -4, 'wood');
    this.addCircle('vine-bridge-3', -5.6, 17.4, 0.7, 'metal');
    this.addCircle('vine-bridge-4', -3.4, 18.8, 0.7, 'metal');

    // Wide Safety Terrace 2 at 20m!
    this.addBox('terrace-2', 0.2, 20.2, 6.2, 0.95, 0, 'rock');

    this.addVineDecoration(3.0, 10.0, -2.8, 12.8, 0.9);
    this.addVineDecoration(-2.8, 12.8, -7.8, 15.8, 0.9);
    this.addVineDecoration(-7.8, 15.8, 0.2, 20.2, 1.1);

    this.signposts.push({
      x: 3.0,
      y: 11.8,
      title: '🌿 2. Cipós da Macacada',
      subtitle: 'Os nós de cipó verdes têm super aderência para puxar a privada!',
    });

    // =====================================================
    // SECTION 3: COPA DAS ÁRVORES GIGANTES (20m - 30m)
    // Lush canopy platforms & vine rings heading right
    // =====================================================
    this.addBox('canopy-step-1', 3.8, 21.6, 3.2, 0.75, 6, 'wood');
    this.addCircle('canopy-vine-1', 6.2, 23.1, 0.7, 'metal');
    this.addBox('canopy-step-2', 8.6, 24.6, 3.4, 0.75, 4, 'wood');
    this.addCircle('canopy-vine-2', 6.4, 26.2, 0.7, 'metal');
    this.addBox('canopy-step-3', 3.8, 27.7, 3.4, 0.75, -5, 'wood');
    this.addCircle('canopy-vine-3', 1.4, 29.1, 0.7, 'metal');

    // Wide Safety Terrace 3 at 30.5m!
    this.addBox('terrace-3', -2.2, 30.5, 6.2, 0.95, 0, 'wood');

    this.addVineDecoration(0.2, 20.2, 8.6, 24.6, 1.2);
    this.addVineDecoration(8.6, 24.6, -2.2, 30.5, 1.2);

    this.signposts.push({
      x: 0.2,
      y: 22.0,
      title: '🌴 3. Copa da Figueira',
      subtitle: 'Use os terraços largos para descansar ou puxar seu amigo no Co-op!',
    });

    // =====================================================
    // SECTION 4: TEMPLO MUSGOSO DA SELVA (30.5m - 40m)
    // Ancient mossy stone steps + wet log + vine hooks
    // =====================================================
    this.addBox('temple-step-1', -5.8, 32.0, 3.0, 0.8, 0, 'rock');
    this.addCircle('temple-vine-1', -8.0, 33.5, 0.7, 'metal');
    this.addBox('temple-step-2', -5.8, 35.1, 3.2, 0.8, 0, 'rock');
    // Gentle wet mossy log with a big vine knot right above it for easy grip
    this.addBox('wet-moss-log', -2.6, 36.6, 3.6, 0.7, 12, 'ice');
    this.addCircle('saver-vine-knot', -2.4, 38.0, 0.72, 'metal');
    this.addCircle('temple-vine-2', 0.0, 39.2, 0.7, 'metal');

    // Wide Safety Terrace 4 at 40.5m!
    this.addBox('terrace-4', 3.4, 40.5, 6.0, 0.95, 0, 'rock');

    this.addVineDecoration(-2.2, 30.5, -8.0, 33.5, 0.9);
    this.addVineDecoration(-5.8, 35.1, 3.4, 40.5, 1.1);

    this.signposts.push({
      x: -2.2,
      y: 32.3,
      title: '🗿 4. Ruínas do Templo Musgoso',
      subtitle: 'Enganche no nó de cipó acima do tronco úmido para subir fácil!',
    });

    // =====================================================
    // SECTION 5: ALTAR DA BANANA DOURADA (40.5m - 48m)
    // Final triumphant vine staircase to the Golden Banana Summit
    // =====================================================
    this.addCircle('final-vine-1', 5.8, 42.0, 0.72, 'metal');
    this.addBox('final-branch-1', 3.6, 43.5, 3.4, 0.75, -5, 'wood');
    this.addCircle('final-vine-2', 1.4, 45.0, 0.72, 'metal');
    this.addCircle('final-vine-3', -0.6, 46.5, 0.72, 'metal');

    // Golden Banana Summit Platform at 48m!
    this.addBox('summit-platform', 0, 48.0, 9.0, 1.3, 0, 'metal', 'ALTAR DA BANANA DOURADA');
    this.addCircle('summit-trophy', 0, 49.5, 0.85, 'wood');

    this.addVineDecoration(3.4, 40.5, 5.8, 42.0, 0.5);
    this.addVineDecoration(3.6, 43.5, 0, 48.0, 0.8);

    this.signposts.push({
      x: 0,
      y: 51.2,
      title: '👑 TOPO DA FLORESTA (48m)',
      subtitle: 'GG! O Macaco Skibidi conquistou o Altar da Banana Dourada!',
    });
  }
}
