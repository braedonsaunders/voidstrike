'use client';

import { MapData } from '@/data/maps';
import { BIOMES } from '@/rendering/Biomes';
import { colorToHex } from './utils';

interface MapPreviewProps {
  map: MapData;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

export function MapPreview({ map, isSelected, onSelect, onEdit }: MapPreviewProps) {
  const biome = BIOMES[map.biome || 'grassland'];
  const groundColors = biome.colors.ground;
  const accentColor = colorToHex(biome.colors.accent[0]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border-2 transition-all duration-300
        ${isSelected
          ? 'border-void-400 shadow-[0_0_20px_rgba(132,61,255,0.4)]'
          : 'border-void-800/50 hover:border-void-600'
        }`}
    >
      <button
        onClick={onSelect}
        className="w-full text-left"
      >
        <div
          className="h-10 w-full relative"
          style={{
            background: `linear-gradient(135deg,
              ${colorToHex(groundColors[2])},
              ${colorToHex(groundColors[0])},
              ${colorToHex(groundColors[1])})`
          }}
        >
          <div className="absolute top-0.5 right-0.5 bg-black/60 px-1 py-0.5 rounded text-[8px] text-void-300">
            {map.width}x{map.height}
          </div>
          <div className="absolute bottom-0.5 left-0.5 bg-black/60 px-1 py-0.5 rounded text-[8px] capitalize"
               style={{ color: accentColor }}>
            {map.biome || 'grassland'}
          </div>
        </div>

        <div className="px-1.5 py-1 bg-void-950">
          <h3 className="font-display text-white text-[10px] leading-tight">{map.name}</h3>
        </div>
      </button>

      {/* Edit button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="absolute bottom-1 right-1 px-1 py-0.5 bg-void-700/80 hover:bg-void-600
                   text-void-200 text-[8px] rounded transition-colors backdrop-blur-sm"
        title="Edit map"
      >
        Edit
      </button>

      {isSelected && (
        <div className="absolute top-0.5 left-0.5 bg-void-500 text-white px-1 py-0.5 rounded text-[8px] font-bold">
          ✓
        </div>
      )}
    </div>
  );
}
