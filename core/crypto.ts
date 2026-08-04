import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:";

export interface Cipher {
  encrypt(plain: string): string;
  decrypt(value: string): string;
}

export function createCipherFromKey(key: Buffer): Cipher {
  const k = createHash("sha256").update(key).digest();
  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGO, k, iv);
      const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
    },
    decrypt(value: string): string {
      if (!value.startsWith(PREFIX)) return value;
      const raw = Buffer.from(value.slice(PREFIX.length), "base64");
      if (raw.length < 28) throw new Error("corrupt ciphertext");
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const data = raw.subarray(28);
      const decipher = createDecipheriv(ALGO, k, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
  };
}

/**
 * Resolve the encryption key. Priority: env var (CORTEX_KEY) > keyfile.
 * If keyfile does not exist and is given, a fresh key is generated and stored
 * with 0600 permissions. Returns null when neither source yields a key.
 */
export function loadOrCreateKey(keyfile: string, envKeyName: string): Buffer | null {
  const envKey = process.env[envKeyName];
  if (envKey) return Buffer.from(envKey, "utf8");

  if (existsSync(keyfile)) {
    return Buffer.from(readFileSync(keyfile, "utf8").trim(), "utf8");
  }

  if (!keyfile) return null;
  mkdirSync(dirname(keyfile), { recursive: true });
  const key = randomBytes(32).toString("base64");
  writeFileSync(keyfile, key, { mode: 0o600 });
  try {
    chmodSync(keyfile, 0o600);
  } catch {
    // best effort
  }
  return Buffer.from(key, "utf8");
}
