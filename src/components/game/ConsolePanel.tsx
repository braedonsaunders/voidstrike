'use client';

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { ConsoleEngine, ConsoleEntry, getConsoleEngine } from '@/engine/debug/ConsoleEngine';

/**
 * Debug Console Panel
 *
 * A minimal, draggable, resizable console for debug commands.
 * Single-player only.
 */
export const ConsolePanel = memo(function ConsolePanel() {
  const { showConsole, setShowConsole } = useUIStore();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ConsoleEntry[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const [engine, setEngine] = useState<ConsoleEngine | null>(null);

  // Position and size state
  const [position, setPosition] = useState({ x: 50, y: 100 });
  const [size, setSize] = useState({ width: 500, height: 220 });

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Initialize console engine
  useEffect(() => {
    let mounted = true;

    getConsoleEngine().then((eng) => {
      if (mounted) {
        setEngine(eng);
        setHistory(eng.getHistory());

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
  }, []);

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

  // Handle drag
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      } else if (isResizing) {
        const panel = panelRef.current;
        if (panel) {
          const rect = panel.getBoundingClientRect();
          setSize({
            width: Math.max(300, e.clientX - rect.left),
            height: Math.max(120, e.clientY - rect.top),
          });
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    setIsDragging(true);
  }, [position]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
  }, []);

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
            setInput(suggestions[selectedSuggestion] + ' ');
            setSuggestions([]);
            setSelectedSuggestion(-1);
          } else if (input.trim()) {
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

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInput(suggestion + ' ');
    setSuggestions([]);
    setSelectedSuggestion(-1);
    inputRef.current?.focus();
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const getEntryColor = (type: ConsoleEntry['type']): string => {
    switch (type) {
      case 'input': return '#888';
      case 'output': return '#ccc';
      case 'error': return '#f66';
      case 'success': return '#6f6';
      case 'info': return '#6af';
      default: return '#ccc';
    }
  };

  if (!showConsole) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '6px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '11px',
        zIndex: 1100,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onWheel={handleWheel}
      onClick={handleClick}
    >
      {/* Draggable Header */}
      <div
        onMouseDown={handleDragStart}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 8px',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          cursor: 'move',
          userSelect: 'none',
        }}
      >
        <span style={{ color: '#888', fontSize: '10px', fontWeight: 500, letterSpacing: '0.5px' }}>
          CONSOLE
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {engine && (
            <span style={{ fontSize: '9px', display: 'flex', gap: '4px' }}>
              {engine.getFlag('godMode') && <span style={{ color: '#fa0', padding: '1px 4px', backgroundColor: 'rgba(255,170,0,0.2)', borderRadius: '2px' }}>GOD</span>}
              {engine.getFlag('fogDisabled') && <span style={{ color: '#6af', padding: '1px 4px', backgroundColor: 'rgba(102,170,255,0.2)', borderRadius: '2px' }}>REVEALED</span>}
              {engine.getFlag('noCost') && <span style={{ color: '#6f6', padding: '1px 4px', backgroundColor: 'rgba(102,255,102,0.2)', borderRadius: '2px' }}>FREE</span>}
              {engine.getFlag('fastBuild') && <span style={{ color: '#f6f', padding: '1px 4px', backgroundColor: 'rgba(255,102,255,0.2)', borderRadius: '2px' }}>FAST</span>}
            </span>
          )}
          <button
            onClick={() => setShowConsole(false)}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '0 2px',
              lineHeight: 1,
            }}
            aria-label="Close console"
          >
            ×
          </button>
        </div>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 8px',
          minHeight: 0,
        }}
      >
        {history.length === 0 ? (
          <div style={{ color: '#666', fontStyle: 'italic' }}>
            Type &quot;help&quot; for commands. Press ` to toggle.
          </div>
        ) : (
          history.map((entry) => (
            <div
              key={entry.id}
              style={{
                color: getEntryColor(entry.type),
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                marginBottom: '1px',
                lineHeight: 1.3,
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
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderBottom: 'none',
              borderRadius: '4px 4px 0 0',
              maxHeight: '100px',
              overflowY: 'auto',
            }}
          >
            {suggestions.map((suggestion, idx) => (
              <div
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                style={{
                  padding: '3px 8px',
                  cursor: 'pointer',
                  backgroundColor: idx === selectedSuggestion ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                  color: idx === selectedSuggestion ? '#fff' : '#aaa',
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
            padding: '5px 8px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
          }}
        >
          <span style={{ color: '#6f6', marginRight: '5px', fontWeight: 'bold' }}>&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="command..."
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#ddd',
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: '12px',
          height: '12px',
          cursor: 'se-resize',
          opacity: 0.5,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M10 2L2 10M10 6L6 10M10 10L10 10" stroke="#666" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  );
});

export default ConsolePanel;
