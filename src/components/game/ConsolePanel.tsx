'use client';

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { ConsoleEngine, ConsoleEntry, getConsoleEngine } from '@/engine/debug/ConsoleEngine';
import { Game } from '@/engine/core/Game';
import { RTSCamera } from '@/rendering/Camera';

interface ConsolePanelProps {
  gameRef?: React.MutableRefObject<Game | null>;
  cameraRef?: React.MutableRefObject<RTSCamera | null>;
}

/**
 * Debug Console Panel
 *
 * A terminal-style console for executing debug commands.
 * Disabled in multiplayer mode.
 */
export const ConsolePanel = memo(function ConsolePanel({ gameRef, cameraRef }: ConsolePanelProps) {
  const { showConsole, setShowConsole } = useUIStore();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ConsoleEntry[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const [engine, setEngine] = useState<ConsoleEngine | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Initialize console engine
  useEffect(() => {
    let mounted = true;

    getConsoleEngine().then((eng) => {
      if (mounted) {
        setEngine(eng);
        setHistory(eng.getHistory());

        // Set up game references
        if (gameRef?.current) {
          eng.setGame(gameRef.current);
        }
        if (cameraRef?.current) {
          eng.setCamera(cameraRef.current);
        }

        // Listen for history changes
        const handleHistoryChange = () => {
          setHistory(eng.getHistory());
        };
        eng.addOutputListener(handleHistoryChange);

        return () => {
          eng.removeOutputListener(handleHistoryChange);
        };
      }
    });

    return () => {
      mounted = false;
    };
  }, [gameRef, cameraRef]);

  // Update game/camera refs when they change
  useEffect(() => {
    if (engine) {
      if (gameRef?.current) {
        engine.setGame(gameRef.current);
      }
      if (cameraRef?.current) {
        engine.setCamera(cameraRef.current);
      }
    }
  }, [engine, gameRef?.current, cameraRef?.current]);

  // Focus input when console opens
  useEffect(() => {
    if (showConsole && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showConsole]);

  // Scroll to bottom when history changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  // Handle input change with autocomplete
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInput(value);
      setSelectedSuggestion(-1);

      if (engine && value.trim()) {
        const parts = value.trim().split(/\s+/);
        if (parts.length === 1) {
          setSuggestions(engine.getSuggestions(parts[0]));
        } else {
          setSuggestions([]);
        }
      } else {
        setSuggestions([]);
      }
    },
    [engine]
  );

  // Handle key events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!engine) return;

      switch (e.key) {
        case 'Enter': {
          e.preventDefault();
          if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
            // Apply suggestion
            setInput(suggestions[selectedSuggestion] + ' ');
            setSuggestions([]);
            setSelectedSuggestion(-1);
          } else if (input.trim()) {
            // Execute command
            engine.execute(input);
            setInput('');
            setSuggestions([]);
          }
          break;
        }

        case 'Tab': {
          e.preventDefault();
          if (suggestions.length > 0) {
            const idx = selectedSuggestion < 0 ? 0 : (selectedSuggestion + 1) % suggestions.length;
            setSelectedSuggestion(idx);
          }
          break;
        }

        case 'ArrowUp': {
          e.preventDefault();
          if (suggestions.length > 0 && selectedSuggestion >= 0) {
            setSelectedSuggestion(Math.max(0, selectedSuggestion - 1));
          } else {
            const prev = engine.navigateHistoryUp();
            if (prev !== null) {
              setInput(prev);
              setSuggestions([]);
            }
          }
          break;
        }

        case 'ArrowDown': {
          e.preventDefault();
          if (suggestions.length > 0 && selectedSuggestion >= 0) {
            setSelectedSuggestion(Math.min(suggestions.length - 1, selectedSuggestion + 1));
          } else {
            const next = engine.navigateHistoryDown();
            if (next !== null) {
              setInput(next);
              setSuggestions([]);
            }
          }
          break;
        }

        case 'Escape': {
          e.preventDefault();
          if (suggestions.length > 0) {
            setSuggestions([]);
            setSelectedSuggestion(-1);
          } else {
            setShowConsole(false);
          }
          break;
        }
      }
    },
    [engine, input, suggestions, selectedSuggestion, setShowConsole]
  );

  // Handle suggestion click
  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInput(suggestion + ' ');
    setSuggestions([]);
    setSelectedSuggestion(-1);
    inputRef.current?.focus();
  }, []);

  // Prevent scroll events from reaching game canvas
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // Prevent click events from reaching game canvas
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Get color for entry type
  const getEntryColor = (type: ConsoleEntry['type']): string => {
    switch (type) {
      case 'input':
        return '#9ca3af'; // gray-400
      case 'output':
        return '#e5e7eb'; // gray-200
      case 'error':
        return '#f87171'; // red-400
      case 'success':
        return '#4ade80'; // green-400
      case 'info':
        return '#60a5fa'; // blue-400
      default:
        return '#e5e7eb';
    }
  };

  if (!showConsole) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '180px',
        left: '220px',
        right: '220px',
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        border: '1px solid #333',
        borderRadius: '4px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: '12px',
        zIndex: 1100,
        pointerEvents: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '300px',
      }}
      onWheel={handleWheel}
      onClick={handleClick}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: '1px solid #333',
          backgroundColor: 'rgba(30, 30, 30, 0.9)',
        }}
      >
        <span style={{ color: '#9ca3af', fontSize: '11px', fontWeight: 500 }}>
          Console
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {engine && (
            <span style={{ color: '#6b7280', fontSize: '10px' }}>
              {engine.getFlag('godMode') && <span style={{ color: '#fbbf24', marginRight: '6px' }}>GOD</span>}
              {engine.getFlag('fogDisabled') && <span style={{ color: '#60a5fa', marginRight: '6px' }}>FOG OFF</span>}
              {engine.getFlag('noCost') && <span style={{ color: '#4ade80', marginRight: '6px' }}>FREE</span>}
              {engine.getFlag('fastBuild') && <span style={{ color: '#c084fc', marginRight: '6px' }}>FAST</span>}
            </span>
          )}
          <button
            onClick={() => setShowConsole(false)}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '2px 4px',
              lineHeight: 1,
            }}
            aria-label="Close console"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 10px',
          minHeight: '100px',
          maxHeight: '200px',
        }}
      >
        {history.length === 0 ? (
          <div style={{ color: '#6b7280', fontStyle: 'italic' }}>
            Type &quot;help&quot; for a list of commands.
          </div>
        ) : (
          history.map((entry) => (
            <div
              key={entry.id}
              style={{
                color: getEntryColor(entry.type),
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                marginBottom: '2px',
                lineHeight: 1.4,
              }}
            >
              {entry.text}
            </div>
          ))
        )}
      </div>

      {/* Input area */}
      <div style={{ position: 'relative' }}>
        {/* Suggestions dropdown */}
        {suggestions.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              backgroundColor: 'rgba(30, 30, 30, 0.98)',
              border: '1px solid #444',
              borderBottom: 'none',
              borderRadius: '4px 4px 0 0',
              maxHeight: '120px',
              overflowY: 'auto',
            }}
          >
            {suggestions.map((suggestion, idx) => (
              <div
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                style={{
                  padding: '4px 10px',
                  cursor: 'pointer',
                  backgroundColor: idx === selectedSuggestion ? '#374151' : 'transparent',
                  color: idx === selectedSuggestion ? '#fff' : '#9ca3af',
                }}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 10px',
            borderTop: '1px solid #333',
            backgroundColor: 'rgba(20, 20, 20, 0.9)',
          }}
        >
          <span style={{ color: '#4ade80', marginRight: '6px' }}>&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Enter command..."
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e5e7eb',
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
});

export default ConsolePanel;
