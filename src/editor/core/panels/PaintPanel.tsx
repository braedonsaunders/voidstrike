'use client';

import type { EditorConfig, EditorState, ToolConfig } from '../../config/EditorConfig';
import {
  Section,
  Slider,
  ToolGrid,
  ElevationPalette,
  FeatureGrid,
  MaterialSelector,
  TOOL_CATEGORIES,
} from './shared';

export interface PaintPanelProps {
  config: EditorConfig;
  state: EditorState;
  onToolSelect: (toolId: string) => void;
  onElevationSelect: (elevation: number) => void;
  onFeatureSelect: (feature: string) => void;
  onMaterialSelect: (materialId: number) => void;
  onBrushSizeChange: (size: number) => void;
}

export function PaintPanel({
  config,
  state,
  onToolSelect,
  onElevationSelect,
  onFeatureSelect,
  onMaterialSelect,
  onBrushSizeChange,
}: PaintPanelProps) {
  const theme = config.theme;
  const activeTool = config.tools.find((t) => t.id === state.activeTool);

  // Group tools by category
  const getToolsForCategory = (category: string): ToolConfig[] => {
    const toolIds = TOOL_CATEGORIES[category as keyof typeof TOOL_CATEGORIES]?.tools || [];
    return toolIds
      .map((id) => config.tools.find((t) => t.id === id))
      .filter((t): t is ToolConfig => t !== undefined);
  };

  return (
    <div className="space-y-3">
      {/* All tools in categories */}
      <Section title="Tools" icon="🔧" theme={theme}>
        <div className="space-y-3">
          {Object.entries(TOOL_CATEGORIES).map(([catId, cat]) => {
            const tools = getToolsForCategory(catId);
            if (tools.length === 0) return null;
            return (
              <div key={catId}>
                <div
                  className="text-[10px] uppercase tracking-wider mb-1.5"
                  style={{ color: theme.text.muted }}
                >
                  {cat.name}
                </div>
                <ToolGrid
                  tools={tools}
                  activeTool={state.activeTool}
                  onSelect={onToolSelect}
                  theme={theme}
                  columns={tools.length <= 3 ? 3 : 4}
                />
              </div>
            );
          })}
        </div>
      </Section>

      {/* Brush size (contextual) */}
      {activeTool?.hasBrushSize && (
        <Section title="Brush" icon="●" theme={theme}>
          <Slider
            label="Size"
            value={state.brushSize}
            min={activeTool.minBrushSize || 1}
            max={activeTool.maxBrushSize || 20}
            onChange={onBrushSizeChange}
            theme={theme}
          />
        </Section>
      )}

      {/* Elevation */}
      <Section title="Elevation" icon="▲" theme={theme}>
        <ElevationPalette
          elevations={config.terrain.elevations}
          selected={state.selectedElevation}
          onSelect={onElevationSelect}
          theme={theme}
        />
      </Section>

      {/* Features */}
      <Section title="Features" icon="🌊" theme={theme} defaultOpen={false}>
        <FeatureGrid
          features={config.terrain.features}
          selected={state.selectedFeature}
          onSelect={onFeatureSelect}
          theme={theme}
        />
      </Section>

      {/* Materials */}
      {config.terrain.materials && config.terrain.materials.length > 0 && (
        <Section title="Material" icon="🎨" theme={theme} defaultOpen={false}>
          <MaterialSelector
            materials={config.terrain.materials}
            selected={state.selectedMaterial}
            onSelect={onMaterialSelect}
            theme={theme}
          />
        </Section>
      )}
    </div>
  );
}
