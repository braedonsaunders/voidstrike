/**
 * Generates and updates file tree documentation in docs/architecture/OVERVIEW.md
 * Run on every commit via GitHub Actions to keep documentation in sync with codebase
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const OVERVIEW_PATH = path.join(ROOT_DIR, 'docs', 'architecture', 'OVERVIEW.md');

// Directories to include in the tree (order matters for output)
const INCLUDE_DIRS = [
  '.claude',
  'docs',
  'wasm',
  'src',
  'public',
  'tests',
];

// Files/directories to exclude
const EXCLUDE = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '.DS_Store',
  'thumbs.db',
  '.env',
  '.env.local',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

// File extensions to include (empty = all)
const INCLUDE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.sh',
  '.rs',
  '.toml',
  '.html',
  '.css',
]);

// Maximum depth for tree generation
const MAX_DEPTH = 5;

/**
 * Check if a path should be excluded
 */
function shouldExclude(name) {
  if (EXCLUDE.has(name)) return true;
  if (name.startsWith('.') && name !== '.claude') return true;
  return false;
}

/**
 * Check if a file extension should be included
 */
function shouldIncludeFile(name) {
  if (INCLUDE_EXTENSIONS.size === 0) return true;
  const ext = path.extname(name).toLowerCase();
  return INCLUDE_EXTENSIONS.has(ext);
}

/**
 * Get a short description for known files/directories
 */
function getDescription(name) {
  const descriptions = {
    // .claude
    'CLAUDE.md': 'Main instructions file',
    'TODO.md': 'Development roadmap',
    'templates': 'Documentation templates',
    'skills': 'Custom skills',

    // docs
    'architecture': 'Architecture docs (this file)',
    'design': 'Game design docs',
    'reference': 'Technical reference',
    'security': 'Security documentation',
    'tools': 'Development tools',
    'OVERVIEW.md': 'System architecture',
    'networking.md': 'P2P multiplayer',
    'rendering.md': 'Graphics pipeline',
    'GAME_DESIGN.md': 'Core design doc',
    'audio.md': 'Audio system',
    'schema.md': 'Data schemas',
    'models.md': '3D model specs',
    'textures.md': 'Texture specs',
    'TESTING.md': 'Test documentation',

    // src directories
    'app': 'Next.js App Router',
    'components': 'React components',
    'engine': 'Game engine core',
    'ecs': 'Entity Component System',
    'systems': 'ECS Systems',
    'ai': 'AI subsystems',
    'pathfinding': 'Navigation & pathfinding',
    'wasm': 'WASM module wrappers',
    'definitions': 'Definition registry',
    'audio': 'Audio management',
    'assets': 'Asset management',
    'rendering': 'Rendering systems',
    'effects': 'Visual effects',
    'phaser': 'Phaser 4 2D overlay',
    'data': 'Game data definitions',
    'editor': '3D Map Editor',
    'store': 'State management',
    'hooks': 'React hooks',
    'utils': 'Utility functions',
    'workers': 'Web Workers',

    // public
    'config': 'Configuration files',
    'models': '3D models (GLTF/GLB)',
    'textures': 'Texture assets',

    // wasm
    'boids': 'SIMD-accelerated boids',

    // Key files
    'Game.ts': 'Main game class',
    'GameLoop.ts': 'Fixed timestep loop',
    'EventBus.ts': 'Event system',
    'World.ts': 'ECS world container',
    'Entity.ts': 'Entity class',
    'Component.ts': 'Component base',
    'System.ts': 'System base',
  };

  return descriptions[name] || null;
}

/**
 * Build the file tree structure
 */
function buildTree(dir, prefix = '', depth = 0) {
  if (depth >= MAX_DEPTH) {
    return [{ line: `${prefix}└── ...`, isLast: true }];
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Filter and sort entries
  entries = entries
    .filter(entry => !shouldExclude(entry.name))
    .filter(entry => entry.isDirectory() || shouldIncludeFile(entry.name))
    .sort((a, b) => {
      // Directories first, then files
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  const lines = [];
  const lastIndex = entries.length - 1;

  entries.forEach((entry, index) => {
    const isLast = index === lastIndex;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    const fullPath = path.join(dir, entry.name);
    const desc = getDescription(entry.name);
    const comment = desc ? ` # ${desc}` : '';

    if (entry.isDirectory()) {
      lines.push({ line: `${prefix}${connector}${entry.name}/${comment}`, isDir: true });

      // Recurse into directory
      const childLines = buildTree(fullPath, prefix + childPrefix, depth + 1);
      lines.push(...childLines);
    } else {
      lines.push({ line: `${prefix}${connector}${entry.name}${comment}`, isDir: false });
    }
  });

  return lines;
}

/**
 * Generate the complete tree for specified directories
 */
function generateFullTree() {
  const lines = ['voidstrike/'];

  const topLevelEntries = INCLUDE_DIRS.filter(dir => {
    const fullPath = path.join(ROOT_DIR, dir);
    return fs.existsSync(fullPath);
  });

  topLevelEntries.forEach((dir, index) => {
    const isLast = index === topLevelEntries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    const fullPath = path.join(ROOT_DIR, dir);
    const desc = getDescription(dir);
    const comment = desc ? ` # ${desc}` : '';

    lines.push(`${connector}${dir}/${comment}`);

    const treeLines = buildTree(fullPath, childPrefix, 1);
    treeLines.forEach(item => lines.push(item.line));
  });

  return lines.join('\n');
}

/**
 * Update the OVERVIEW.md file with the new tree
 */
function updateOverview() {
  let content;
  try {
    content = fs.readFileSync(OVERVIEW_PATH, 'utf-8');
  } catch (error) {
    console.error(`Failed to read ${OVERVIEW_PATH}:`, error.message);
    process.exit(1);
  }

  const newTree = generateFullTree();

  // Find and replace the directory structure section
  // Look for ```  after "## Directory Structure" and before the next ##
  const structureRegex = /(## Directory Structure\s*\n\s*```\s*\n)([\s\S]*?)(```\s*\n)/;
  const match = content.match(structureRegex);

  if (!match) {
    console.error('Could not find Directory Structure section in OVERVIEW.md');
    console.error('Expected format: ## Directory Structure followed by a code block');
    process.exit(1);
  }

  const before = match[1];
  const oldTree = match[2];
  const after = match[3];

  // Check if tree has changed
  if (oldTree.trim() === newTree.trim()) {
    console.log('File tree is already up to date');
    return false;
  }

  const newContent = content.replace(structureRegex, `${before}${newTree}\n${after}`);

  fs.writeFileSync(OVERVIEW_PATH, newContent);
  console.log('Updated file tree in docs/architecture/OVERVIEW.md');

  // Log changes summary
  const oldLines = oldTree.trim().split('\n').length;
  const newLines = newTree.trim().split('\n').length;
  console.log(`Tree changed from ${oldLines} to ${newLines} lines`);

  return true;
}

// Main execution
const changed = updateOverview();
process.exit(changed ? 0 : 0); // Always exit 0, let git handle if there are changes
