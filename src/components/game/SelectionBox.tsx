'use client';

interface SelectionBoxProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function SelectionBox({ startX, startY, endX, endY }: SelectionBoxProps) {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  // Don't render if too small
  if (width < 5 && height < 5) return null;

  return (
    <div
      className="selection-box"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
    />
  );
}
