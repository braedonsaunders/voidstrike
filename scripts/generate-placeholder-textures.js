/**
 * Generate placeholder terrain textures
 * Run with: node scripts/generate-placeholder-textures.js
 *
 * Creates simple colored textures as placeholders until AI-generated ones are added
 */

const fs = require('fs');
const path = require('path');

// Simple PNG encoder (no dependencies)
function createPNG(width, height, r, g, b, addNoise = false, isNormal = false) {
  const pixels = [];

  for (let y = 0; y < height; y++) {
    pixels.push(0); // Filter byte
    for (let x = 0; x < width; x++) {
      if (isNormal) {
        // Normal map: flat surface pointing up (128, 128, 255)
        const nx = 128 + (addNoise ? Math.floor((Math.random() - 0.5) * 20) : 0);
        const ny = 128 + (addNoise ? Math.floor((Math.random() - 0.5) * 20) : 0);
        const nz = 255;
        pixels.push(nx, ny, nz, 255);
      } else {
        // Diffuse: base color with optional noise
        const noise = addNoise ? Math.floor((Math.random() - 0.5) * 30) : 0;
        pixels.push(
          Math.max(0, Math.min(255, r + noise)),
          Math.max(0, Math.min(255, g + noise)),
          Math.max(0, Math.min(255, b + noise)),
          255
        );
      }
    }
  }

  // PNG encoding
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeData));
    return Buffer.concat([len, typeData, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const zlib = require('zlib');
  const deflated = zlib.deflateSync(Buffer.from(pixels));

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', iend),
  ]);
}

const outputDir = path.join(__dirname, '..', 'public', 'textures', 'terrain');

// Ensure directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const textures = [
  // Grass - green
  { name: 'grass_diffuse.jpg', r: 80, g: 140, b: 60, noise: true },
  { name: 'grass_normal.jpg', isNormal: true, noise: true },
  { name: 'grass_roughness.jpg', r: 200, g: 200, b: 200, noise: true }, // High roughness
  { name: 'grass_displacement.jpg', r: 128, g: 128, b: 128, noise: true }, // Neutral height with noise

  // Dirt - brown
  { name: 'dirt_diffuse.jpg', r: 120, g: 90, b: 60, noise: true },
  { name: 'dirt_normal.jpg', isNormal: true, noise: true },
  { name: 'dirt_roughness.jpg', r: 220, g: 220, b: 220, noise: true }, // Very rough
  { name: 'dirt_displacement.jpg', r: 100, g: 100, b: 100, noise: true }, // Slightly lower

  // Rock - gray
  { name: 'rock_diffuse.jpg', r: 100, g: 100, b: 105, noise: true },
  { name: 'rock_normal.jpg', isNormal: true, noise: true },
  { name: 'rock_roughness.jpg', r: 160, g: 160, b: 160, noise: true }, // Medium roughness
  { name: 'rock_displacement.jpg', r: 140, g: 140, b: 140, noise: true }, // Raised areas

  // Cliff - dark gray
  { name: 'cliff_diffuse.jpg', r: 80, g: 80, b: 85, noise: true },
  { name: 'cliff_normal.jpg', isNormal: true, noise: true },
  { name: 'cliff_roughness.jpg', r: 180, g: 180, b: 180, noise: true }, // Medium-high roughness
  { name: 'cliff_displacement.jpg', r: 150, g: 150, b: 150, noise: true }, // Irregular surface
];

console.log('Generating placeholder terrain textures...\n');

textures.forEach((tex) => {
  const png = createPNG(
    256,
    256,
    tex.r || 128,
    tex.g || 128,
    tex.b || 255,
    tex.noise || false,
    tex.isNormal || false
  );

  // Save as PNG (rename to .jpg for compatibility - browsers handle it)
  const filePath = path.join(outputDir, tex.name);
  fs.writeFileSync(filePath, png);
  console.log(`Created: ${tex.name}`);
});

console.log('\n✓ All placeholder textures created!');
console.log(`\nLocation: ${outputDir}`);
console.log('\nReplace these with AI-generated textures for better visuals.');
console.log('Recommended: Use Midjourney with --tile flag or Polycam AI Textures');
