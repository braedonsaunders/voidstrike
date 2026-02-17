// BeforeInstallPromptEvent — not in lib.dom.d.ts as of TS 5.x
// https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}
