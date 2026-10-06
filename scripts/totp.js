/**
 * RFC 6238 TOTP (Time-based One-Time Password) generator using Web Crypto API.
 * No external dependencies.
 */

function base32ToUint8Array(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = (base32 || '').toUpperCase().replace(/=+$/, '').trim();
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) {
      throw new Error(`Invalid base32 character: ${cleaned[i]}`);
    }
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

function extractSecret(input) {
  if (!input) return '';
  const trimmed = input.trim();
  if (trimmed.startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed);
      return url.searchParams.get('secret') || trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Calculates current 6-digit TOTP code.
 * @param {string} secretOrUri Base32 secret string or otpauth:// URI
 * @param {number} [timestamp] Milliseconds Unix epoch (defaults to Date.now())
 * @returns {Promise<string>} 6-digit string
 */
async function generateTotp(secretOrUri, timestamp = Date.now()) {
  const secret = extractSecret(secretOrUri);
  if (!secret) return '';

  const keyBytes = base32ToUint8Array(secret);
  const counter = Math.floor(timestamp / 1000 / 30);

  const counterBytes = new Uint8Array(8);
  let temp = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: { name: 'SHA-1' } },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
  const digest = new Uint8Array(signature);
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1000000).padStart(6, '0');
}

/**
 * Returns remaining seconds in the current 30s TOTP window.
 */
function getTotpRemainingSeconds() {
  const nowSec = Math.floor(Date.now() / 1000);
  return 30 - (nowSec % 30);
}

// Unconditionally register on globalThis for browser content script / popup / options
globalThis.base32ToUint8Array = base32ToUint8Array;
globalThis.extractSecret = extractSecret;
globalThis.generateTotp = generateTotp;
globalThis.getTotpRemainingSeconds = getTotpRemainingSeconds;

// Export for Node/CommonJS test runners if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { base32ToUint8Array, extractSecret, generateTotp, getTotpRemainingSeconds };
}
