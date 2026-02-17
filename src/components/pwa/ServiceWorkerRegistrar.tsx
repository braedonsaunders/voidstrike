'use client';

import { useEffect } from 'react';
import { usePWAStore } from '@/store/pwaStore';

/**
 * Registers the service worker and captures the beforeinstallprompt event.
 * Renders nothing — include once in the root layout.
 */
export function ServiceWorkerRegistrar() {
  const setInstallPrompt = usePWAStore((s) => s.setInstallPrompt);
  const setInstalled = usePWAStore((s) => s.setInstalled);
  const setServiceWorkerReady = usePWAStore((s) => s.setServiceWorkerReady);

  useEffect(() => {
    // Service worker registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then(() => {
          setServiceWorkerReady(true);
        })
        .catch((error) => {
          console.warn('[PWA] Service worker registration failed:', error);
        });
    }

    // Capture install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    // Detect if already installed
    const handleAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Check if running in standalone mode (already installed)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [setInstallPrompt, setInstalled, setServiceWorkerReady]);

  return null;
}
