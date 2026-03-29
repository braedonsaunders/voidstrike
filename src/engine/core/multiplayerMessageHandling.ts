import type { GameConfig } from './GameCore';

/**
 * In worker mode, WorkerBridge forwards inbound peer commands to GameWorker and the
 * main-thread Game instance must stay out of lockstep validation to avoid duplicate
 * processing against a non-advancing local tick.
 */
export function shouldHandleMultiplayerMessagesOnMainThread(
  config: Pick<GameConfig, 'isMultiplayer' | 'multiplayerMessageHandling'>
): boolean {
  return config.isMultiplayer && config.multiplayerMessageHandling !== 'worker';
}
