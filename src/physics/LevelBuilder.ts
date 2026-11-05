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
  public spawnPoint = { x: -12.5, y: 1.2 };
  public summitY = 47;

  constructor(private world: planck.World) {
    this.buildGettingOverItJungleMountain();
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
    const palette: Record<SurfaceMaterial, { fill: string; stroke: string; friction: number }> = {
      wood: { fill: '#5c2d0c', stroke: '#a16207', friction: 1.15 },
      rock: { fill: '#365314', stroke: '#65a30d', friction: 1.1 },
      metal: { fill: '#14532d', stroke: '#4ade80', friction: 1.3 },
      ice: { fill: '#115e59', stroke: '#2dd4bf', friction: 0.45 },
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
      wood: { fill: '#713f12', stroke: '#ca8a04', friction: 1.15 },
      rock: { fill: '#3f6212', stroke: '#84cc16', friction: 1.1 },
      metal: { fill: '#15803d', stroke: '#86efac', friction: 1.35 },
      ice: { fill: '#0f766e', stroke: '#5eead4', friction: 0.45 },
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
   * Builds a true Getting Over It style continuous mountain contour!
   * - NO closely-stacked floating platforms that trap or block the player!
   * - Instead, you climb along the OPEN EXTERIOR of a continuous hillside,
   *   giant tree trunks, boulders, and solid stepped temple blocks with 8m+ of open sky above!
   */
  private buildGettingOverItJungleMountain() {
    // =========================================================================
    // 1. BASE VALLEY & THE ICONIC STARTING TREE (0m -> 5m)
    // Just like Getting Over It: spawn on the left, vault over the dead tree,
    // and land on the solid rocky mountainside!
    // =========================================================================
    this.addBox('ground-floor', 0, -2.0, 52, 4.0, 0, 'rock');
    this.addBox('wall-left', -24, 24, 3, 56, 0, 'wood');
    this.addBox('wall-right', 24, 24, 3, 56, 0, 'wood');

    // Warm-up rock & The Starting Tree (100% open sky above it!)
    this.addCircle('start-boulder', -9.2, 0.5, 0.85, 'rock');
    this.addBox('start-tree-trunk', -6.6, 1.4, 1.1, 2.8, -6, 'wood');
    this.addBox('start-branch-low', -7.8, 2.2, 2.2, 0.45, 12, 'wood');
    this.addBox('start-branch-high', -5.2, 3.1, 2.5, 0.45, 10, 'wood');

    this.signposts.push({
      x: -12.5,
      y: 2.5,
      title: '🍌 1. A Árvore Inicial',
      subtitle: 'Enganche a banana por cima do galho e puxe para saltar para a montanha!',
    });

    // =========================================================================
    // 2. A ENCOSTA DE PEDRAS E RAÍZES (4m -> 15.5m)
    // Solid continuous stepped mountainside rising from left (-2m) to right (+17.5m).
    // Every block is solid down to the ground — NO gaps underneath to get stuck in,
    // and 10m of completely open sky above!
    // =========================================================================
    this.addBox('hill-step-1', -1.2, 1.8, 4.4, 3.6, 0, 'rock');
    this.addCircle('hill-boulder-1', 1.2, 4.0, 0.95, 'rock');

    this.addBox('hill-step-2', 3.8, 2.8, 4.4, 5.6, 0, 'rock');
    this.addCircle('hill-vine-1', 6.2, 6.0, 0.85, 'metal');

    this.addBox('hill-step-3', 8.6, 4.0, 4.4, 8.0, 0, 'wood');
    this.addCircle('hill-boulder-2', 11.0, 8.4, 0.95, 'rock');

    this.addBox('hill-step-4', 13.4, 5.2, 4.4, 10.4, 0, 'rock');
    this.addCircle('hill-vine-2', 15.8, 10.8, 0.85, 'metal');

    // Wide Right Ledge at the top of the first hillside (x = 16.5..22.5, top at y = 13.0)
    this.addBox('hill-top-right', 19.2, 6.5, 6.4, 13.0, 0, 'wood');

    this.addVineDecoration(-5.2, 3.1, 3.8, 5.6, 0.7);
    this.addVineDecoration(3.8, 5.6, 13.4, 10.4, 0.9);

    this.signposts.push({
      x: 3.8,
      y: 7.4,
      title: '⛰️ 2. Encosta Contínua da Selva',
      subtitle: 'Suba pela superfície da montanha — céu 100% livre acima de você!',
    });

    // =========================================================================
    // 3. O TRONCO GIGANTE CAÍDO & CIPÓS (13m -> 26.5m)
    // Wide 4.5m vertical opening on the right (x = 14..22), then a continuous
    // stepped giant tree trunk rising from right (x = 12) to left (x = -17).
    // =========================================================================
    // Big grippy vine knot in open air to swing up onto the Giant Trunk
    this.addCircle('turn-right-vine-1', 16.8, 15.0, 0.8, 'metal');
    this.addCircle('turn-right-vine-2', 14.2, 16.8, 0.8, 'metal');

    // Continuous Giant Fallen Trunk rising to the left (thick solid blocks with 9m clearance above Hill 1)
    this.addBox('trunk-slope-1', 10.2, 17.2, 4.8, 2.2, 0, 'wood');
    this.addCircle('trunk-knot-1', 7.4, 19.0, 0.85, 'metal');

    this.addBox('trunk-slope-2', 4.2, 19.2, 4.8, 2.6, 0, 'wood');
    this.addCircle('trunk-boulder-1', 1.2, 21.2, 0.9, 'rock');

    this.addBox('trunk-slope-3', -2.0, 21.2, 4.8, 3.0, 0, 'wood');
    this.addCircle('trunk-knot-2', -5.0, 23.4, 0.85, 'metal');

    this.addBox('trunk-slope-4', -8.4, 23.2, 4.8, 3.4, 0, 'rock');
    this.addCircle('trunk-knot-3', -11.4, 25.5, 0.85, 'metal');

    // Wide Left Rest Ledge at x = -16.5 (top at y = 26.8)
    this.addBox('trunk-top-left', -16.8, 24.8, 7.2, 4.0, 0, 'wood');

    this.addVineDecoration(10.2, 16.2, -2.0, 20.0, 1.1);
    this.addVineDecoration(-2.0, 20.0, -16.8, 23.0, 1.1);

    this.signposts.push({
      x: 4.2,
      y: 22.3,
      title: '🌴 3. O Tronco Gigante',
      subtitle: 'Use os nós de cipó verdes como alavanca para avançar pelo tronco!',
    });

    // =========================================================================
    // 4. ESCADARIA DO TEMPLO MACACO (26.8m -> 39.5m)
    // Wide 4.5m vertical opening on the left, leading onto a solid stepped
    // jungle temple pyramid rising from left (x = -10) to right (x = +14).
    // =========================================================================
    this.addCircle('turn-left-vine-1', -14.2, 28.8, 0.8, 'metal');
    this.addCircle('turn-left-vine-2', -11.4, 30.6, 0.8, 'metal');

    // Stepped Temple Pyramid (solid steps, open sky above)
    this.addBox('temple-step-1', -7.4, 31.0, 4.8, 2.2, 0, 'rock');
    this.addCircle('temple-knot-1', -4.4, 32.8, 0.85, 'metal');

    this.addBox('temple-step-2', -1.2, 33.0, 4.8, 2.6, 0, 'rock');
    this.addCircle('temple-knot-2', 1.8, 35.0, 0.85, 'metal');

    this.addBox('temple-step-3', 5.0, 35.2, 4.8, 3.0, 0, 'rock');
    this.addCircle('temple-knot-3', 8.0, 37.4, 0.85, 'metal');

    // Wide Right Temple Terrace (top at y = 39.2)
    this.addBox('temple-top-right', 12.6, 37.2, 6.4, 4.0, 0, 'wood');

    this.addVineDecoration(-7.4, 30.0, 5.0, 34.0, 1.0);

    this.signposts.push({
      x: -1.2,
      y: 36.2,
      title: '🗿 4. Pirâmide do Templo da Selva',
      subtitle: 'Degraus sólidos de pedra musgosa — enganche e puxe sem medo de entalar!',
    });

    // =========================================================================
    // 5. ALTAR DA BANANA DOURADA (39.5m -> 47m)
    // Open sky vine-ring climb to the final Golden Banana Summit!
    // =========================================================================
    this.addCircle('final-vine-1', 9.6, 41.2, 0.85, 'metal');
    this.addCircle('final-vine-2', 6.8, 43.0, 0.85, 'metal');
    this.addCircle('final-vine-3', 4.0, 44.8, 0.85, 'metal');

    // Golden Banana Summit Platform at 46.5m!
    this.addBox('summit-platform', -1.0, 46.2, 8.5, 1.6, 0, 'metal', 'ALTAR DA BANANA DOURADA');
    this.addCircle('summit-trophy', -1.0, 47.9, 0.9, 'wood');

    this.addVineDecoration(12.6, 37.2, -1.0, 45.4, 1.2);

    this.signposts.push({
      x: -1.0,
      y: 49.8,
      title: '👑 TOPO DA FLORESTA (47m)',
      subtitle: 'GG! O Macaco Skibidi conquistou o Altar da Banana Dourada!',
    });
  }
}
