/**
 * Editor State Hook
 *
 * Manages the complete editor state including:
 * - Current tool and settings
 * - Map data and modifications
 * - Undo/redo history
 * - Selection state
 */

import { useState, useCallback, useRef } from 'react';
import type {
  EditorConfig,
  EditorState,
  EditorMapData,
  EditorCell,
  EditorObject,
  SymmetryMode,
  SnapMode,
} from '../config/EditorConfig';
import { clamp } from '@/utils/math';

// Initial state factory
function createInitialState(config: EditorConfig): EditorState {
  return {
    mapData: null,
    activeTool: config.tools[0]?.id || 'brush',
    selectedElevation: config.terrain.defaultElevation,
    selectedFeature: config.terrain.defaultFeature,
    selectedMaterial: config.terrain.defaultMaterial ?? 0,
    brushSize: config.tools.find((t) => t.hasBrushSize)?.defaultBrushSize || 5,
    zoom: config.canvas.defaultZoom,
    offset: { x: 0, y: 0 },
    selectedObjects: [],
    activePanel: config.panels[0]?.id || 'paint',
    activeBiome: config.biomes[0]?.id || 'default',
    symmetryMode: 'none',
    snapMode: '45deg', // Default to 45-degree snapping for platform tools
    showGuardrails: true,
    isDirty: false,
    undoStack: [],
    redoStack: [],
  };
}

/**
 * Apply symmetry to cell updates
 */
function applySymmetry(
  updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>,
  mode: SymmetryMode,
  width: number,
  height: number
): Array<{ x: number; y: number; cell: Partial<EditorCell> }> {
  if (mode === 'none') return updates;

  const centerX = width / 2;
  const centerY = height / 2;
  const allUpdates = new Map<string, { x: number; y: number; cell: Partial<EditorCell> }>();

  for (const update of updates) {
    // Always add the original update
    allUpdates.set(`${update.x},${update.y}`, update);

    const { x, y, cell } = update;

    switch (mode) {
      case 'x': {
        // Mirror across X axis (vertical line through center)
        const mirrorX = Math.floor(width - 1 - x);
        if (mirrorX >= 0 && mirrorX < width) {
          allUpdates.set(`${mirrorX},${y}`, { x: mirrorX, y, cell: { ...cell } });
        }
        break;
      }
      case 'y': {
        // Mirror across Y axis (horizontal line through center)
        const mirrorY = Math.floor(height - 1 - y);
        if (mirrorY >= 0 && mirrorY < height) {
          allUpdates.set(`${x},${mirrorY}`, { x, y: mirrorY, cell: { ...cell } });
        }
        break;
      }
      case 'both': {
        // Mirror across both axes (4-way symmetry)
        const mirrorX = Math.floor(width - 1 - x);
        const mirrorY = Math.floor(height - 1 - y);
        if (mirrorX >= 0 && mirrorX < width) {
          allUpdates.set(`${mirrorX},${y}`, { x: mirrorX, y, cell: { ...cell } });
        }
        if (mirrorY >= 0 && mirrorY < height) {
          allUpdates.set(`${x},${mirrorY}`, { x, y: mirrorY, cell: { ...cell } });
        }
        if (mirrorX >= 0 && mirrorX < width && mirrorY >= 0 && mirrorY < height) {
          allUpdates.set(`${mirrorX},${mirrorY}`, { x: mirrorX, y: mirrorY, cell: { ...cell } });
        }
        break;
      }
      case 'radial4': {
        // 4-way rotational symmetry (90° rotations)
        const dx = x - centerX;
        const dy = y - centerY;
        const rotations = [
          { x: Math.floor(centerX - dy), y: Math.floor(centerY + dx) }, // 90°
          { x: Math.floor(centerX - dx), y: Math.floor(centerY - dy) }, // 180°
          { x: Math.floor(centerX + dy), y: Math.floor(centerY - dx) }, // 270°
        ];
        for (const rot of rotations) {
          if (rot.x >= 0 && rot.x < width && rot.y >= 0 && rot.y < height) {
            allUpdates.set(`${rot.x},${rot.y}`, { x: rot.x, y: rot.y, cell: { ...cell } });
          }
        }
        break;
      }
      case 'radial8': {
        // 8-way symmetry (45° rotations + mirrors)
        const dx = x - centerX;
        const dy = y - centerY;
        const points = [
          { x: Math.floor(centerX - dy), y: Math.floor(centerY + dx) },
          { x: Math.floor(centerX - dx), y: Math.floor(centerY - dy) },
          { x: Math.floor(centerX + dy), y: Math.floor(centerY - dx) },
          { x: Math.floor(centerX - dx), y: Math.floor(centerY + dy) },
          { x: Math.floor(centerX + dx), y: Math.floor(centerY - dy) },
          { x: Math.floor(centerX + dy), y: Math.floor(centerY + dx) },
          { x: Math.floor(centerX - dy), y: Math.floor(centerY - dx) },
        ];
        for (const pt of points) {
          if (pt.x >= 0 && pt.x < width && pt.y >= 0 && pt.y < height) {
            allUpdates.set(`${pt.x},${pt.y}`, { x: pt.x, y: pt.y, cell: { ...cell } });
          }
        }
        break;
      }
    }
  }

  return Array.from(allUpdates.values());
}

// Deep clone map data for undo history
function cloneMapData(data: EditorMapData): EditorMapData {
  return {
    ...data,
    terrain: data.terrain.map((row) => row.map((cell) => ({ ...cell }))),
    objects: data.objects.map((obj) => ({ ...obj, properties: { ...obj.properties } })),
    metadata: data.metadata ? { ...data.metadata } : undefined,
  };
}

export interface UseEditorStateReturn {
  state: EditorState;

  // Tool actions
  setActiveTool: (toolId: string) => void;
  setSelectedElevation: (elevation: number) => void;
  setSelectedFeature: (feature: string) => void;
  setSelectedMaterial: (materialId: number) => void;
  setBrushSize: (size: number) => void;

  // View actions
  setZoom: (zoom: number) => void;
  setOffset: (offset: { x: number; y: number }) => void;
  setActivePanel: (panelId: string) => void;
  setActiveBiome: (biomeId: string) => void;
  setSymmetryMode: (mode: SymmetryMode) => void;
  setSnapMode: (mode: SnapMode) => void;
  setShowGuardrails: (visible: boolean) => void;

  // Map actions
  loadMap: (data: EditorMapData) => void;
  updateCell: (x: number, y: number, updates: Partial<EditorCell>) => void;
  updateCells: (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => void;
  updateCellsBatched: (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => void;
  startBatch: () => void;
  commitBatch: () => void;
  fillArea: (startX: number, startY: number, targetElevation: number, newElevation: number) => void;

  // Object actions
  addObject: (obj: Omit<EditorObject, 'id'>) => string;
  updateObject: (id: string, updates: Partial<EditorObject>) => void;
  updateObjectProperty: (id: string, key: string, value: unknown) => void;
  removeObject: (id: string) => void;
  replaceObjects: (objects: EditorObject[]) => void;
  selectObjects: (ids: string[]) => void;
  clearSelection: () => void;

  // History actions
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Map metadata
  updateMapMetadata: (updates: Partial<Pick<EditorMapData, 'name' | 'width' | 'height' | 'biomeId'>>) => void;

  // Dirty state
  markClean: () => void;
}

export function useEditorState(config: EditorConfig): UseEditorStateReturn {
  const [state, setState] = useState<EditorState>(() => createInitialState(config));
  const batchStateRef = useRef<EditorMapData | null>(null);
  const isBatchingRef = useRef(false);

  const maxUndoHistory = config.features?.maxUndoHistory ?? 50;

  // Save current state to undo stack (unused but kept for potential future use)
  const _pushToUndoStack = useCallback(() => {
    if (!state.mapData) return;

    setState((prev) => ({
      ...prev,
      undoStack: [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData!)],
      redoStack: [], // Clear redo stack on new action
      isDirty: true,
    }));
  }, [state.mapData, maxUndoHistory]);

  // Tool actions
  const setActiveTool = useCallback((toolId: string) => {
    setState((prev) => ({ ...prev, activeTool: toolId }));
  }, []);

  const setSelectedElevation = useCallback((elevation: number) => {
    setState((prev) => ({ ...prev, selectedElevation: elevation }));
  }, []);

  const setSelectedFeature = useCallback((feature: string) => {
    setState((prev) => ({ ...prev, selectedFeature: feature }));
  }, []);

  const setSelectedMaterial = useCallback((materialId: number) => {
    setState((prev) => ({ ...prev, selectedMaterial: materialId }));
  }, []);

  const setBrushSize = useCallback((size: number) => {
    setState((prev) => ({ ...prev, brushSize: size }));
  }, []);

  // View actions
  const setZoom = useCallback((zoom: number) => {
    const clampedZoom = clamp(zoom, config.canvas.minZoom, config.canvas.maxZoom);
    setState((prev) => ({ ...prev, zoom: clampedZoom }));
  }, [config.canvas.minZoom, config.canvas.maxZoom]);

  const setOffset = useCallback((offset: { x: number; y: number }) => {
    setState((prev) => ({ ...prev, offset }));
  }, []);

  const setActivePanel = useCallback((panelId: string) => {
    setState((prev) => ({ ...prev, activePanel: panelId }));
  }, []);

  const setActiveBiome = useCallback((biomeId: string) => {
    setState((prev) => {
      if (!prev.mapData) return prev;
      return {
        ...prev,
        activeBiome: biomeId,
        mapData: { ...prev.mapData, biomeId },
        isDirty: true,
      };
    });
  }, []);

  const setSymmetryMode = useCallback((mode: SymmetryMode) => {
    setState((prev) => ({ ...prev, symmetryMode: mode }));
  }, []);

  const setSnapMode = useCallback((mode: SnapMode) => {
    setState((prev) => ({ ...prev, snapMode: mode }));
  }, []);

  const setShowGuardrails = useCallback((visible: boolean) => {
    setState((prev) => ({ ...prev, showGuardrails: visible }));
  }, []);

  // Map actions
  const loadMap = useCallback((data: EditorMapData) => {
    setState((prev) => ({
      ...prev,
      mapData: cloneMapData(data),
      activeBiome: data.biomeId,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      selectedObjects: [],
    }));
  }, []);

  const updateCell = useCallback((x: number, y: number, updates: Partial<EditorCell>) => {
    setState((prev) => {
      if (!prev.mapData) return prev;
      if (y < 0 || y >= prev.mapData.height || x < 0 || x >= prev.mapData.width) return prev;

      // Push to undo before modification
      const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

      const newTerrain = prev.mapData.terrain.map((row, rowY) =>
        rowY === y
          ? row.map((cell, cellX) => (cellX === x ? { ...cell, ...updates } : cell))
          : row
      );

      return {
        ...prev,
        mapData: { ...prev.mapData, terrain: newTerrain },
        undoStack: newUndoStack,
        redoStack: [],
        isDirty: true,
      };
    });
  }, [maxUndoHistory]);

  const updateCells = useCallback(
    (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => {
      setState((prev) => {
        if (!prev.mapData) return prev;

        // Push to undo before modification
        const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

        // Create a map of updates for efficient lookup
        const updateMap = new Map<string, Partial<EditorCell>>();
        for (const { x, y, cell } of updates) {
          if (y >= 0 && y < prev.mapData.height && x >= 0 && x < prev.mapData.width) {
            updateMap.set(`${x},${y}`, cell);
          }
        }

        const newTerrain = prev.mapData.terrain.map((row, rowY) =>
          row.map((cell, cellX) => {
            const update = updateMap.get(`${cellX},${rowY}`);
            return update ? { ...cell, ...update } : cell;
          })
        );

        return {
          ...prev,
          mapData: { ...prev.mapData, terrain: newTerrain },
          undoStack: newUndoStack,
          redoStack: [],
          isDirty: true,
        };
      });
    },
    [maxUndoHistory]
  );

  // Batched cell updates - updates without pushing to undo (applies symmetry)
  const updateCellsBatched = useCallback(
    (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => {
      setState((prev) => {
        if (!prev.mapData) return prev;

        // Apply symmetry to updates
        const symmetricUpdates = applySymmetry(
          updates,
          prev.symmetryMode,
          prev.mapData.width,
          prev.mapData.height
        );

        // Create a map of updates for efficient lookup
        const updateMap = new Map<string, Partial<EditorCell>>();
        for (const { x, y, cell } of symmetricUpdates) {
          if (y >= 0 && y < prev.mapData.height && x >= 0 && x < prev.mapData.width) {
            updateMap.set(`${x},${y}`, cell);
          }
        }

        const newTerrain = prev.mapData.terrain.map((row, rowY) =>
          row.map((cell, cellX) => {
            const update = updateMap.get(`${cellX},${rowY}`);
            return update ? { ...cell, ...update } : cell;
          })
        );

        return {
          ...prev,
          mapData: { ...prev.mapData, terrain: newTerrain },
          isDirty: true,
        };
      });
    },
    []
  );

  // Start a batch operation - saves current state for undo
  const startBatch = useCallback(() => {
    // Use functional update to ensure we capture the CURRENT state
    setState((prev) => {
      if (prev.mapData && !isBatchingRef.current) {
        batchStateRef.current = cloneMapData(prev.mapData);
        isBatchingRef.current = true;
      }
      return prev; // Don't modify state, just capture it
    });
  }, []);

  // Commit a batch operation - pushes saved state to undo stack
  const commitBatch = useCallback(() => {
    // Capture ref values BEFORE calling setState to avoid race condition
    const savedState = batchStateRef.current;
    const wasBatching = isBatchingRef.current;

    // Reset refs immediately to prevent double-commits
    batchStateRef.current = null;
    isBatchingRef.current = false;

    if (savedState && wasBatching) {
      setState((prev) => {
        if (!prev.mapData) return prev;

        const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), savedState];

        return {
          ...prev,
          undoStack: newUndoStack,
          redoStack: [],
        };
      });
    }
  }, [maxUndoHistory]);

  const fillArea = useCallback(
    (startX: number, startY: number, targetElevation: number, newElevation: number) => {
      setState((prev) => {
        if (!prev.mapData) return prev;

        const { width, height, terrain } = prev.mapData;
        if (startY < 0 || startY >= height || startX < 0 || startX >= width) return prev;

        // Flood fill algorithm
        const visited = new Set<string>();
        const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
        const cellsToUpdate: Array<{ x: number; y: number }> = [];

        while (queue.length > 0) {
          const { x, y } = queue.shift()!;
          const key = `${x},${y}`;

          if (visited.has(key)) continue;
          if (x < 0 || x >= width || y < 0 || y >= height) continue;

          const cell = terrain[y][x];
          if (cell.elevation !== targetElevation) continue;

          visited.add(key);
          cellsToUpdate.push({ x, y });

          // Add neighbors (4-directional)
          queue.push({ x: x - 1, y });
          queue.push({ x: x + 1, y });
          queue.push({ x, y: y - 1 });
          queue.push({ x, y: y + 1 });
        }

        if (cellsToUpdate.length === 0) return prev;

        // Push to undo
        const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

        // Apply updates
        const newTerrain = terrain.map((row) => row.map((cell) => ({ ...cell })));
        for (const { x, y } of cellsToUpdate) {
          newTerrain[y][x].elevation = newElevation;
        }

        return {
          ...prev,
          mapData: { ...prev.mapData, terrain: newTerrain },
          undoStack: newUndoStack,
          redoStack: [],
          isDirty: true,
        };
      });
    },
    [maxUndoHistory]
  );

  // Object actions
  const addObject = useCallback((obj: Omit<EditorObject, 'id'>): string => {
    const id = `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    setState((prev) => {
      if (!prev.mapData) return prev;

      const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

      return {
        ...prev,
        mapData: {
          ...prev.mapData,
          objects: [...prev.mapData.objects, { ...obj, id }],
        },
        undoStack: newUndoStack,
        redoStack: [],
        isDirty: true,
      };
    });

    return id;
  }, [maxUndoHistory]);

  const updateObject = useCallback((id: string, updates: Partial<EditorObject>) => {
    setState((prev) => {
      if (!prev.mapData) return prev;

      const objIndex = prev.mapData.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return prev;

      const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

      const newObjects = prev.mapData.objects.map((obj, i) =>
        i === objIndex ? { ...obj, ...updates } : obj
      );

      return {
        ...prev,
        mapData: { ...prev.mapData, objects: newObjects },
        undoStack: newUndoStack,
        redoStack: [],
        isDirty: true,
      };
    });
  }, [maxUndoHistory]);

  const updateObjectProperty = useCallback((id: string, key: string, value: unknown) => {
    setState((prev) => {
      if (!prev.mapData) return prev;

      const objIndex = prev.mapData.objects.findIndex((o) => o.id === id);
      if (objIndex === -1) return prev;

      const obj = prev.mapData.objects[objIndex];
      const newProperties = { ...obj.properties, [key]: value };

      const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

      const newObjects = prev.mapData.objects.map((o, i) =>
        i === objIndex ? { ...o, properties: newProperties } : o
      );

      return {
        ...prev,
        mapData: { ...prev.mapData, objects: newObjects },
        undoStack: newUndoStack,
        redoStack: [],
        isDirty: true,
      };
    });
  }, [maxUndoHistory]);

  const removeObject = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.mapData) return prev;

      const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

      return {
        ...prev,
        mapData: {
          ...prev.mapData,
          objects: prev.mapData.objects.filter((o) => o.id !== id),
        },
        selectedObjects: prev.selectedObjects.filter((oid) => oid !== id),
        undoStack: newUndoStack,
        redoStack: [],
        isDirty: true,
      };
    });
  }, [maxUndoHistory]);

  const replaceObjects = useCallback((objects: EditorObject[]) => {
    setState((prev) => {
      if (!prev.mapData) return prev;

      const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

      return {
        ...prev,
        mapData: {
          ...prev.mapData,
          objects,
        },
        selectedObjects: [],
        undoStack: newUndoStack,
        redoStack: [],
        isDirty: true,
      };
    });
  }, [maxUndoHistory]);

  const selectObjects = useCallback((ids: string[]) => {
    setState((prev) => ({ ...prev, selectedObjects: ids }));
  }, []);

  const clearSelection = useCallback(() => {
    setState((prev) => ({ ...prev, selectedObjects: [] }));
  }, []);

  // History actions
  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.undoStack.length === 0 || !prev.mapData) return prev;

      const newUndoStack = [...prev.undoStack];
      const previousState = newUndoStack.pop()!;
      const newRedoStack = [...prev.redoStack, cloneMapData(prev.mapData)];

      return {
        ...prev,
        mapData: previousState,
        undoStack: newUndoStack,
        redoStack: newRedoStack,
        isDirty: newUndoStack.length > 0,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.redoStack.length === 0 || !prev.mapData) return prev;

      const newRedoStack = [...prev.redoStack];
      const nextState = newRedoStack.pop()!;
      const newUndoStack = [...prev.undoStack, cloneMapData(prev.mapData)];

      return {
        ...prev,
        mapData: nextState,
        undoStack: newUndoStack,
        redoStack: newRedoStack,
        isDirty: true,
      };
    });
  }, []);

  // Map metadata
  const updateMapMetadata = useCallback(
    (updates: Partial<Pick<EditorMapData, 'name' | 'width' | 'height' | 'biomeId'>>) => {
      setState((prev) => {
        if (!prev.mapData) return prev;

        // If dimensions change, we need to resize the terrain grid
        if (updates.width !== undefined || updates.height !== undefined) {
          const newWidth = updates.width ?? prev.mapData.width;
          const newHeight = updates.height ?? prev.mapData.height;

          // Push to undo
          const newUndoStack = [...prev.undoStack.slice(-maxUndoHistory + 1), cloneMapData(prev.mapData)];

          // Resize terrain
          const newTerrain: EditorCell[][] = [];
          for (let y = 0; y < newHeight; y++) {
            newTerrain[y] = [];
            for (let x = 0; x < newWidth; x++) {
              if (y < prev.mapData.height && x < prev.mapData.width) {
                newTerrain[y][x] = { ...prev.mapData.terrain[y][x] };
              } else {
                newTerrain[y][x] = {
                  elevation: config.terrain.defaultElevation,
                  feature: config.terrain.defaultFeature,
                  walkable: true,
                };
              }
            }
          }

          return {
            ...prev,
            mapData: {
              ...prev.mapData,
              ...updates,
              terrain: newTerrain,
            },
            undoStack: newUndoStack,
            redoStack: [],
            isDirty: true,
          };
        }

        return {
          ...prev,
          mapData: { ...prev.mapData, ...updates },
          isDirty: true,
        };
      });
    },
    [config.terrain.defaultElevation, config.terrain.defaultFeature, maxUndoHistory]
  );

  // Dirty state
  const markClean = useCallback(() => {
    setState((prev) => ({ ...prev, isDirty: false }));
  }, []);

  // Computed values
  const canUndo = state.undoStack.length > 0;
  const canRedo = state.redoStack.length > 0;

  return {
    state,
    setActiveTool,
    setSelectedElevation,
    setSelectedFeature,
    setSelectedMaterial,
    setBrushSize,
    setZoom,
    setOffset,
    setActivePanel,
    setActiveBiome,
    setSymmetryMode,
    setSnapMode,
    setShowGuardrails,
    loadMap,
    updateCell,
    updateCells,
    updateCellsBatched,
    startBatch,
    commitBatch,
    fillArea,
    addObject,
    updateObject,
    updateObjectProperty,
    removeObject,
    replaceObjects,
    selectObjects,
    clearSelection,
    undo,
    redo,
    canUndo,
    canRedo,
    updateMapMetadata,
    markClean,
  };
}
