'use client';

import { memo } from 'react';

interface EmptySlotProps {
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Empty placeholder slot for command grid.
 */
function EmptySlotInner({
  width = 72,
  height = 58,
  className = '',
}: EmptySlotProps) {
  return (
    <div
      className={`bg-void-900/30 border border-void-800/20 rounded ${className}`}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}

export const EmptySlot = memo(EmptySlotInner);
