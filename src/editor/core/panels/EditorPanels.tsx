'use client';

import type {
  EditorConfig,
  EditorState,
  EditorObject,
  EditorMapData,
} from '../../config/EditorConfig';
import type { DetailedValidationResult } from '../EditorCore';
import type { MapData } from '@/data/maps/MapTypes';
import { AIGeneratePanel } from '../../panels/AIGeneratePanel';
import { PanelTab, AnimatedPanelContent, ShortcutsFooter } from './shared';
import { PaintPanel } from './PaintPanel';
import { ObjectsPanel } from './ObjectsPanel';
import { SettingsPanel } from './SettingsPanel';
import { ValidatePanel } from './ValidatePanel';
import { SelectedPanel } from './SelectedPanel';

export interface EditorPanelsProps {
  config: EditorConfig;
  state: EditorState;
  visibility: {
    labels: boolean;
    grid: boolean;
    categories: Record<string, boolean>;
  };
  onToolSelect: (toolId: string) => void;
  onElevationSelect: (elevation: number) => void;
  onFeatureSelect: (feature: string) => void;
  onMaterialSelect: (materialId: number) => void;
  onBrushSizeChange: (size: number) => void;
  onPanelChange: (panelId: string) => void;
  onBiomeChange: (biomeId: string) => void;
  onObjectAdd: (obj: Omit<EditorObject, 'id'>) => string;
  onObjectRemove: (id: string) => void;
  onObjectPropertyUpdate: (id: string, key: string, value: unknown) => void;
  onMetadataUpdate: (updates: Partial<Pick<EditorMapData, 'name' | 'width' | 'height' | 'biomeId'>>) => void;
  onValidate: () => void;
  onAutoFix?: () => void;
  validationResult?: DetailedValidationResult;
  onToggleLabels: () => void;
  onToggleGrid: () => void;
  onToggleCategory: (category: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onAIMapGenerated?: (mapData: MapData) => void;
  onUpdateObjects?: (objects: EditorObject[]) => void;
}

export function EditorPanels({
  config,
  state,
  visibility,
  onToolSelect,
  onElevationSelect,
  onFeatureSelect,
  onMaterialSelect,
  onBrushSizeChange,
  onPanelChange,
  onBiomeChange,
  onObjectAdd,
  onObjectRemove,
  onObjectPropertyUpdate,
  onMetadataUpdate,
  onValidate,
  onAutoFix,
  validationResult,
  onToggleLabels,
  onToggleGrid,
  onToggleCategory,
  onMouseEnter,
  onMouseLeave,
  onAIMapGenerated,
  onUpdateObjects,
}: EditorPanelsProps) {
  const theme = config.theme;

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{
        backgroundColor: theme.surface,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Panel tabs */}
      <div
        className="flex-shrink-0 flex border-b"
        style={{ borderColor: theme.border }}
      >
        {config.panels.map((panel) => (
          <PanelTab
            key={panel.id}
            active={state.activePanel === panel.id}
            onClick={() => onPanelChange(panel.id)}
            icon={panel.icon}
            name={panel.name}
            theme={theme}
            hasContent={panel.id === 'selected' ? state.selectedObjects.length > 0 : undefined}
          />
        ))}
      </div>

      {/* Panel content with animated transitions */}
      <div className="flex-1 overflow-y-auto p-3 relative">
        <AnimatedPanelContent isActive={state.activePanel === 'ai'}>
          {onAIMapGenerated && (
            <AIGeneratePanel
              config={config}
              onMapGenerated={onAIMapGenerated}
            />
          )}
        </AnimatedPanelContent>

        <AnimatedPanelContent isActive={state.activePanel === 'paint'}>
          <PaintPanel
            config={config}
            state={state}
            onToolSelect={onToolSelect}
            onElevationSelect={onElevationSelect}
            onFeatureSelect={onFeatureSelect}
            onMaterialSelect={onMaterialSelect}
            onBrushSizeChange={onBrushSizeChange}
          />
        </AnimatedPanelContent>

        <AnimatedPanelContent isActive={state.activePanel === 'bases'}>
          <ObjectsPanel
            config={config}
            state={state}
            category="bases"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        </AnimatedPanelContent>

        <AnimatedPanelContent isActive={state.activePanel === 'objects'}>
          <ObjectsPanel
            config={config}
            state={state}
            category="objects"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        </AnimatedPanelContent>

        <AnimatedPanelContent isActive={state.activePanel === 'decorations'}>
          <ObjectsPanel
            config={config}
            state={state}
            category="decorations"
            onObjectAdd={onObjectAdd}
            onObjectRemove={onObjectRemove}
          />
        </AnimatedPanelContent>

        <AnimatedPanelContent isActive={state.activePanel === 'selected'}>
          <SelectedPanel
            config={config}
            state={state}
            onPropertyUpdate={onObjectPropertyUpdate}
            onRemove={onObjectRemove}
          />
        </AnimatedPanelContent>

        <AnimatedPanelContent isActive={state.activePanel === 'settings'}>
          <SettingsPanel
            config={config}
            state={state}
            visibility={visibility}
            onBiomeChange={onBiomeChange}
            onMetadataUpdate={onMetadataUpdate}
            onToggleLabels={onToggleLabels}
            onToggleGrid={onToggleGrid}
            onToggleCategory={onToggleCategory}
            onUpdateObjects={onUpdateObjects}
          />
        </AnimatedPanelContent>

        <AnimatedPanelContent isActive={state.activePanel === 'validate'}>
          <ValidatePanel
            config={config}
            validationResult={validationResult}
            onValidate={onValidate}
            onAutoFix={onAutoFix}
          />
        </AnimatedPanelContent>
      </div>

      {/* Keyboard shortcuts footer */}
      <ShortcutsFooter theme={theme} />
    </div>
  );
}

export default EditorPanels;
