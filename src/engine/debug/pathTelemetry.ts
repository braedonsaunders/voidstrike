export interface PathTelemetryEvent {
  source: 'ui' | 'worker' | 'bridge' | 'system';
  kind: string;
  timestamp?: string;
  tick?: number;
  gameTime?: number;
  entityId?: number;
  entityIds?: number[];
  payload: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 250;
const MAX_BUFFERED_EVENTS = 400;
const MAX_BATCH_SIZE = 50;

let telemetrySessionId: string | null = null;
let queuedEvents: PathTelemetryEvent[] = [];
let flushTimer: number | null = null;
let lifecycleHookInstalled = false;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function isPathTelemetryEnabled(): boolean {
  if (!isBrowser()) return false;

  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return true;
  }

  return new URLSearchParams(window.location.search).get('pathTelemetry') === '1';
}

function installLifecycleHooks(): void {
  if (!isBrowser() || lifecycleHookInstalled) return;

  lifecycleHookInstalled = true;
  const flushOnHide = () => {
    void flushPathTelemetry(true);
  };

  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('beforeunload', flushOnHide);
}

function getTelemetrySessionIdInternal(): string {
  if (telemetrySessionId) {
    return telemetrySessionId;
  }

  telemetrySessionId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `path-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  installLifecycleHooks();
  return telemetrySessionId;
}

export function getPathTelemetrySessionId(): string | null {
  return isPathTelemetryEnabled() ? getTelemetrySessionIdInternal() : null;
}

export function recordPathTelemetry(event: PathTelemetryEvent): void {
  if (!isPathTelemetryEnabled()) return;

  queuedEvents.push({
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });

  if (queuedEvents.length > MAX_BUFFERED_EVENTS) {
    queuedEvents = queuedEvents.slice(-MAX_BUFFERED_EVENTS);
  }

  if (flushTimer === null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void flushPathTelemetry(false);
    }, FLUSH_INTERVAL_MS);
  }
}

export async function flushPathTelemetry(useBeacon: boolean): Promise<void> {
  if (!isPathTelemetryEnabled() || queuedEvents.length === 0) return;

  const sessionId = getTelemetrySessionIdInternal();
  const batch = queuedEvents.splice(0, MAX_BATCH_SIZE);
  const body = JSON.stringify({
    sessionId,
    href: window.location.href,
    events: batch,
  });

  try {
    if (
      useBeacon &&
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/debug/pathfinding', blob);
    } else {
      await fetch('/api/debug/pathfinding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: useBeacon,
      });
    }
  } catch {
    queuedEvents = [...batch, ...queuedEvents].slice(-MAX_BUFFERED_EVENTS);
    return;
  }

  if (queuedEvents.length > 0) {
    if (useBeacon) {
      return;
    }
    await flushPathTelemetry(false);
  }
}
