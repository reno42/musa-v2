import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey() {
  const secret = process.env.WORKSPACE_SECRET_ENCRYPTION_KEY;
  if (!secret || secret.length < 24) {
    throw new Error("WORKSPACE_SECRET_ENCRYPTION_KEY must contain at least 24 characters");
  }
  return crypto.scryptSync(secret, "futuraria-workspace-secrets-v1", 32);
}
export function encryptWorkspaceSecret(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptWorkspaceSecret<T = Record<string, unknown>>(payload: string): T {
  const [version, iv, tag, encrypted] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Unsupported encrypted secret");
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const clear = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(clear) as T;
}
