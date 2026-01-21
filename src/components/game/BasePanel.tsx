'use client';

import React, { memo, useCallback, ReactNode } from 'react';

/**
 * Base positioning for floating panels
 * All floating option panels share: absolute positioned, top-right area
 */
export interface BasePanelProps {
  /** Panel title displayed in header */
  title: string;
  /** Content to render inside panel */
  children: ReactNode;
  /** Close callback - if provided, shows close button */
  onClose?: () => void;
  /** Panel width in pixels (default: 280) */
  width?: number;
  /** Minimum width in pixels */
  minWidth?: number;
  /** Maximum height (default: '80vh') */
  maxHeight?: string;
  /** Optional badge shown next to title */
  badge?: {
    text: string;
    color: 'green' | 'yellow' | 'blue';
  };
  /** Optional header actions (rendered between title and close button) */
  headerActions?: ReactNode;
  /** Custom font family override */
  fontFamily?: string;
  /** Custom background color (default: rgba(10, 10, 12, 0.98)) */
  backgroundColor?: string;
  /** Custom border color (default: #333) */
  borderColor?: string;
  /** Whether to show header border-bottom (default: true) */
  showHeaderBorder?: boolean;
  /** Custom class name for additional styling */
  className?: string;
  /** Test ID for testing */
  testId?: string;
}

const BADGE_COLORS = {
  green: {
    bg: 'rgba(34, 197, 94, 0.15)',
    border: '#22c55e40',
    text: '#22c55e',
  },
  yellow: {
    bg: 'rgba(234, 179, 8, 0.15)',
    border: '#eab30840',
    text: '#eab308',
  },
  blue: {
    bg: 'rgba(59, 130, 246, 0.15)',
    border: '#3b82f640',
    text: '#3b82f6',
  },
} as const;

/**
 * BasePanel - Shared floating panel component for options/settings panels
 *
 * Used by: PerformancePanel, SoundOptionsPanel, GraphicsOptionsPanel, DebugMenuPanel
 *
 * Provides:
 * - Consistent positioning (absolute, top-right)
 * - Unified styling (dark theme, border, shadow)
 * - Header with title, optional badge, and close button
 * - Scroll handling (prevents game canvas scroll)
 * - Pointer event isolation
 */
export const BasePanel = memo(function BasePanel({
  title,
  children,
  onClose,
  width = 280,
  minWidth,
  maxHeight = '80vh',
  badge,
  headerActions,
  fontFamily = 'system-ui, -apple-system, sans-serif',
  backgroundColor = 'rgba(10, 10, 12, 0.98)',
  borderColor = '#333',
  showHeaderBorder = true,
  className = '',
  testId,
}: BasePanelProps) {
  // Prevent scroll events from reaching game canvas
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // Prevent click events from reaching game canvas
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const badgeColors = badge ? BADGE_COLORS[badge.color] : null;

  return (
    <div
      data-testid={testId}
      className={className}
      style={{
        position: 'absolute',
        top: '50px',
        right: '10px',
        backgroundColor,
        border: `1px solid ${borderColor}`,
        borderRadius: '8px',
        padding: '12px',
        color: 'white',
        fontFamily,
        fontSize: '12px',
        zIndex: 1000,
        width: width ? `${width}px` : undefined,
        minWidth: minWidth ? `${minWidth}px` : undefined,
        maxHeight,
        overflowY: 'auto',
        pointerEvents: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
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
          marginBottom: '12px',
          paddingBottom: showHeaderBorder ? '8px' : 0,
          borderBottom: showHeaderBorder ? '1px solid #222' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>{title}</span>
          {badge && badgeColors && (
            <span
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '9px',
                fontWeight: 600,
                backgroundColor: badgeColors.bg,
                color: badgeColors.text,
                border: `1px solid ${badgeColors.border}`,
              }}
            >
              {badge.text}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {headerActions}
          {onClose && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '4px',
                lineHeight: 1,
              }}
              aria-label="Close panel"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {children}
    </div>
  );
});

export default BasePanel;
