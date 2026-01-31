#!/usr/bin/env node
/**
 * GLB Model Optimizer for VOIDSTRIKE
 *
 * Optimizes GLB files from Meshy.ai or other sources:
 * - Resizes textures to 512x512 (configurable)
 * - Converts textures to WebP for smaller file size
 * - Applies Draco mesh compression
 * - Deduplicates data
 *
 * Usage:
 *   node scripts/optimize-models.js                    # Optimize all models
 *   node scripts/optimize-models.js public/models/units/scv.glb  # Optimize specific file
 *
 * Requirements:
 *   npm install -D @gltf-transform/cli
 */

/* eslint-disable no-console */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  textureSize: 512,        // Max texture dimension (512x512 is plenty for RTS units)
  useDraco: true,          // Enable Draco mesh compression
  modelDirs: [             // Directories to scan for models
    'public/models/units',
    'public/models/buildings',
  ],
  skipSuffix: '-optimized', // Skip files already optimized
  backup: false,            // Create .backup files before overwriting
};

// Size thresholds for warnings
const SIZE_WARNING_KB = 500;   // Warn if optimized file > 500KB
const SIZE_ERROR_KB = 2000;    // Error if optimized file > 2MB

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileSizeKB(filePath) {
  try {
    return fs.statSync(filePath).size / 1024;
  } catch {
    return 0;
  }
}

function optimizeModel(inputPath) {
  const inputSize = getFileSizeKB(inputPath);
  console.log(`\nProcessing: ${inputPath} (${formatSize(inputSize * 1024)})`);

  // Create temp output path
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const tempOutput = path.join(dir, `${base}.temp${ext}`);

  // Run transforms individually to avoid texture extraction
  // The 'optimize' command extracts textures by default, so we use specific transforms
  const step1Output = path.join(dir, `${base}.step1${ext}`);

  try {
    console.log(`   Step 1: Resizing textures to ${CONFIG.textureSize}x${CONFIG.textureSize}...`);
    const resizeCmd = `npx --yes @gltf-transform/cli resize "${inputPath}" "${step1Output}" --width ${CONFIG.textureSize} --height ${CONFIG.textureSize}`;
    execSync(resizeCmd, { stdio: 'pipe', encoding: 'utf-8' });

    console.log(`   Step 2: Applying ${CONFIG.useDraco ? 'Draco' : 'Meshopt'} compression...`);
    const compressCmd = `npx --yes @gltf-transform/cli ${CONFIG.useDraco ? 'draco' : 'meshopt'} "${step1Output}" "${tempOutput}"`;
    execSync(compressCmd, { stdio: 'pipe', encoding: 'utf-8' });

    // Clean up intermediate file
    if (fs.existsSync(step1Output)) {
      fs.unlinkSync(step1Output);
    }

    const outputSize = getFileSizeKB(tempOutput);
    const reduction = ((1 - outputSize / inputSize) * 100).toFixed(1);

    // Replace original with optimized version
    if (CONFIG.backup) {
      fs.renameSync(inputPath, `${inputPath}.backup`);
    }
    fs.renameSync(tempOutput, inputPath);

    // Status indicator
    let status = '[OK]';
    if (outputSize > SIZE_ERROR_KB) {
      status = '[ERROR]';
      console.log(`   ${status} ${formatSize(inputSize * 1024)} -> ${formatSize(outputSize * 1024)} (${reduction}% reduction)`);
      console.log(`   WARNING: File still too large (>${SIZE_ERROR_KB}KB). Consider reducing polygon count.`);
    } else if (outputSize > SIZE_WARNING_KB) {
      status = '[WARN]';
      console.log(`   ${status} ${formatSize(inputSize * 1024)} -> ${formatSize(outputSize * 1024)} (${reduction}% reduction)`);
      console.log(`   Note: File larger than recommended ${SIZE_WARNING_KB}KB for RTS units.`);
    } else {
      console.log(`   ${status} ${formatSize(inputSize * 1024)} -> ${formatSize(outputSize * 1024)} (${reduction}% reduction)`);
    }

    return { success: true, inputSize, outputSize, reduction };
  } catch (error) {
    console.error(`   [ERROR] Failed to optimize: ${error.message}`);
    // Clean up temp file if it exists
    if (fs.existsSync(tempOutput)) {
      fs.unlinkSync(tempOutput);
    }
    return { success: false, error: error.message };
  }
}

function findGlbFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findGlbFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.glb')) {
      // Skip already-optimized files
      if (!entry.name.includes(CONFIG.skipSuffix)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function main() {
  console.log('VOIDSTRIKE Model Optimizer');
  console.log('-'.repeat(50));
  console.log(`Settings: ${CONFIG.textureSize}x${CONFIG.textureSize}, Draco: ${CONFIG.useDraco ? 'ON' : 'OFF'}`);

  // Get files to process
  let filesToProcess = [];

  if (process.argv.length > 2) {
    // Process specific files from command line
    filesToProcess = process.argv.slice(2).filter(f => f.endsWith('.glb'));
  } else {
    // Scan all model directories
    for (const dir of CONFIG.modelDirs) {
      filesToProcess.push(...findGlbFiles(dir));
    }
  }

  if (filesToProcess.length === 0) {
    console.log('\nNo GLB files found to optimize.');
    process.exit(0);
  }

  console.log(`\nFound ${filesToProcess.length} file(s) to optimize.`);

  // Process each file
  const results = {
    success: 0,
    failed: 0,
    totalInputSize: 0,
    totalOutputSize: 0,
  };

  for (const file of filesToProcess) {
    const result = optimizeModel(file);
    if (result.success) {
      results.success++;
      results.totalInputSize += result.inputSize;
      results.totalOutputSize += result.outputSize;
    } else {
      results.failed++;
    }
  }

  // Summary
  console.log('\n' + '-'.repeat(50));
  console.log('Summary:');
  console.log(`   Files processed: ${results.success}/${filesToProcess.length}`);

  if (results.success > 0) {
    const totalReduction = ((1 - results.totalOutputSize / results.totalInputSize) * 100).toFixed(1);
    console.log(`   Total size: ${formatSize(results.totalInputSize * 1024)} → ${formatSize(results.totalOutputSize * 1024)} (${totalReduction}% reduction)`);
  }

  if (results.failed > 0) {
    console.log(`   [ERROR] ${results.failed} file(s) failed to optimize`);
    process.exit(1);
  }
}

main();
