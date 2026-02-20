import fs from "fs";
import path from "path";
import crypto from "crypto";

export type KeyStorePayloadV1 = {
  version: 1;
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  salt_b64: string;
  iv_b64: string;
  tag_b64: string;
  ciphertext_b64: string;
};

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Derive a 32-byte key from a passphrase using scrypt.
 *
 * NOTE: On older machines / constrained environments, aggressive scrypt params
 * can exceed Node's memory limits. These values are tuned to work well on a 2017 MacBook Air.
 *
 * Security note: This is a prototype keystore. In production you’d tune this higher,
 * or use a dedicated key management service / HSM / MPC.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // Lighter scrypt params (lower memory use).
  // N must be a power of 2.
  const N = 1 << 14; // 16384
  const r = 8;
  const p = 1;

  // cap memory usage to avoid "memory limit exceeded"
  const maxmem = 64 * 1024 * 1024; // 64MB

  return crypto.scryptSync(passphrase, salt, 32, { N, r, p, maxmem });
}

export function encryptSecretKeyV1(secretKey: Uint8Array, passphrase: string): KeyStorePayloadV1 {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // recommended size for GCM
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt_b64: salt.toString("base64"),
    iv_b64: iv.toString("base64"),
    tag_b64: tag.toString("base64"),
    ciphertext_b64: ciphertext.toString("base64"),
  };
}

export function decryptSecretKeyV1(payload: KeyStorePayloadV1, passphrase: string): Uint8Array {
  if (payload.version !== 1) throw new Error(`Unsupported keystore version: ${payload.version}`);
  if (payload.kdf !== "scrypt") throw new Error(`Unsupported KDF: ${payload.kdf}`);
  if (payload.cipher !== "aes-256-gcm") throw new Error(`Unsupported cipher: ${payload.cipher}`);

  const salt = Buffer.from(payload.salt_b64, "base64");
  const iv = Buffer.from(payload.iv_b64, "base64");
  const tag = Buffer.from(payload.tag_b64, "base64");
  const ciphertext = Buffer.from(payload.ciphertext_b64, "base64");

  const key = deriveKey(passphrase, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Uint8Array(plaintext);
}

export function saveKeystore(filePath: string, payload: KeyStorePayloadV1) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { encoding: "utf-8" });
}

export function loadKeystore(filePath: string): KeyStorePayloadV1 {
  const raw = fs.readFileSync(filePath, { encoding: "utf-8" });
  const parsed = JSON.parse(raw) as KeyStorePayloadV1;
  return parsed;
}
