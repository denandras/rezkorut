import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export type MediaAccessPayload = {
  key: string;
  name: string;
  exp: number;
};

function deriveAesKey(secret: string) {
  // Deterministic 32-byte key from the configured secret.
  return createHash("sha256").update(secret, "utf8").digest();
}

function isValidPayload(input: unknown): input is MediaAccessPayload {
  if (!input || typeof input !== "object") return false;

  const payload = input as Partial<MediaAccessPayload>;
  return (
    typeof payload.key === "string" &&
    payload.key.length > 0 &&
    typeof payload.name === "string" &&
    payload.name.length > 0 &&
    typeof payload.exp === "number" &&
    Number.isFinite(payload.exp)
  );
}

export function createMediaAccessToken(payload: MediaAccessPayload, secret: string) {
  const key = deriveAesKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function verifyMediaAccessToken(token: string, secret: string): MediaAccessPayload | null {
  const [ivBase64, encryptedBase64, tagBase64, ...rest] = token.split(".");
  if (!ivBase64 || !encryptedBase64 || !tagBase64 || rest.length > 0) return null;

  try {
    const key = deriveAesKey(secret);
    const iv = Buffer.from(ivBase64, "base64url");
    const encrypted = Buffer.from(encryptedBase64, "base64url");
    const tag = Buffer.from(tagBase64, "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const payloadRaw = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(payloadRaw);

    if (!isValidPayload(payload)) return null;
    if (payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}
