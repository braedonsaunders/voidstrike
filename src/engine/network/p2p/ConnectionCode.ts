/**
 * Connection Code System
 * Encodes WebRTC SDP offers into human-shareable codes
 * Format: VOID-XXXX-XXXX-XXXX-XXXX-XXXX
 */

import pako from 'pako';
import { debugNetworking } from '@/utils/debugLogger';

// Crockford's Base32 alphabet - exactly 32 chars, avoids confusing chars (no I/L/O/U)
// This is a standard encoding that's human-readable and case-insensitive
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PREFIX = 'VOID';
const CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// STUN servers for NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/**
 * Data encoded in a connection code
 */
export interface ConnectionCodeData {
  v: 1;                      // Version
  sdp: string;               // SDP offer/answer
  ice: string[];             // ICE candidates
  ts: number;                // Timestamp for expiry
  type: 'offer' | 'answer';  // SDP type
  mode?: '1v1' | '2v2';      // Game mode
  map?: string;              // Map ID
}

export class ConnectionCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionCodeError';
  }
}

/**
 * Gather ICE candidates with timeout
 */
async function gatherICECandidates(
  pc: RTCPeerConnection,
  timeout: number = 3000
): Promise<RTCIceCandidate[]> {
  const candidates: RTCIceCandidate[] = [];

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      debugNetworking.log(`[ConnectionCode] ICE gathering timed out with ${candidates.length} candidates`);
      resolve(candidates);
    }, timeout);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        candidates.push(event.candidate);
      } else {
        // ICE gathering complete
        clearTimeout(timer);
        debugNetworking.log(`[ConnectionCode] ICE gathering complete: ${candidates.length} candidates`);
        resolve(candidates);
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve(candidates);
      }
    };
  });
}

/**
 * Encode bytes to our alphabet (base32-like)
 */
function encodeToAlphabet(bytes: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += ALPHABET[(value >> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

/**
 * Decode from our alphabet to bytes
 */
function decodeFromAlphabet(str: string): Uint8Array {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of str.toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;

    while (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Format encoded string with prefix and dashes
 */
function formatCode(encoded: string): string {
  const chunks = encoded.match(/.{1,4}/g) || [];
  return CODE_PREFIX + '-' + chunks.join('-');
}

/**
 * Remove formatting from code
 */
function unformatCode(code: string): string {
  return code.replace(new RegExp(`^${CODE_PREFIX}-?`, 'i'), '').replace(/-/g, '');
}

/**
 * Create a new RTCPeerConnection with our ICE servers
 */
export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}

/**
 * Generate a connection code from a WebRTC offer
 */
export async function generateOfferCode(
  pc: RTCPeerConnection,
  options?: { mode?: '1v1' | '2v2'; map?: string }
): Promise<{ code: string; pc: RTCPeerConnection }> {
  // Create data channel (required to generate offer with media)
  // CRITICAL: ordered:true ensures commands arrive in correct sequence for lockstep
  const channel = pc.createDataChannel('game', {
    ordered: true,
  });

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  if (!offer.sdp) {
    throw new ConnectionCodeError('Failed to create offer: no SDP');
  }

  // Gather ICE candidates
  const iceCandidates = await gatherICECandidates(pc);

  // Filter out any undefined/null candidates
  const validCandidates = iceCandidates
    .map(c => c.candidate)
    .filter((c): c is string => typeof c === 'string' && c.length > 0);

  // Sanitize SDP - remove any "undefined" strings that might have crept in
  // This can happen with some WebRTC implementations
  const sanitizedSdp = offer.sdp.replace(/undefined/gi, '');

  // Also check if SDP looks valid
  if (!sanitizedSdp.includes('v=0') || !sanitizedSdp.includes('m=')) {
    console.error('[ConnectionCode] Invalid SDP:', sanitizedSdp.slice(0, 200));
    throw new ConnectionCodeError('Failed to create offer: invalid SDP format');
  }

  // Build payload - only include defined values
  const payload: ConnectionCodeData = {
    v: 1,
    sdp: sanitizedSdp,
    ice: validCandidates,
    ts: Date.now(),
    type: 'offer',
  };

  // Only add mode/map if defined
  if (options?.mode) payload.mode = options.mode;
  if (options?.map) payload.map = options.map;

  // Compress with pako
  const json = JSON.stringify(payload);

  // Debug: check for undefined in JSON
  if (json.includes('undefined')) {
    console.error('[ConnectionCode] JSON contains undefined:', json.slice(0, 500));
    throw new ConnectionCodeError('Internal error: undefined value in connection data');
  }

  const compressed = pako.deflate(json, { level: 9 });

  // Encode to alphabet (uppercase only)
  const encoded = encodeToAlphabet(compressed);

  // Final safety check - Crockford's Base32 doesn't have 'I', 'L', 'O', 'U'
  // If these appear, something went wrong
  if (/[ILOU]/i.test(encoded)) {
    console.error('[ConnectionCode] Encoded contains invalid chars:', encoded.slice(0, 100));
    throw new ConnectionCodeError('Internal error: encoding produced invalid characters');
  }

  // Format with prefix and dashes - ensure uppercase
  const code = formatCode(encoded).toUpperCase();

  debugNetworking.log(`[ConnectionCode] Generated offer code: ${code.length} chars`);

  return { code, pc };
}

/**
 * Parse a connection code and return the data
 */
export function parseConnectionCode(code: string): ConnectionCodeData {
  try {
    // Remove formatting
    const cleaned = unformatCode(code);

    if (cleaned.length < 10) {
      throw new ConnectionCodeError('Invalid connection code: too short');
    }

    // Decode from alphabet
    const compressed = decodeFromAlphabet(cleaned);

    // Decompress
    const json = pako.inflate(compressed, { to: 'string' });

    // Parse JSON
    const data = JSON.parse(json) as ConnectionCodeData;

    // Validate version
    if (data.v !== 1) {
      throw new ConnectionCodeError(`Unsupported connection code version: ${data.v}`);
    }

    // Check expiry
    if (Date.now() - data.ts > CODE_EXPIRY_MS) {
      throw new ConnectionCodeError('Connection code has expired. Please request a new one.');
    }

    return data;
  } catch (error) {
    if (error instanceof ConnectionCodeError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new ConnectionCodeError(`Failed to parse connection code: ${error.message}`);
    }
    throw new ConnectionCodeError('Failed to parse connection code: Invalid format');
  }
}

/**
 * Generate an answer code in response to an offer code
 */
export async function generateAnswerCode(
  offerCode: string
): Promise<{ code: string; pc: RTCPeerConnection }> {
  const offerData = parseConnectionCode(offerCode);

  if (offerData.type !== 'offer') {
    throw new ConnectionCodeError('Expected an offer code, got an answer code');
  }

  // Create peer connection
  const pc = createPeerConnection();

  // Set up data channel handler
  pc.ondatachannel = (event) => {
    debugNetworking.log('[ConnectionCode] Received data channel:', event.channel.label);
  };

  // Set remote description (the offer)
  await pc.setRemoteDescription({
    type: 'offer',
    sdp: offerData.sdp,
  });

  // Add ICE candidates from offer
  for (const candidate of offerData.ice) {
    try {
      await pc.addIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 });
    } catch (e) {
      debugNetworking.warn('[ConnectionCode] Failed to add ICE candidate:', e);
    }
  }

  // Create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  if (!answer.sdp) {
    throw new ConnectionCodeError('Failed to create answer: no SDP');
  }

  // Sanitize SDP
  const sanitizedSdp = answer.sdp.replace(/undefined/gi, '');

  // Gather our ICE candidates
  const iceCandidates = await gatherICECandidates(pc);

  // Filter out any undefined/null candidates
  const validCandidates = iceCandidates
    .map(c => c.candidate)
    .filter((c): c is string => typeof c === 'string' && c.length > 0);

  // Build answer payload - only include defined values
  const payload: ConnectionCodeData = {
    v: 1,
    sdp: sanitizedSdp,
    ice: validCandidates,
    ts: Date.now(),
    type: 'answer',
  };

  // Only add mode/map if defined
  if (offerData.mode) payload.mode = offerData.mode;
  if (offerData.map) payload.map = offerData.map;

  // Compress and encode
  const json = JSON.stringify(payload);

  // Debug: check for undefined in JSON
  if (json.includes('undefined')) {
    console.error('[ConnectionCode] JSON contains undefined:', json.slice(0, 500));
    throw new ConnectionCodeError('Internal error: undefined value in connection data');
  }

  const compressed = pako.deflate(json, { level: 9 });
  const encoded = encodeToAlphabet(compressed);

  // Safety check - Crockford's Base32 doesn't have 'I', 'L', 'O', 'U'
  if (/[ILOU]/i.test(encoded)) {
    console.error('[ConnectionCode] Encoded contains invalid chars:', encoded.slice(0, 100));
    throw new ConnectionCodeError('Internal error: encoding produced invalid characters');
  }

  const code = formatCode(encoded).toUpperCase();

  debugNetworking.log(`[ConnectionCode] Generated answer code: ${code.length} chars`);

  return { code, pc };
}

/**
 * Complete connection with an answer code
 */
export async function completeConnection(
  pc: RTCPeerConnection,
  answerCode: string
): Promise<void> {
  const answerData = parseConnectionCode(answerCode);

  if (answerData.type !== 'answer') {
    throw new ConnectionCodeError('Expected an answer code, got an offer code');
  }

  // Set remote description (the answer)
  await pc.setRemoteDescription({
    type: 'answer',
    sdp: answerData.sdp,
  });

  // Add ICE candidates from answer
  for (const candidate of answerData.ice) {
    try {
      await pc.addIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 });
    } catch (e) {
      debugNetworking.warn('[ConnectionCode] Failed to add ICE candidate:', e);
    }
  }

  debugNetworking.log('[ConnectionCode] Connection completed');
}

/**
 * Wait for peer connection to be fully connected
 */
export function waitForConnection(
  pc: RTCPeerConnection,
  timeout: number = 10000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pc.connectionState === 'connected') {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new ConnectionCodeError('Connection timed out'));
    }, timeout);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(timer);
        resolve();
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        clearTimeout(timer);
        reject(new ConnectionCodeError(`Connection ${pc.connectionState}`));
      }
    };
  });
}

/**
 * Get the data channel from a peer connection
 */
export function getDataChannel(pc: RTCPeerConnection): Promise<RTCDataChannel> {
  return new Promise((resolve, reject) => {
    // Check if we already have a data channel (we're the offerer)
    const existingChannel = (pc as unknown as { _channel?: RTCDataChannel })._channel;
    if (existingChannel && existingChannel.readyState === 'open') {
      resolve(existingChannel);
      return;
    }

    // Wait for data channel from remote (we're the answerer)
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.readyState === 'open') {
        resolve(channel);
      } else {
        channel.onopen = () => resolve(channel);
        channel.onerror = (e) => reject(new ConnectionCodeError('Data channel error'));
      }
    };

    // Timeout
    setTimeout(() => {
      reject(new ConnectionCodeError('Timed out waiting for data channel'));
    }, 10000);
  });
}
