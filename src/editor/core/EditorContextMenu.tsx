/**
 * EditorContextMenu - Right-click context menu for canvas actions
 *
 * Provides quick access to common actions based on what's under the cursor.
 */

'use client';

import { useEffect, useRef } from 'react';
import type { EditorConfig, EditorObject } from '../config/EditorConfig';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface EditorContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  onClose: () => void;
  actions: ContextMenuAction[];
  theme: EditorConfig['theme'];
}

function MenuItem({
  action,
  theme,
  onClose,
}: {
  action: ContextMenuAction;
  theme: EditorConfig['theme'];
  onClose: () => void;
}) {
  return (
    <button
      onClick={() => {
        if (!action.disabled) {
          action.onClick();
          onClose();
        }
      }}
      disabled={action.disabled}
      className={`
        w-full flex items-center gap-3 px-3 py-2 text-left text-sm
        transition-colors rounded
        ${action.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}
      `}
      style={{
        color: action.danger ? theme.error : theme.text.primary,
      }}
    >
      {action.icon && <span className="w-4 text-center">{action.icon}</span>}
      <span className="flex-1">{action.label}</span>
      {action.shortcut && (
        <span className="text-xs opacity-50">{action.shortcut}</span>
      )}
    </button>
  );
}

export function EditorContextMenu({
  x,
  y,
  isOpen,
  onClose,
  actions,
  theme,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Small delay to prevent immediate close
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 10);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Adjust position to keep menu on screen
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let newX = x;
    let newY = y;

    if (x + rect.width > viewportWidth - 10) {
      newX = viewportWidth - rect.width - 10;
    }
    if (y + rect.height > viewportHeight - 10) {
      newY = viewportHeight - rect.height - 10;
    }

    if (newX !== x || newY !== y) {
      menuRef.current.style.left = `${newX}px`;
      menuRef.current.style.top = `${newY}px`;
    }
  }, [isOpen, x, y]);

  if (!isOpen || actions.length === 0) return null;

  // Group actions by separator (undefined label)
  const groupedActions: (ContextMenuAction | 'separator')[] = [];
  let lastWasSeparator = true;
  for (const action of actions) {
    if (action.id === 'separator') {
      if (!lastWasSeparator) {
        groupedActions.push('separator');
        lastWasSeparator = true;
      }
    } else {
      groupedActions.push(action);
      lastWasSeparator = false;
    }
  }
  // Remove trailing separator
  if (groupedActions[groupedActions.length - 1] === 'separator') {
    groupedActions.pop();
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] py-1 rounded-lg shadow-2xl backdrop-blur-xl"
      style={{
        left: x,
        top: y,
        backgroundColor: 'rgba(30, 30, 40, 0.95)',
        border: `1px solid ${theme.border}`,
      }}
    >
      {groupedActions.map((item, index) =>
        item === 'separator' ? (
          <div
            key={`sep-${index}`}
            className="h-px my-1 mx-2"
            style={{ backgroundColor: theme.border }}
          />
        ) : (
          <MenuItem key={item.id} action={item} theme={theme} onClose={onClose} />
        )
      )}
    </div>
  );
}

// Helper to build context menu actions based on context
export function buildContextMenuActions({
  gridPos,
  selectedObjects,
  objectAtPosition,
  config,
  onToolSelect,
  onFillArea,
  onObjectRemove,
  onCopyTerrain,
  onPasteTerrain,
  onAddObject,
  hasCopiedTerrain,
}: {
  gridPos: { x: number; y: number } | null;
  selectedObjects: string[];
  objectAtPosition: EditorObject | null;
  config: EditorConfig;
  onToolSelect: (toolId: string) => void;
  onFillArea: () => void;
  onObjectRemove: (id: string) => void;
  onCopyTerrain: () => void;
  onPasteTerrain: () => void;
  onAddObject: (typeId: string, x: number, y: number) => void;
  hasCopiedTerrain: boolean;
}): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [];

  // Object-specific actions
  if (objectAtPosition) {
    const objType = config.objectTypes.find((t) => t.id === objectAtPosition.type);
    actions.push({
      id: 'select-object',
      label: `Select ${objType?.name || 'Object'}`,
      icon: '👆',
      onClick: () => onToolSelect('select'),
    });
    actions.push({
      id: 'delete-object',
      label: `Delete ${objType?.name || 'Object'}`,
      icon: '🗑️',
      shortcut: 'Del',
      danger: true,
      onClick: () => onObjectRemove(objectAtPosition.id),
    });
    actions.push({ id: 'separator', label: '', onClick: () => {} });
  }

  // Selection-based actions
  if (selectedObjects.length > 0) {
    actions.push({
      id: 'delete-selected',
      label: `Delete ${selectedObjects.length} Selected`,
      icon: '🗑️',
      shortcut: 'Del',
      danger: true,
      onClick: () => selectedObjects.forEach((id) => onObjectRemove(id)),
    });
    actions.push({ id: 'separator', label: '', onClick: () => {} });
  }

  // Terrain actions
  if (gridPos) {
    actions.push({
      id: 'brush-here',
      label: 'Paint Here',
      icon: '🖌️',
      shortcut: 'B',
      onClick: () => onToolSelect('brush'),
    });
    actions.push({
      id: 'fill-area',
      label: 'Fill Area',
      icon: '🪣',
      shortcut: 'G',
      onClick: onFillArea,
    });
    actions.push({
      id: 'copy-terrain',
      label: 'Copy Terrain',
      icon: '📋',
      shortcut: 'Ctrl+C',
      onClick: onCopyTerrain,
    });
    actions.push({
      id: 'paste-terrain',
      label: 'Paste Terrain',
      icon: '📄',
      shortcut: 'Ctrl+V',
      disabled: !hasCopiedTerrain,
      onClick: onPasteTerrain,
    });

    actions.push({ id: 'separator', label: '', onClick: () => {} });

    // Quick add objects submenu
    const baseTypes = config.objectTypes.filter((t) => t.category === 'bases').slice(0, 3);
    const objectTypes = config.objectTypes.filter((t) => t.category === 'objects').slice(0, 3);

    if (baseTypes.length > 0) {
      for (const objType of baseTypes) {
        actions.push({
          id: `add-${objType.id}`,
          label: `Add ${objType.name}`,
          icon: objType.icon,
          onClick: () => onAddObject(objType.id, gridPos.x, gridPos.y),
        });
      }
    }

    if (objectTypes.length > 0) {
      actions.push({ id: 'separator', label: '', onClick: () => {} });
      for (const objType of objectTypes) {
        actions.push({
          id: `add-${objType.id}`,
          label: `Add ${objType.name}`,
          icon: objType.icon,
          onClick: () => onAddObject(objType.id, gridPos.x, gridPos.y),
        });
      }
    }
  }

  return actions;
}

export default EditorContextMenu;
