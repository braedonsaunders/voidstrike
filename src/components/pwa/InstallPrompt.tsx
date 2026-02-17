'use client';

import { useCallback } from 'react';
import { usePWAStore } from '@/store/pwaStore';

/**
 * Non-intrusive "Install App" button. Only renders when the browser
 * has fired beforeinstallprompt and the app is not already installed.
 */
export function InstallPrompt() {
  const installPrompt = usePWAStore((s) => s.installPrompt);
  const isInstalled = usePWAStore((s) => s.isInstalled);
  const isDismissed = usePWAStore((s) => s.isDismissed);
  const dismiss = usePWAStore((s) => s.dismiss);
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
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={handleInstall}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg
                   bg-gradient-to-b from-void-600 to-void-800
                   border border-void-400/30 hover:border-void-400/60
                   text-white/90 text-sm tracking-wide
                   shadow-lg shadow-void-900/50
                   hover:from-void-500 hover:to-void-700
                   transition-all duration-200 hover:scale-105
                   active:scale-95"
      >
        <svg
          className="w-4 h-4"
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
        Install App
      </button>
      <button
        onClick={dismiss}
        className="w-8 h-8 rounded-full flex items-center justify-center
                   bg-white/5 hover:bg-white/10 border border-white/10
                   text-white/50 hover:text-white/80
                   transition-all duration-200"
        title="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
