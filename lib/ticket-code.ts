/**
 * Ticket codes: 10 characters from the Crockford base32 alphabet
 * (0-9 + A-Z minus I, L, O, U). No node imports on purpose — usable on
 * the server and in any runtime (makeCode uses the Web Crypto global).
 *
 * The alphabet is exactly 32 symbols (a power of two), so masking a random
 * byte with 31 is a uniform, unbiased mapping.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10;

const ALPHABET_SET = new Set(ALPHABET.split(""));

/** Generates a fresh 10-char ticket code (Crockford base32, no I/L/O/U). */
export function makeCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] & 31];
  }
  return code;
}

/** True when the string is a syntactically valid ticket code (case-insensitive). */
export function isValidCode(code: string): boolean {
  if (typeof code !== "string") return false;
  const normalized = code.trim().toUpperCase();
  if (normalized.length !== CODE_LENGTH) return false;
  for (const ch of normalized) {
    if (!ALPHABET_SET.has(ch)) return false;
  }
  return true;
}
