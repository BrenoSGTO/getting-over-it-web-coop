const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const toCrc = Buffer.concat([typeBuf, data]);
  const crc = zlib.crc32(toCrc);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([lenBuf, toCrc, crcBuf]);
}

function encodePNG(width, height, rgbaBuffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression deflate
  ihdr[11] = 0; // filter none
  ihdr[12] = 0; // interlace none
  const ihdrChunk = makeChunk('IHDR', ihdr);

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    scanlines[offset++] = 0; // filter 0 (None)
    rgbaBuffer.copy(scanlines, offset, y * width * 4, (y + 1) * width * 4);
    offset += width * 4;
  }
  const idatChunk = makeChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 }));
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function hexToRgba(hex) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return [r, g, b, 255];
}

// Generates a 32x32 crisp pixel-art texture by scaling 16x16 grid (2x2 pixels each)
// to preserve sharp pixel edges in Canvas2D pattern rendering.
function createTextureBuffer32(palette, patternGrid16) {
  const scale = 2;
  const size = 16 * scale; // 32x32
  const buf = Buffer.alloc(size * size * 4);

  for (let y16 = 0; y16 < 16; y16++) {
    for (let x16 = 0; x16 < 16; x16++) {
      const idx = patternGrid16[y16][x16];
      const colorHex = palette[idx];
      const [r, g, b, a] = hexToRgba(colorHex);

      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const y = y16 * scale + dy;
          const x = x16 * scale + dx;
          const offset = (y * size + x) * 4;
          buf[offset] = r;
          buf[offset + 1] = g;
          buf[offset + 2] = b;
          buf[offset + 3] = a;
        }
      }
    }
  }
  return buf;
}

// -----------------------------------------------------------------------------
// 1. ROCK: Authentic Minecraft Stone / Cobblestone (32x32 pixel art from 16x16)
// Crisp palette featuring requested shades: #737373, #848484, #5a5a5a, #6b6b6b
// -----------------------------------------------------------------------------
const rockPalette = [
  '#3a3a3a', // 0: deep mortar seam
  '#4a4a4a', // 1: crevice shadow
  '#5a5a5a', // 2: dark stone shade (requested)
  '#6b6b6b', // 3: stone shadow midtone (requested)
  '#737373', // 4: classic stone base (requested)
  '#848484', // 5: light stone face (requested)
  '#969696', // 6: highlight stone
  '#a8a8a8', // 7: brightest stone fleck
];

const rockGrid = [
  [6, 5, 4, 3, 2, 0, 1, 4, 5, 6, 5, 4, 1, 0, 3, 5],
  [5, 7, 5, 4, 1, 0, 4, 6, 7, 5, 4, 3, 0, 2, 4, 6],
  [4, 5, 4, 2, 0, 1, 5, 5, 6, 4, 3, 1, 0, 3, 5, 5],
  [3, 3, 1, 0, 2, 4, 4, 3, 2, 1, 0, 0, 1, 4, 6, 4],
  [1, 0, 0, 3, 5, 6, 5, 2, 0, 1, 3, 4, 3, 2, 1, 0],
  [3, 1, 2, 5, 7, 6, 4, 1, 0, 3, 5, 6, 5, 4, 2, 1],
  [4, 3, 4, 6, 5, 4, 2, 0, 1, 4, 6, 7, 6, 4, 3, 2],
  [5, 4, 3, 2, 1, 0, 0, 2, 4, 5, 5, 6, 4, 2, 1, 0],
  [2, 1, 0, 1, 3, 4, 3, 1, 0, 2, 3, 2, 1, 0, 2, 4],
  [1, 0, 3, 5, 6, 5, 4, 2, 0, 1, 0, 1, 3, 5, 6, 5],
  [0, 2, 5, 7, 6, 4, 3, 1, 0, 3, 4, 5, 6, 7, 5, 4],
  [1, 4, 6, 5, 4, 2, 0, 0, 2, 4, 6, 6, 5, 4, 2, 1],
  [3, 5, 4, 3, 1, 0, 1, 3, 5, 6, 5, 4, 2, 1, 0, 2],
  [4, 3, 2, 0, 0, 2, 4, 6, 7, 5, 3, 1, 0, 1, 3, 4],
  [2, 1, 0, 1, 3, 5, 6, 5, 4, 2, 0, 0, 2, 4, 5, 3],
  [1, 0, 2, 4, 5, 4, 3, 1, 0, 1, 2, 3, 4, 3, 2, 1],
];

// -----------------------------------------------------------------------------
// 2. WOOD: Authentic Minecraft Oak Wood / Planks (32x32 pixel art from 16x16)
// Crisp palette featuring requested shades: #b8874c, #966c36, #795428
// -----------------------------------------------------------------------------
const woodPalette = [
  '#4a3318', // 0: dark plank groove separator
  '#62431f', // 1: grain crease / knot
  '#795428', // 2: deep oak shadow (requested)
  '#966c36', // 3: warm oak midtone (requested)
  '#a8783d', // 4: classic oak body
  '#b8874c', // 5: light oak plank face (requested)
  '#caa05e', // 6: plank bevel highlight
  '#3d2712', // 7: nail / bark speckle
];

const woodGrid = [
  // Plank 1 (vertical seam at col 11)
  [6, 6, 5, 6, 6, 5, 6, 5, 6, 6, 5, 1, 6, 6, 5, 6],
  [5, 5, 4, 5, 5, 4, 5, 4, 5, 5, 4, 0, 5, 5, 4, 5],
  [4, 7, 3, 4, 4, 3, 4, 3, 7, 4, 3, 0, 4, 4, 3, 4],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  // Plank 2 (vertical seam at col 4)
  [6, 5, 6, 6, 1, 6, 6, 5, 6, 6, 5, 6, 5, 6, 6, 5],
  [5, 4, 5, 5, 0, 5, 5, 4, 5, 5, 4, 5, 4, 5, 5, 4],
  [4, 3, 7, 4, 0, 4, 4, 3, 4, 7, 3, 4, 3, 4, 4, 3],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  // Plank 3 (vertical seam at col 13)
  [6, 6, 5, 6, 5, 6, 6, 5, 6, 6, 5, 6, 6, 1, 6, 6],
  [5, 5, 4, 5, 4, 5, 5, 4, 5, 5, 4, 5, 5, 0, 5, 5],
  [4, 4, 3, 4, 3, 4, 7, 3, 4, 4, 3, 7, 4, 0, 4, 3],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  // Plank 4 (vertical seam at col 7)
  [6, 5, 6, 6, 5, 6, 6, 1, 6, 6, 5, 6, 5, 6, 6, 5],
  [5, 4, 5, 5, 4, 5, 5, 0, 5, 5, 4, 5, 4, 5, 5, 4],
  [4, 3, 4, 7, 3, 4, 4, 0, 4, 3, 3, 4, 3, 7, 4, 3],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

// -----------------------------------------------------------------------------
// 3. METAL: Authentic Minecraft Iron Block (32x32 pixel art from 16x16)
// Features outer border, beveled edges, brushed metal sheen, and corner rivets
// -----------------------------------------------------------------------------
const metalPalette = [
  '#ffffff', // 0: outer top/left bright shine
  '#ededed', // 1: light bevel edge
  '#dedede', // 2: inner light highlight
  '#d2d2d2', // 3: standard iron plate
  '#c4c4c4', // 4: iron body midtone
  '#b2b2b2', // 5: dark iron shading
  '#969696', // 6: inner bevel shadow
  '#727272', // 7: outer bottom/right border shadow
];

const metalGrid = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 6, 7],
  [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 6, 7],
  [0, 1, 2, 1, 3, 3, 3, 3, 3, 3, 3, 1, 2, 5, 6, 7],
  [0, 1, 2, 3, 4, 4, 4, 3, 3, 4, 4, 3, 2, 5, 6, 7],
  [0, 1, 2, 3, 4, 3, 3, 3, 3, 3, 4, 3, 2, 5, 6, 7],
  [0, 1, 2, 3, 4, 3, 3, 2, 2, 3, 4, 3, 2, 5, 6, 7],
  [0, 1, 2, 3, 3, 3, 2, 1, 2, 3, 3, 3, 2, 5, 6, 7],
  [0, 1, 2, 3, 3, 3, 2, 2, 3, 3, 3, 3, 2, 5, 6, 7],
  [0, 1, 2, 3, 4, 3, 3, 3, 3, 3, 4, 3, 2, 5, 6, 7],
  [0, 1, 2, 3, 4, 4, 3, 3, 3, 4, 4, 3, 2, 5, 6, 7],
  [0, 1, 2, 1, 3, 3, 3, 3, 3, 3, 3, 1, 2, 5, 6, 7],
  [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 6, 7],
  [0, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 7],
  [0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7],
  [1, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
];

// -----------------------------------------------------------------------------
// 4. ICE: Authentic Minecraft Packed / Blue Ice (32x32 pixel art from 16x16)
// Crisp palette featuring requested shades: #8cb8f0, #74a4ea, cyan crystals
// -----------------------------------------------------------------------------
const icePalette = [
  '#4a78be', // 0: deep ice crevice
  '#5a88d4', // 1: deep blue ice
  '#6b9be2', // 2: crystalline blue
  '#74a4ea', // 3: requested vibrant ice blue
  '#8cb8f0', // 4: requested cyan crystals
  '#a4cbfb', // 5: crystalline facet
  '#c4e2ff', // 6: frost gleam
  '#eaf5ff', // 7: sparkling ice highlight
];

const iceGrid = [
  [3, 4, 5, 6, 4, 3, 2, 1, 0, 1, 3, 4, 5, 4, 3, 2],
  [4, 5, 7, 5, 4, 2, 1, 0, 1, 2, 4, 6, 7, 5, 3, 2],
  [5, 6, 5, 4, 3, 1, 0, 1, 3, 4, 5, 5, 6, 4, 2, 1],
  [4, 5, 4, 3, 2, 0, 1, 2, 4, 5, 4, 3, 2, 1, 0, 1],
  [3, 4, 3, 2, 1, 1, 3, 4, 5, 4, 2, 1, 0, 1, 2, 3],
  [2, 3, 2, 1, 0, 2, 4, 6, 7, 5, 3, 1, 0, 2, 3, 4],
  [1, 2, 1, 0, 1, 3, 5, 7, 6, 4, 2, 0, 1, 3, 4, 5],
  [0, 1, 0, 1, 2, 4, 5, 5, 4, 3, 1, 0, 2, 4, 5, 4],
  [1, 2, 1, 2, 4, 5, 4, 3, 2, 1, 0, 1, 3, 5, 4, 3],
  [3, 4, 3, 4, 6, 5, 3, 2, 1, 0, 1, 3, 5, 6, 5, 3],
  [4, 5, 5, 6, 7, 5, 4, 2, 0, 1, 2, 4, 6, 7, 5, 4],
  [5, 6, 7, 6, 5, 4, 3, 1, 0, 1, 3, 5, 5, 6, 4, 3],
  [4, 5, 6, 5, 4, 2, 1, 0, 1, 2, 4, 4, 3, 2, 1, 2],
  [3, 4, 4, 3, 2, 1, 0, 1, 3, 4, 5, 3, 2, 1, 0, 1],
  [2, 3, 2, 1, 0, 1, 2, 4, 5, 6, 4, 2, 1, 0, 1, 2],
  [1, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2],
];

// Generate and write 32x32 PNGs
const outDir = path.join(__dirname, '..', 'public', 'textures');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const textures = [
  { name: 'rock.png', palette: rockPalette, grid: rockGrid },
  { name: 'wood.png', palette: woodPalette, grid: woodGrid },
  { name: 'metal.png', palette: metalPalette, grid: metalGrid },
  { name: 'ice.png', palette: icePalette, grid: iceGrid },
];

for (const t of textures) {
  const buf = createTextureBuffer32(t.palette, t.grid);
  const png = encodePNG(32, 32, buf);
  const outPath = path.join(outDir, t.name);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${t.name} (32x32): ${png.length} bytes -> ${outPath}`);
}
