/**
 * Build-time script to generate music manifest
 * Scans public/audio/music folders and creates a static JSON manifest
 * This eliminates the need for a serverless function that reads the filesystem
 */

const fs = require('fs');
const path = require('path');

const publicDir = path.join(process.cwd(), 'public');
const configPath = path.join(publicDir, 'audio', 'music.config.json');
const outputPath = path.join(process.cwd(), 'src', 'data', 'music-manifest.json');

function discoverMp3Files(folder) {
  const dir = path.join(publicDir, folder.replace(/^\//, ''));

  if (!fs.existsSync(dir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(dir);
    return files
      .filter((file) => file.toLowerCase().endsWith('.mp3'))
      .map((file) => ({
        name: file.replace(/\.mp3$/i, ''),
        url: `${folder}/${file}`,
      }));
  } catch {
    return [];
  }
}

function main() {
  // Load config
  let config;
  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(configContent);
  } catch (error) {
    console.log('No music.config.json found, generating empty manifest');
    const manifest = { categories: {}, generatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
    return;
  }

  // Discover tracks for each category
  const categories = {};
  for (const [categoryName, categoryConfig] of Object.entries(config.categories)) {
    const tracks = discoverMp3Files(categoryConfig.folder);
    categories[categoryName] = tracks;
    console.log(`Found ${tracks.length} tracks in ${categoryName}`);
  }

  // Write manifest
  const manifest = {
    categories,
    generatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  console.log(`Music manifest written to ${outputPath}`);
}

main();
