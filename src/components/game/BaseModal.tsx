'use client';

import React, { memo, useEffect, useCallback, ReactNode } from 'react';

export interface BaseModalProps {
  /** Modal title displayed in header */
  title: string;
  /** Content to render inside modal */
  children: ReactNode;
  /** Whether modal is visible */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Modal width (default: 900px) */
  width?: string;
  /** Maximum width (default: 95vw) */
  maxWidth?: string;
  /** Modal height (default: auto) */
  height?: string;
  /** Maximum height (default: 90vh) */
  maxHeight?: string;
  /** Backdrop opacity (default: 0.7) */
  backdropOpacity?: number;
  /** Additional close keys (Escape is always included) */
  closeKeys?: string[];
  /** Close hint text shown in header */
  closeHint?: string;
  /** Whether to show close hint (default: true) */
  showCloseHint?: boolean;
  /** Custom class name for modal content */
  className?: string;
  /** Test ID for testing */
  testId?: string;
}

/**
 * BaseModal - Shared fullscreen modal component for large dialogs
 *
 * Used by: TechTreePanel, KeyboardShortcutsPanel
 *
 * Provides:
 * - Fullscreen backdrop overlay
 * - Centered modal content
 * - Header with title, close hint, and close button
 * - ESC key and backdrop click to close
 * - Pointer event isolation
 */
export const BaseModal = memo(function BaseModal({
  title,
  children,
  isOpen,
  onClose,
  width = '900px',
  maxWidth = '95vw',
  height,
  maxHeight = '90vh',
  backdropOpacity = 0.7,
  closeKeys = [],
  closeHint,
  showCloseHint = true,
  className = '',
  testId,
}: BaseModalProps) {
  // Handle keyboard shortcuts to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || closeKeys.includes(e.key)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, closeKeys]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  const defaultCloseHint = closeKeys.length > 0
    ? `Press ESC${closeKeys.map(k => ` or ${k}`).join('')} to close`
    : 'Press ESC or click outside to close';

  return (
    <div
      data-testid={testId}
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})` }}
      onClick={handleBackdropClick}
    >
      <div
        className={`bg-void-900 border border-void-600 rounded-lg shadow-xl flex flex-col ${className}`}
        style={{
          width,
          maxWidth,
          height,
          maxHeight,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-void-700 flex-shrink-0">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <div className="flex items-center gap-2">
            {showCloseHint && (
              <span className="text-void-500 text-sm">
                {closeHint || defaultCloseHint}
              </span>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center bg-red-900/50 hover:bg-red-800 text-white rounded border border-red-700 transition-colors text-xl leading-none"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        {children}
      </div>
    </div>
  );
});

export default BaseModal;
