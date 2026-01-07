'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  delay?: number;
  className?: string;
}

export function Tooltip({ children, content, delay = 200, className = '' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      });
    }
  };

  const handleMouseEnter = () => {
    updatePosition();
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={className}
      >
        {children}
      </div>
      {mounted && isVisible && createPortal(
        <div
          className="fixed z-[100] pointer-events-none"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-void-950 border border-void-600 rounded-lg shadow-xl p-3 max-w-xs">
            {content}
          </div>
          {/* Arrow */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-void-950 border-r border-b border-void-600 rotate-45" />
        </div>,
        document.body
      )}
    </>
  );
}
