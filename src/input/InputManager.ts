import { Game } from '@/engine/core/Game';
import { useGameStore } from '@/store/gameStore';

export type InputMode = 'normal' | 'attack' | 'build' | 'rally';

interface KeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: string;
}

const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // Selection
  { key: 'Escape', action: 'cancel' },

  // Control groups
  { key: '1', action: 'selectGroup1' },
  { key: '2', action: 'selectGroup2' },
  { key: '3', action: 'selectGroup3' },
  { key: '4', action: 'selectGroup4' },
  { key: '5', action: 'selectGroup5' },
  { key: '6', action: 'selectGroup6' },
  { key: '7', action: 'selectGroup7' },
  { key: '8', action: 'selectGroup8' },
  { key: '9', action: 'selectGroup9' },
  { key: '0', action: 'selectGroup0' },
  { key: '1', ctrl: true, action: 'setGroup1' },
  { key: '2', ctrl: true, action: 'setGroup2' },
  { key: '3', ctrl: true, action: 'setGroup3' },
  { key: '4', ctrl: true, action: 'setGroup4' },
  { key: '5', ctrl: true, action: 'setGroup5' },
  { key: '6', ctrl: true, action: 'setGroup6' },
  { key: '7', ctrl: true, action: 'setGroup7' },
  { key: '8', ctrl: true, action: 'setGroup8' },
  { key: '9', ctrl: true, action: 'setGroup9' },
  { key: '0', ctrl: true, action: 'setGroup0' },

  // Commands
  { key: 'a', action: 'attackMode' },
  { key: 's', action: 'stop' },
  { key: 'h', action: 'holdPosition' },
  { key: 'm', action: 'moveMode' },
  { key: 'p', action: 'patrol' },

  // Camera
  { key: 'Space', action: 'jumpToSelection' },
  { key: 'Backspace', action: 'jumpToLastEvent' },

  // Game
  { key: 'F10', action: 'openMenu' },
  { key: 'Pause', action: 'togglePause' },
];

export class InputManager {
  private game: Game;
  private mode: InputMode = 'normal';
  private keybindings: Map<string, KeyBinding> = new Map();

  constructor(game: Game) {
    this.game = game;
    this.loadKeybindings(DEFAULT_KEYBINDINGS);
    this.setupEventListeners();
  }

  private loadKeybindings(bindings: KeyBinding[]): void {
    for (const binding of bindings) {
      const key = this.getKeyId(binding.key, binding.ctrl, binding.shift, binding.alt);
      this.keybindings.set(key, binding);
    }
  }

  private getKeyId(
    key: string,
    ctrl = false,
    shift = false,
    alt = false
  ): string {
    const parts: string[] = [];
    if (ctrl) parts.push('ctrl');
    if (shift) parts.push('shift');
    if (alt) parts.push('alt');
    parts.push(key.toLowerCase());
    return parts.join('+');
  }

  private setupEventListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const keyId = this.getKeyId(e.key, e.ctrlKey, e.shiftKey, e.altKey);
    const binding = this.keybindings.get(keyId);

    if (binding) {
      e.preventDefault();
      this.executeAction(binding.action);
    }
  }

  private handleKeyUp(_e: KeyboardEvent): void {
    // Handle key release if needed
  }

  private executeAction(action: string): void {
    const store = useGameStore.getState();
    const selectedUnits = store.selectedUnits;

    switch (action) {
      case 'cancel':
        if (store.isBuilding) {
          store.setBuildingMode(null);
        } else {
          this.game.eventBus.emit('selection:clear');
        }
        this.mode = 'normal';
        break;

      case 'stop':
        if (selectedUnits.length > 0) {
          this.game.processCommand({
            tick: this.game.getCurrentTick(),
            playerId: store.playerId,
            type: 'STOP',
            entityIds: selectedUnits,
          });
        }
        break;

      case 'holdPosition':
        if (selectedUnits.length > 0) {
          this.game.processCommand({
            tick: this.game.getCurrentTick(),
            playerId: store.playerId,
            type: 'HOLD',
            entityIds: selectedUnits,
          });
        }
        break;

      case 'attackMode':
        this.mode = 'attack';
        break;

      case 'moveMode':
        this.mode = 'normal';
        break;

      case 'togglePause':
        store.togglePause();
        if (store.isPaused) {
          this.game.pause();
        } else {
          this.game.resume();
        }
        break;

      case 'jumpToSelection':
        if (selectedUnits.length > 0) {
          const entity = this.game.world.getEntity(selectedUnits[0]);
          if (entity) {
            const transform = entity.get('Transform') as { x: number; y: number } | undefined;
            if (transform) {
              store.setCamera(transform.x, transform.y);
            }
          }
        }
        break;

      default:
        // Control group actions
        if (action.startsWith('selectGroup')) {
          const group = parseInt(action.replace('selectGroup', ''));
          this.game.eventBus.emit('selection:controlGroup:get', { group });
        } else if (action.startsWith('setGroup')) {
          const group = parseInt(action.replace('setGroup', ''));
          if (selectedUnits.length > 0) {
            this.game.eventBus.emit('selection:controlGroup:set', {
              group,
              entityIds: selectedUnits,
            });
          }
        }
        break;
    }
  }

  public getMode(): InputMode {
    return this.mode;
  }

  public setMode(mode: InputMode): void {
    this.mode = mode;
  }

  public dispose(): void {
    if (typeof window === 'undefined') return;

    window.removeEventListener('keydown', this.handleKeyDown.bind(this));
    window.removeEventListener('keyup', this.handleKeyUp.bind(this));
  }
}
