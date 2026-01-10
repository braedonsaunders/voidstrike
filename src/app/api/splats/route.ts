import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';

/**
 * API Route: /api/splats
 *
 * Discovers all Gaussian Splat files in /public/splats/
 * Supports: .splat, .ply, .ksplat formats
 *
 * Returns:
 * {
 *   scenes: [
 *     { path: "/splats/scene1.splat", name: "scene1" },
 *     { path: "/splats/scene2.ply", name: "scene2" },
 *     ...
 *   ]
 * }
 */

const SPLAT_EXTENSIONS = ['.splat', '.ply', '.ksplat'];

export async function GET() {
  try {
    const splatsDir = path.join(process.cwd(), 'public', 'splats');

    // Check if directory exists
    if (!existsSync(splatsDir)) {
      // Create the directory if it doesn't exist
      await fs.mkdir(splatsDir, { recursive: true });
      return NextResponse.json({
        scenes: [],
        message: 'Splats directory created. Add .splat, .ply, or .ksplat files to /public/splats/',
      });
    }

    // Read directory contents
    const files = await fs.readdir(splatsDir);

    // Filter for splat files
    const splatFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return SPLAT_EXTENSIONS.includes(ext);
    });

    // Map to scene objects
    const scenes = splatFiles.map((file) => ({
      path: `/splats/${file}`,
      name: path.basename(file, path.extname(file)),
    }));

    // Sort alphabetically by name
    scenes.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      scenes,
      count: scenes.length,
    });
  } catch (error) {
    console.error('Error discovering splat files:', error);
    return NextResponse.json(
      {
        error: 'Failed to discover splat files',
        scenes: [],
      },
      { status: 500 }
    );
  }
}
