import * as planck from 'planck-js';
import { ORIGINAL_GOI_POLYS, ORIGINAL_GOI_CIRCLES } from './OriginalLevelData';

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
  worldVerts?: { x: number; y: number }[];
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
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
  public blocksById: Map<string, TerrainBlock> = new Map();
  public signposts: Signpost[] = [];
  public decorativeVines: HangingVine[] = [];
  // Exact Getting Over It spawn point shifted so (-44.2926, -2.4218) -> (0, 1.2)
  public spawnPoint = { x: 0, y: 1.2 };
  public summitY = 362;

  private readonly palette: Record<
    SurfaceMaterial,
    { fill: string; stroke: string; friction: number }
  > = {
    wood: { fill: '#5c2d0c', stroke: '#a16207', friction: 1.18 },
    rock: { fill: '#365314', stroke: '#65a30d', friction: 1.15 },
    metal: { fill: '#14532d', stroke: '#4ade80', friction: 1.3 },
    ice: { fill: '#115e59', stroke: '#2dd4bf', friction: 0.45 },
  };

  constructor(private world: planck.World) {
    this.buildReverseEngineeredOriginalMap();
  }

  private addPolygonChain(
    id: string,
    flatCoords: number[],
    material: SurfaceMaterial = 'rock',
    label?: string
  ) {
    if (flatCoords.length < 6) return;
    const style = this.palette[material];

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const worldVerts: planck.Vec2[] = [];
    for (let i = 0; i < flatCoords.length; i += 2) {
      const vx = flatCoords[i];
      const vy = flatCoords[i + 1];
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;
      worldVerts.push(planck.Vec2(vx, vy));
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const width = maxX - minX;
    const height = maxY - minY;

    const body = this.world.createBody({
      type: 'static',
      position: planck.Vec2(0, 0),
    });

    const fixture = body.createFixture(planck.Chain(worldVerts, true), {
      friction: style.friction,
      restitution: 0.0,
      filterCategoryBits: 0x0001,
    });
    fixture.setUserData({ isTerrain: true, material, id });

    // Store vertices relative to (cx, cy) so GameRenderer can translate(b.x, b.y) and cull cleanly
    const localVerts = worldVerts.map((v) => ({ x: v.x - cx, y: v.y - cy }));
    const worldVertsData = worldVerts.map((v) => ({ x: v.x, y: v.y }));

    const block: TerrainBlock = {
      id,
      label,
      material,
      color: style.fill,
      strokeColor: style.stroke,
      shapeType: 'polygon',
      x: cx,
      y: cy,
      width,
      height,
      minX,
      maxX,
      minY,
      maxY,
      vertices: localVerts,
      worldVerts: worldVertsData,
      friction: style.friction,
    };
    this.blocks.push(block);
    this.blocksById.set(id, block);
  }

  private addCircle(
    id: string,
    x: number,
    y: number,
    radius: number,
    material: SurfaceMaterial = 'metal',
    label?: string
  ) {
    const style = this.palette[material];

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

    const block: TerrainBlock = {
      id,
      label,
      material,
      color: style.fill,
      strokeColor: style.stroke,
      shapeType: 'circle',
      x,
      y,
      width: radius * 2,
      height: radius * 2,
      radius,
      minX: x - radius,
      maxX: x + radius,
      minY: y - radius,
      maxY: y + radius,
      friction: style.friction,
    };
    this.blocks.push(block);
    this.blocksById.set(id, block);
  }

  public getBlockById(id: string): TerrainBlock | undefined {
    return this.blocksById.get(id);
  }

  /**
   * Fast spatial containment check using AABB broadphase + Ray-casting Jordan Curve Theorem.
   * Returns true if (px, py) is strictly inside this terrain block.
   */
  public isPointInsideBlock(px: number, py: number, block: TerrainBlock): boolean {
    if (
      block.minX === undefined ||
      px < block.minX ||
      px > block.maxX! ||
      py < block.minY! ||
      py > block.maxY!
    ) {
      return false;
    }

    if (block.shapeType === 'circle' && block.radius) {
      const dx = px - block.x;
      const dy = py - block.y;
      return dx * dx + dy * dy < block.radius * block.radius;
    }

    if (block.shapeType === 'polygon' && block.worldVerts && block.worldVerts.length >= 3) {
      let inside = false;
      const verts = block.worldVerts;
      const n = verts.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = verts[i].x;
        const yi = verts[i].y;
        const xj = verts[j].x;
        const yj = verts[j].y;
        const intersect =
          yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    }

    return false;
  }

  /**
   * Returns the first TerrainBlock that contains the point (px, py), or null if in open air.
   */
  public getContainingBlock(px: number, py: number): TerrainBlock | null {
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (this.isPointInsideBlock(px, py, b)) {
        return b;
      }
    }
    return null;
  }

  private addVineDecoration(x1: number, y1: number, x2: number, y2: number, sag = 0.9) {
    this.decorativeVines.push({ x1, y1, x2, y2, sag });
  }

  /**
   * Builds the authentic reverse-engineered Getting Over It level geometry
   * extracted directly from GettingOverIt_Data/level1 (284 Polygon/Box colliders + 10 Circle colliders).
   */
  private buildReverseEngineeredOriginalMap() {
    for (let i = 0; i < ORIGINAL_GOI_POLYS.length; i++) {
      const poly = ORIGINAL_GOI_POLYS[i];
      this.addPolygonChain(`goi-poly-${i}-${poly.n}`, poly.p, poly.m, poly.n);
    }

    for (let i = 0; i < ORIGINAL_GOI_CIRCLES.length; i++) {
      const c = ORIGINAL_GOI_CIRCLES[i];
      this.addCircle(`goi-circle-${i}-${c.n}`, c.x, c.y, c.r, c.m, c.n);
    }

    // Add decorative jungle vines along iconic sections of the original map
    this.addVineDecoration(14.5, 4.5, 25.5, 4.2, 0.8);
    this.addVineDecoration(28.0, 7.5, 45.0, 8.5, 1.2);
    this.addVineDecoration(46.0, 14.0, 36.0, 22.0, 1.1);
    this.addVineDecoration(34.0, 28.0, 48.0, 38.0, 1.3);
    this.addVineDecoration(52.0, 58.0, 66.0, 72.0, 1.4);

    // Helpful signposts at iconic Getting Over It landmarks
    this.signposts.push({
      x: 4.5,
      y: 3.2,
      title: '🍌 Mapa Original (Getting Over It)',
      subtitle: 'Extraído via Engenharia Reversa! Siga para a direita até a Árvore Inicial ->',
    });

    this.signposts.push({
      x: 15.8,
      y: 9.6,
      title: '🌳 A Árvore Inicial (Deadtree)',
      subtitle: 'Enganche a picareta de banana no galho e impulsione para as pedras!',
    });

    this.signposts.push({
      x: 44.5,
      y: 11.2,
      title: '🚣 Os Remos & Devil’s Chimney',
      subtitle: 'Use os remos para entrar na chaminé de pedra exatamente como no original!',
    });

    this.signposts.push({
      x: 106.0,
      y: 363.5,
      title: '📡 Torre de Rádio & Espaço (362m)',
      subtitle: 'GG! Você zerou o mapa original completo do Getting Over It!',
    });
  }
}
