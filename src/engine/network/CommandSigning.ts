/**
 * CommandSigning - Cryptographic command signing utilities for multiplayer security
 *
 * Uses ECDSA with P-256 curve via Web Crypto API to prevent command forgery.
 * Each player generates a signing key pair at game start. The public key is
 * exchanged during WebRTC signaling, and all commands are signed with the
 * private key before transmission.
 *
 * Recipients verify the signature against the sender's known public key to
 * ensure the command originated from the claimed player and wasn't tampered with.
 */

import type { GameCommand } from '../core/GameCommand';
import { debugNetworking } from '@/utils/debugLogger';

// Algorithm parameters for ECDSA with P-256 curve
const ECDSA_PARAMS: EcKeyGenParams = {
  name: 'ECDSA',
  namedCurve: 'P-256',
};

const SIGN_ALGORITHM: EcdsaParams = {
  name: 'ECDSA',
  hash: 'SHA-256',
};

/**
 * Generate a new ECDSA signing key pair for command authentication.
 * The private key should be kept secret; the public key is shared with peers.
 */
export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDSA_PARAMS, true, ['sign', 'verify']);
}

/**
 * Export a public key to base64 string for transmission.
 * The key can be included in WebRTC signaling messages.
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', key);
  const bytes = new Uint8Array(exported);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Import a public key from base64 string received from a peer.
 * The imported key can only be used for signature verification.
 */
export async function importPublicKey(keyData: string): Promise<CryptoKey> {
  const binaryString = atob(keyData);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return crypto.subtle.importKey('spki', bytes.buffer, ECDSA_PARAMS, true, ['verify']);
}

/**
 * Create a canonical representation of a command for signing.
 * Excludes the signature field itself and orders keys consistently.
 */
function getCommandDigest(command: GameCommand): string {
  // Create a copy without the signature field
  const { signature: _signature, ...commandWithoutSignature } = command as GameCommand & {
    signature?: string;
  };

  // Sort keys for deterministic ordering across all clients
  const sortedCommand = sortObjectKeys(commandWithoutSignature);

  return JSON.stringify(sortedCommand);
}

/**
 * Recursively sort object keys for consistent serialization.
 * Ensures the same command produces the same digest on all clients.
 */
function sortObjectKeys<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys) as T;
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as object).sort();

  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }

  return sorted as T;
}

/**
 * Sign a game command using the player's private key.
 * Returns a base64-encoded signature string.
 */
export async function signCommand(command: GameCommand, privateKey: CryptoKey): Promise<string> {
  const digest = getCommandDigest(command);
  const encoder = new TextEncoder();
  const data = encoder.encode(digest);

  const signature = await crypto.subtle.sign(SIGN_ALGORITHM, privateKey, data);

  const bytes = new Uint8Array(signature);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Verify a command's signature against the sender's public key.
 * Returns true if the signature is valid, false otherwise.
 */
export async function verifyCommandSignature(
  command: GameCommand,
  signature: string,
  publicKey: CryptoKey
): Promise<boolean> {
  try {
    const digest = getCommandDigest(command);
    const encoder = new TextEncoder();
    const data = encoder.encode(digest);

    const binaryString = atob(signature);
    const sigBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      sigBytes[i] = binaryString.charCodeAt(i);
    }

    return crypto.subtle.verify(SIGN_ALGORITHM, publicKey, sigBytes.buffer, data);
  } catch (e) {
    debugNetworking.error('[CommandSigning] Signature verification failed:', e);
    return false;
  }
}

/**
 * Manager class for handling signing keys and peer verification keys.
 * Provides a convenient interface for signing and verifying commands.
 */
export class CommandSigningManager {
  private keyPair: CryptoKeyPair | null = null;
  private peerPublicKeys: Map<string, CryptoKey> = new Map();
  private exportedPublicKey: string | null = null;

  /**
   * Initialize the manager by generating a new signing key pair.
   * Must be called before signing or exporting public key.
   */
  async initialize(): Promise<void> {
    this.keyPair = await generateSigningKeyPair();
    this.exportedPublicKey = await exportPublicKey(this.keyPair.publicKey);
    debugNetworking.log('[CommandSigning] Initialized signing key pair');
  }

  /**
   * Check if the manager has been initialized with keys.
   */
  isInitialized(): boolean {
    return this.keyPair !== null;
  }

  /**
   * Get the public key as a base64 string for sharing with peers.
   */
  getPublicKey(): string | null {
    return this.exportedPublicKey;
  }

  /**
   * Import and store a peer's public key for signature verification.
   */
  async addPeerPublicKey(peerId: string, publicKeyBase64: string): Promise<void> {
    try {
      const publicKey = await importPublicKey(publicKeyBase64);
      this.peerPublicKeys.set(peerId, publicKey);
      debugNetworking.log(`[CommandSigning] Added public key for peer: ${peerId.slice(0, 8)}...`);
    } catch (e) {
      debugNetworking.error(`[CommandSigning] Failed to import public key for peer ${peerId}:`, e);
      throw e;
    }
  }

  /**
   * Remove a peer's public key (called when peer disconnects).
   */
  removePeerPublicKey(peerId: string): void {
    this.peerPublicKeys.delete(peerId);
    debugNetworking.log(`[CommandSigning] Removed public key for peer: ${peerId.slice(0, 8)}...`);
  }

  /**
   * Check if we have a public key for a given peer.
   */
  hasPeerPublicKey(peerId: string): boolean {
    return this.peerPublicKeys.has(peerId);
  }

  /**
   * Sign a command with our private key.
   * The returned command has the signature field populated.
   */
  async signCommand(command: GameCommand): Promise<GameCommand> {
    if (!this.keyPair) {
      throw new Error('[CommandSigning] Cannot sign: manager not initialized');
    }

    const signature = await signCommand(command, this.keyPair.privateKey);

    return {
      ...command,
      signature,
    } as GameCommand;
  }

  /**
   * Verify a command's signature against a peer's public key.
   * Returns true if valid, false if invalid or peer key not found.
   */
  async verifyCommand(command: GameCommand, peerId: string): Promise<boolean> {
    const commandWithSig = command as GameCommand & { signature?: string };
    const signature = commandWithSig.signature;

    if (!signature) {
      debugNetworking.warn(`[CommandSigning] Command from ${peerId} has no signature`);
      return false;
    }

    const publicKey = this.peerPublicKeys.get(peerId);
    if (!publicKey) {
      debugNetworking.warn(`[CommandSigning] No public key for peer: ${peerId.slice(0, 8)}...`);
      return false;
    }

    return verifyCommandSignature(command, signature, publicKey);
  }

  /**
   * Reset the manager, clearing all keys.
   */
  reset(): void {
    this.keyPair = null;
    this.exportedPublicKey = null;
    this.peerPublicKeys.clear();
    debugNetworking.log('[CommandSigning] Manager reset');
  }
}

// Singleton instance for convenient access
let globalSigningManager: CommandSigningManager | null = null;

/**
 * Get the global CommandSigningManager instance.
 * Creates a new instance if one doesn't exist.
 */
export function getCommandSigningManager(): CommandSigningManager {
  if (!globalSigningManager) {
    globalSigningManager = new CommandSigningManager();
  }
  return globalSigningManager;
}

/**
 * Reset the global signing manager (call on game end/restart).
 */
export function resetCommandSigningManager(): void {
  if (globalSigningManager) {
    globalSigningManager.reset();
    globalSigningManager = null;
  }
}
