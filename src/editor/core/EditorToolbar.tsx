/**
 * EditorToolbar - Optional floating toolbar component
 *
 * This is an alternative layout option - a floating toolbar instead of
 * the tools being in the side panel. Games can choose which layout to use.
 */

'use client';

import type { EditorConfig, EditorState } from '../config/EditorConfig';

export interface EditorToolbarProps {
  config: EditorConfig;
  state: EditorState;
  onToolSelect: (toolId: string) => void;
  position?: 'top' | 'bottom' | 'left';
}

export function EditorToolbar({
  config,
  state,
  onToolSelect,
  position = 'left',
}: EditorToolbarProps) {
  const positionClasses = {
    top: 'top-4 left-1/2 -translate-x-1/2 flex-row',
    bottom: 'bottom-4 left-1/2 -translate-x-1/2 flex-row',
    left: 'left-4 top-1/2 -translate-y-1/2 flex-col',
  };

  return (
    <div
      className={`absolute flex gap-1 p-2 rounded-lg shadow-lg ${positionClasses[position]}`}
      style={{
        backgroundColor: `${config.theme.surface}ee`,
        backdropFilter: 'blur(8px)',
        border: `1px solid ${config.theme.border}`,
      }}
    >
      {config.tools.map((tool) => {
        const isActive = state.activeTool === tool.id;

        return (
          <button
            key={tool.id}
            onClick={() => onToolSelect(tool.id)}
            title={`${tool.name} (${tool.shortcut})`}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all duration-150"
            style={{
              backgroundColor: isActive ? config.theme.primary : 'transparent',
              color: isActive ? config.theme.text.primary : config.theme.text.secondary,
              boxShadow: isActive ? `0 0 15px ${config.theme.primary}60` : 'none',
            }}
          >
            {tool.icon}
          </button>
        );
      })}
    </div>
  );
}

export default EditorToolbar;
