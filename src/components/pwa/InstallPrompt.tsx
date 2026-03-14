'use client';

import { useCallback, type CSSProperties } from 'react';
import { usePWAStore } from '@/store/pwaStore';

interface InstallAppButtonProps {
  className?: string;
  iconClassName?: string;
  style?: CSSProperties;
  title?: string;
}

/**
 * Compact install button for existing header control clusters.
 */
export function InstallAppButton({
  className = '',
  iconClassName = 'w-4 h-4',
  style,
  title = 'Install App',
}: InstallAppButtonProps) {
  const installPrompt = usePWAStore((s) => s.installPrompt);
  const isInstalled = usePWAStore((s) => s.isInstalled);
  const isDismissed = usePWAStore((s) => s.isDismissed);
  const setInstalled = usePWAStore((s) => s.setInstalled);
  const setInstallPrompt = usePWAStore((s) => s.setInstallPrompt);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;

    await installPrompt.prompt();
    const result = await installPrompt.userChoice;

    if (result.outcome === 'accepted') {
      setInstalled(true);
    }
    // Prompt can only be used once
    setInstallPrompt(null);
  }, [installPrompt, setInstalled, setInstallPrompt]);

  // Don't render if no prompt, already installed, or dismissed
  if (!installPrompt || isInstalled || isDismissed) return null;

  return (
    <button
      onClick={handleInstall}
      className={className}
      style={style}
      title={title}
      aria-label={title}
    >
      <svg
        className={iconClassName}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
        />
      </svg>
    </button>
  );
}
