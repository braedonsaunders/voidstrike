/**
 * EditorContextMenu - Right-click context menu for canvas actions
 *
 * Provides quick access to common actions based on what's under the cursor.
 * Supports nested submenus for organized tool access.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import type { EditorConfig, EditorObject, EditorCell } from '../config/EditorConfig';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  submenu?: ContextMenuAction[];
}

export interface EditorContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  onClose: () => void;
  actions: ContextMenuAction[];
  theme: EditorConfig['theme'];
}

function SubMenu({
  items,
  theme,
  onClose,
  parentRef,
}: {
  items: ContextMenuAction[];
  theme: EditorConfig['theme'];
  onClose: () => void;
  parentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<'right' | 'left'>('right');

  useEffect(() => {
    if (!submenuRef.current || !parentRef.current) return;

    const parentRect = parentRef.current.getBoundingClientRect();
    const submenuRect = submenuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    // Check if submenu would overflow right side
    if (parentRect.right + submenuRect.width > viewportWidth - 10) {
      setPosition('left');
    }
  }, [parentRef]);

  return (
    <div
      ref={submenuRef}
      className="absolute py-1 rounded-lg shadow-2xl backdrop-blur-xl min-w-[180px]"
      style={{
        top: 0,
        [position === 'right' ? 'left' : 'right']: '100%',
        marginLeft: position === 'right' ? '2px' : 0,
        marginRight: position === 'left' ? '2px' : 0,
        backgroundColor: 'rgba(30, 30, 40, 0.95)',
        border: `1px solid ${theme.border}`,
      }}
    >
      {items.map((item, index) =>
        item.id === 'separator' ? (
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

function MenuItem({
  action,
  theme,
  onClose,
}: {
  action: ContextMenuAction;
  theme: EditorConfig['theme'];
  onClose: () => void;
}) {
  const [showSubmenu, setShowSubmenu] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const hasSubmenu = action.submenu && action.submenu.length > 0;

  return (
    <div
      ref={itemRef}
      className="relative"
      onMouseEnter={() => hasSubmenu && setShowSubmenu(true)}
      onMouseLeave={() => hasSubmenu && setShowSubmenu(false)}
    >
      <button
        onClick={() => {
          if (!action.disabled && action.onClick && !hasSubmenu) {
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
        {action.shortcut && !hasSubmenu && (
          <span className="text-xs opacity-50">{action.shortcut}</span>
        )}
        {hasSubmenu && <span className="text-xs opacity-50">▶</span>}
      </button>

      {hasSubmenu && showSubmenu && action.submenu && (
        <SubMenu
          items={action.submenu}
          theme={theme}
          onClose={onClose}
          parentRef={itemRef}
        />
      )}
    </div>
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

  // Group actions by separator
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
      className="fixed z-50 min-w-[200px] py-1 rounded-lg shadow-2xl backdrop-blur-xl"
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
  cellAtPosition,
  selectedObjects,
  objectAtPosition,
  config,
  onToolSelect,
  onFillArea,
  onObjectRemove,
  onCopyTerrain,
  onPasteTerrain,
  onAddObject,
  onUndo,
  onRedo,
  hasCopiedTerrain,
  canUndo,
  canRedo,
}: {
  gridPos: { x: number; y: number } | null;
  cellAtPosition?: EditorCell | null;
  selectedObjects: string[];
  objectAtPosition: EditorObject | null;
  config: EditorConfig;
  onToolSelect: (toolId: string) => void;
  onFillArea: () => void;
  onObjectRemove: (id: string) => void;
  onCopyTerrain: () => void;
  onPasteTerrain: () => void;
  onAddObject: (typeId: string, x: number, y: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  hasCopiedTerrain: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
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
      id: 'duplicate-object',
      label: `Duplicate ${objType?.name || 'Object'}`,
      icon: '📋',
      onClick: () => {
        if (gridPos) {
          onAddObject(objectAtPosition.type, gridPos.x + 2, gridPos.y + 2);
        }
      },
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
    // Edit submenu
    actions.push({
      id: 'edit-menu',
      label: 'Edit',
      icon: '✏️',
      submenu: [
        {
          id: 'undo',
          label: 'Undo',
          icon: '↩️',
          shortcut: 'Ctrl+Z',
          disabled: !canUndo,
          onClick: onUndo,
        },
        {
          id: 'redo',
          label: 'Redo',
          icon: '↪️',
          shortcut: 'Ctrl+Y',
          disabled: !canRedo,
          onClick: onRedo,
        },
        { id: 'separator', label: '' },
        {
          id: 'copy-terrain',
          label: 'Copy Terrain',
          icon: '📋',
          shortcut: 'Ctrl+C',
          onClick: onCopyTerrain,
        },
        {
          id: 'paste-terrain',
          label: 'Paste Terrain',
          icon: '📄',
          shortcut: 'Ctrl+V',
          disabled: !hasCopiedTerrain,
          onClick: onPasteTerrain,
        },
      ],
    });

    // Terrain Tools submenu
    actions.push({
      id: 'terrain-tools',
      label: 'Terrain Tools',
      icon: '🏔️',
      submenu: [
        {
          id: 'brush-here',
          label: 'Brush',
          icon: '🖌️',
          shortcut: 'B',
          onClick: () => onToolSelect('brush'),
        },
        {
          id: 'fill-area',
          label: 'Fill Area',
          icon: '🪣',
          shortcut: 'G',
          onClick: onFillArea,
        },
        {
          id: 'eraser',
          label: 'Eraser',
          icon: '🧹',
          shortcut: 'E',
          onClick: () => onToolSelect('eraser'),
        },
        { id: 'separator', label: '' },
        {
          id: 'raise',
          label: 'Raise Terrain',
          icon: '⬆️',
          shortcut: 'Q',
          onClick: () => onToolSelect('raise'),
        },
        {
          id: 'lower',
          label: 'Lower Terrain',
          icon: '⬇️',
          shortcut: 'W',
          onClick: () => onToolSelect('lower'),
        },
        {
          id: 'smooth',
          label: 'Smooth Terrain',
          icon: '〰️',
          shortcut: 'S',
          onClick: () => onToolSelect('smooth'),
        },
        {
          id: 'noise',
          label: 'Add Noise',
          icon: '🌫️',
          shortcut: 'N',
          onClick: () => onToolSelect('noise'),
        },
        {
          id: 'plateau',
          label: 'Flatten/Plateau',
          icon: '⏹️',
          shortcut: 'P',
          onClick: () => onToolSelect('plateau'),
        },
      ],
    });

    // Platform Tools submenu
    actions.push({
      id: 'platform-tools',
      label: 'Platform Tools',
      icon: '⬢',
      submenu: [
        {
          id: 'platform-brush',
          label: 'Platform Brush',
          icon: '⬢',
          shortcut: 'I',
          onClick: () => onToolSelect('platform_brush'),
        },
        {
          id: 'platform-rect',
          label: 'Platform Rectangle',
          icon: '▣',
          shortcut: 'Shift+I',
          onClick: () => onToolSelect('platform_rect'),
        },
        {
          id: 'platform-polygon',
          label: 'Platform Polygon',
          icon: '⬡',
          shortcut: 'Alt+I',
          onClick: () => onToolSelect('platform_polygon'),
        },
        { id: 'separator', label: '' },
        {
          id: 'convert-platform',
          label: 'Convert to Platform',
          icon: '⇄',
          shortcut: 'C',
          onClick: () => onToolSelect('convert_platform'),
        },
        {
          id: 'edge-style',
          label: 'Edit Edge Style',
          icon: '⎕',
          shortcut: 'J',
          onClick: () => onToolSelect('edge_style'),
        },
      ],
    });

    // Shape Tools submenu
    actions.push({
      id: 'shape-tools',
      label: 'Shape Tools',
      icon: '📐',
      submenu: [
        {
          id: 'line',
          label: 'Draw Line',
          icon: '╱',
          shortcut: 'L',
          onClick: () => onToolSelect('line'),
        },
        {
          id: 'rect',
          label: 'Draw Rectangle',
          icon: '▭',
          shortcut: 'R',
          onClick: () => onToolSelect('rect'),
        },
        {
          id: 'ellipse',
          label: 'Draw Ellipse',
          icon: '◯',
          shortcut: 'O',
          onClick: () => onToolSelect('ellipse'),
        },
        { id: 'separator', label: '' },
        {
          id: 'ramp',
          label: 'Draw Ramp',
          icon: '⌓',
          shortcut: 'M',
          onClick: () => onToolSelect('ramp'),
        },
      ],
    });

    // Features submenu
    const featureTools = config.terrain?.features?.filter(f => f.id !== 'none') || [];
    if (featureTools.length > 0) {
      actions.push({
        id: 'features',
        label: 'Terrain Features',
        icon: '🌲',
        submenu: featureTools.map(f => ({
          id: `feature-${f.id}`,
          label: f.name,
          icon: f.id === 'water_shallow' ? '💧' :
                f.id === 'water_deep' ? '🌊' :
                f.id === 'forest_light' ? '🌳' :
                f.id === 'forest_dense' ? '🌲' :
                f.id === 'mud' ? '🟤' :
                f.id === 'road' ? '🛤️' :
                f.id === 'cliff' ? '🏔️' : '⬛',
          onClick: () => {
            // Find and select a tool that paints this feature
            const featureTool = config.tools.find(t =>
              (t as { options?: Record<string, unknown> }).options?.feature === f.id
            );
            if (featureTool) {
              onToolSelect(featureTool.id);
            }
          },
        })),
      });
    }

    actions.push({ id: 'separator', label: '' });

    // Add Objects submenus by category
    const categories = [...new Set(config.objectTypes.map(t => t.category))];

    for (const category of categories) {
      const categoryObjects = config.objectTypes.filter(t => t.category === category);
      if (categoryObjects.length === 0) continue;

      const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
      const categoryIcon = category === 'bases' ? '🏠' :
                          category === 'resources' ? '💎' :
                          category === 'objects' ? '🪨' :
                          category === 'units' ? '🎖️' :
                          category === 'decorations' ? '🌸' : '📦';

      actions.push({
        id: `add-${category}`,
        label: `Add ${categoryLabel}`,
        icon: categoryIcon,
        submenu: categoryObjects.map(objType => ({
          id: `add-${objType.id}`,
          label: objType.name,
          icon: objType.icon,
          onClick: () => onAddObject(objType.id, gridPos.x, gridPos.y),
        })),
      });
    }

    // Cell info (if platform)
    if (cellAtPosition?.isPlatform) {
      actions.push({ id: 'separator', label: '' });
      actions.push({
        id: 'cell-info',
        label: `Platform Cell (Elev: ${cellAtPosition.elevation})`,
        icon: 'ℹ️',
        disabled: true,
      });
    }
  }

  return actions;
}

export default EditorContextMenu;
