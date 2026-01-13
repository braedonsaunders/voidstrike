/**
 * Editor State Hook
 *
 * Manages the complete editor state including:
 * - Current tool and settings
 * - Map data and modifications
 * - Undo/redo history
 * - Selection state
 */

import { useState, useCallback, useMemo } from 'react';
import type {
  EditorConfig,
  EditorState,
  EditorMapData,
  EditorCell,
  EditorObject,
} from '../config/EditorConfig';

// Initial state factory
function createInitialState(config: EditorConfig): EditorState {
  return {
    mapData: null,
    activeTool: config.tools[0]?.id || 'brush',
    selectedElevation: config.terrain.defaultElevation,
    selectedFeature: config.terrain.defaultFeature,
    brushSize: config.tools.find((t) => t.hasBrushSize)?.defaultBrushSize || 5,
    zoom: config.canvas.defaultZoom,
    offset: { x: 0, y: 0 },
    selectedObjects: [],
    activePanel: config.panels[0]?.id || 'paint',
    activeBiome: config.biomes[0]?.id || 'default',
    isDirty: false,
    undoStack: [],
    redoStack: [],
  };
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
  setBrushSize: (size: number) => void;

  // View actions
  setZoom: (zoom: number) => void;
  setOffset: (offset: { x: number; y: number }) => void;
  setActivePanel: (panelId: string) => void;
  setActiveBiome: (biomeId: string) => void;

  // Map actions
  loadMap: (data: EditorMapData) => void;
  updateCell: (x: number, y: number, updates: Partial<EditorCell>) => void;
  updateCells: (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => void;
  fillArea: (startX: number, startY: number, targetElevation: number, newElevation: number) => void;

  // Object actions
  addObject: (obj: Omit<EditorObject, 'id'>) => string;
  updateObject: (id: string, updates: Partial<EditorObject>) => void;
  removeObject: (id: string) => void;
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

  const maxUndoHistory = config.features?.maxUndoHistory ?? 50;

  // Save current state to undo stack
  const pushToUndoStack = useCallback(() => {
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

  const setBrushSize = useCallback((size: number) => {
    setState((prev) => ({ ...prev, brushSize: size }));
  }, []);

  // View actions
  const setZoom = useCallback((zoom: number) => {
    const clampedZoom = Math.max(config.canvas.minZoom, Math.min(config.canvas.maxZoom, zoom));
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
    setBrushSize,
    setZoom,
    setOffset,
    setActivePanel,
    setActiveBiome,
    loadMap,
    updateCell,
    updateCells,
    fillArea,
    addObject,
    updateObject,
    removeObject,
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
