'use client';

import { memo, ReactNode } from 'react';

interface IconBadgeProps {
  icon: ReactNode;
  badge?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Icon with optional hotkey badge overlay in bottom-right corner.
 */
function IconBadgeInner({ icon, badge, size = 'md', className = '' }: IconBadgeProps) {
  const iconSize = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-xl',
  }[size];

  const badgeSize = {
    sm: 'text-[6px]',
    md: 'text-[7px]',
    lg: 'text-[8px]',
  }[size];

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <span className={`${iconSize} leading-none`}>{icon}</span>
      {badge && (
        <span
          className={`absolute bottom-0 right-0.5 ${badgeSize} text-void-500 font-mono`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

export const IconBadge = memo(IconBadgeInner);
