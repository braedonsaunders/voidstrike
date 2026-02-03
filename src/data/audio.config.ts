/**
 * AudioConfig - Centralized audio system configuration
 *
 * SINGLE SOURCE OF TRUTH for voiceline cooldowns and audio behavior.
 * AudioSystem imports these values for RTS-style rate limiting.
 *
 * IMPORTANT: If you change these values, all audio behavior
 * will update automatically.
 */

// =============================================================================
// VOICELINE COOLDOWNS - Rate limiting for unit voice responses
// =============================================================================

/**
 * Cooldown between selection voicelines.
 * Prevents spam when rapidly clicking selected units.
 * Units of: milliseconds
 */
export const VOICE_COOLDOWN_SELECT = 2000;

/**
 * Cooldown between move command voicelines.
 * RTS-style: rapid move commands only trigger one acknowledgement.
 * Units of: milliseconds
 */
export const VOICE_COOLDOWN_MOVE = 2500;

/**
 * Cooldown between attack command voicelines.
 * RTS-style: rapid attack commands only trigger one acknowledgement.
 * Units of: milliseconds
 */
export const VOICE_COOLDOWN_ATTACK = 2500;

/**
 * Cooldown between unit ready voicelines.
 * No cooldown - each unit produced should announce itself.
 * Units of: milliseconds
 */
export const VOICE_COOLDOWN_READY = 0;

// =============================================================================
// COMMAND DEBOUNCE - Groups rapid commands into single audio triggers
// =============================================================================

/**
 * Time window for grouping rapid commands.
 * Commands within this window count as one for audio purposes.
 * Units of: milliseconds
 */
export const COMMAND_DEBOUNCE_WINDOW = 150;

// =============================================================================
// AGGREGATED CONFIG OBJECTS - For convenient importing
// =============================================================================

/**
 * All voiceline cooldown parameters grouped together.
 */
export const VOICE_COOLDOWN_CONFIG = {
  select: VOICE_COOLDOWN_SELECT,
  move: VOICE_COOLDOWN_MOVE,
  attack: VOICE_COOLDOWN_ATTACK,
  ready: VOICE_COOLDOWN_READY,
} as const;
