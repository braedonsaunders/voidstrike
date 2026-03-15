let latestGamePageMountId = 0;

/**
 * Defers teardown long enough to distinguish a real /game unmount from
 * React Strict Mode's immediate development remount probe.
 */
export function registerGamePageUnmount(onRealUnmount: () => void): () => void {
  const mountId = ++latestGamePageMountId;

  return () => {
    queueMicrotask(() => {
      if (latestGamePageMountId !== mountId) {
        return;
      }

      onRealUnmount();
    });
  };
}

export function resetGamePageLifecycleForTests(): void {
  latestGamePageMountId = 0;
}
