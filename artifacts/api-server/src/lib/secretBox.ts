import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Envelope encryption for third-party access tokens held in the database.
 *
 * A GitHub access token must survive a page reload, so it has to be stored —
 * but never in plain text, and never in a form the browser can reach. The
 * ciphertext below is only useful with the key material that lives in server
 * secret storage (`GITHUB_TOKEN_ENCRYPTION_KEY`), so a database dump alone
 * reveals nothing.
 *
 * AES-256-GCM with a random IV per value and the authentication tag stored
 * beside it: a tampered or truncated value fails to open instead of decoding
 * into a wrong token. The key is a SHA-256 of the configured secret, which
 * accepts any length of secret and produces the 32 bytes AES-256 needs.
 *
 * Runs on Node and, through `node:crypto`'s WebCrypto-backed implementation,
 * inside a Cloudflare Worker — the same primitive the owner-session module uses.
 */

const VERSION = "v1";

function keyMaterial(): Buffer | null {
  const raw = (process.env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

/** Whether token storage is possible with the configuration this process has. */
export function secretBoxReady(): boolean {
  return keyMaterial() !== null;
}

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export function sealSecret(plaintext: string): string {
  const key = keyMaterial();
  if (!key) {
    throw new SecretBoxError(
      "GITHUB_TOKEN_ENCRYPTION_KEY is not configured, so an access token cannot be stored safely",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Returns null for a missing key or any value that does not authenticate. */
export function openSecret(sealed: string): string | null {
  const key = keyMaterial();
  if (!key) return null;
  const [version, ivPart, tagPart, dataPart] = sealed.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
