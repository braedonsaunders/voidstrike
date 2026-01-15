import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export interface MusicTrack {
  name: string;
  url: string;
}

export interface MusicDiscoveryResponse {
  categories: Record<string, MusicTrack[]>;
}

interface MusicConfig {
  categories: Record<string, {
    folder: string;
    description?: string;
    shuffle: boolean;
    loop: boolean;
    crossfadeDuration: number;
  }>;
}

/**
 * GET /api/music
 *
 * Discovers all MP3 files based on music.config.json
 * Returns tracks organized by category (menu, gameplay, etc.)
 *
 * This API is fully data-driven - add new categories by editing music.config.json
 */
export async function GET() {
  const publicDir = path.join(process.cwd(), 'public');
  const configPath = path.join(publicDir, 'audio', 'music.config.json');

  // Load the music configuration
  let config: MusicConfig;
  try {
    const configContent = await readFile(configPath, 'utf-8');
    config = JSON.parse(configContent);
  } catch {
    // Return empty if config doesn't exist
    return NextResponse.json({ categories: {} });
  }

  // Discover MP3 files for each category
  const discoverMp3Files = async (folder: string): Promise<MusicTrack[]> => {
    const dir = path.join(publicDir, folder.replace(/^\//, ''));

    if (!existsSync(dir)) {
      return [];
    }

    try {
      const files = await readdir(dir);
      return files
        .filter((file: string) => file.toLowerCase().endsWith('.mp3'))
        .map((file: string) => ({
          name: file.replace(/\.mp3$/i, ''),
          url: `${folder}/${file}`,
        }));
    } catch {
      return [];
    }
  };

  // Process all categories from config
  const categories: Record<string, MusicTrack[]> = {};

  const categoryPromises = Object.entries(config.categories).map(
    async ([categoryName, categoryConfig]) => {
      const tracks = await discoverMp3Files(categoryConfig.folder);
      return { categoryName, tracks };
    }
  );

  const results = await Promise.all(categoryPromises);

  for (const { categoryName, tracks } of results) {
    categories[categoryName] = tracks;
  }

  const response: MusicDiscoveryResponse = {
    categories,
  };

  return NextResponse.json(response);
}
