/**
 * Command button definition for the command card grid.
 */
export interface CommandButtonData {
  id: string;
  label: string;
  shortcut: string;
  action: () => void;
  isDisabled?: boolean;
  tooltip?: string;
  cost?: { minerals: number; plasma: number; supply?: number };
}

/**
 * Menu modes for the command card.
 */
export type MenuMode = 'main' | 'build_basic' | 'build_advanced' | 'build_walls';
