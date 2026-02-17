import { create } from 'zustand';

/**
 * Browser's BeforeInstallPromptEvent — not in lib.dom.d.ts yet.
 * Declared globally in src/types/pwa.d.ts
 */
interface PWAState {
  installPrompt: BeforeInstallPromptEvent | null;
  isInstalled: boolean;
  isDismissed: boolean;
  serviceWorkerReady: boolean;

  setInstallPrompt: (prompt: BeforeInstallPromptEvent | null) => void;
  setInstalled: (installed: boolean) => void;
  setServiceWorkerReady: (ready: boolean) => void;
  dismiss: () => void;
}

export const usePWAStore = create<PWAState>((set) => ({
  installPrompt: null,
  isInstalled: false,
  isDismissed: false,
  serviceWorkerReady: false,

  setInstallPrompt: (prompt) => set({ installPrompt: prompt }),
  setInstalled: (installed) => set({ isInstalled: installed }),
  setServiceWorkerReady: (ready) => set({ serviceWorkerReady: ready }),
  dismiss: () => set({ isDismissed: true, installPrompt: null }),
}));
