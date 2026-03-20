// ---------------------------------------------------------------------------
// Package-owned secret operations — no dependency on server/src/**
// ---------------------------------------------------------------------------
// Used by admin scripts and any surface that needs getByName / create / rotate
// without pulling in the full server service layer.
// ---------------------------------------------------------------------------
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { companySecrets, companySecretVersions } from "./schema/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecretActorRef {
  userId: string | null;
  agentId: string | null;
}

export interface SecretRecord {
  id: string;
  companyId: string;
  name: string;
  provider: string;
  latestVersion: number;
  externalRef: string | null;
  description: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSecretValueInput {
  name: string;
  provider: string;
  value: string;
  description?: string | null;
  externalRef?: string | null;
}

export interface RotateSecretValueInput {
  value: string;
  externalRef?: string | null;
}

export interface SecretOps {
  getByName(companyId: string, name: string): Promise<SecretRecord | null>;
  create(
    companyId: string,
    input: CreateSecretValueInput,
    actor: SecretActorRef,
  ): Promise<SecretRecord>;
  rotate(
    secretId: string,
    input: RotateSecretValueInput,
    actor: SecretActorRef,
  ): Promise<SecretRecord>;
  list(companyId: string): Promise<SecretRecord[]>;
}

// ---------------------------------------------------------------------------
// local_encrypted provider (self-contained, no server imports)
// ---------------------------------------------------------------------------

interface LocalEncryptedMaterial {
  scheme: "local_encrypted_v1";
  iv: string;
  tag: string;
  ciphertext: string;
}

function resolveMasterKeyFilePath(): string {
  const fromEnv = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  if (fromEnv && fromEnv.trim().length > 0) return path.resolve(fromEnv.trim());
  return path.resolve(process.cwd(), "data/secrets/master.key");
}

function decodeMasterKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // ignored
  }
  if (Buffer.byteLength(trimmed, "utf8") === 32) return Buffer.from(trimmed, "utf8");
  return null;
}

function loadOrCreateMasterKey(): Buffer {
  const envKeyRaw = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  if (envKeyRaw && envKeyRaw.trim().length > 0) {
    const fromEnv = decodeMasterKey(envKeyRaw);
    if (!fromEnv) {
      throw new Error(
        "Invalid PAPERCLIP_SECRETS_MASTER_KEY (expected 32-byte base64, 64-char hex, or raw 32-char string)",
      );
    }
    return fromEnv;
  }

  const keyPath = resolveMasterKeyFilePath();
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath, "utf8");
    const decoded = decodeMasterKey(raw);
    if (!decoded) throw new Error(`Invalid secrets master key at ${keyPath}`);
    return decoded;
  }

  const dir = path.dirname(keyPath);
  mkdirSync(dir, { recursive: true });
  const generated = randomBytes(32);
  writeFileSync(keyPath, generated.toString("base64"), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // best effort
  }
  return generated;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function encryptValue(masterKey: Buffer, value: string): LocalEncryptedMaterial {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    scheme: "local_encrypted_v1",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function prepareVersion(input: { value: string; externalRef?: string | null }) {
  const masterKey = loadOrCreateMasterKey();
  return {
    material: encryptValue(masterKey, input.value),
    valueSha256: sha256Hex(input.value),
    externalRef: input.externalRef ?? null,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSecretOps(db: Db): SecretOps {
  async function getById(id: string): Promise<SecretRecord | null> {
    return db
      .select()
      .from(companySecrets)
      .where(eq(companySecrets.id, id))
      .then((rows) => (rows[0] as SecretRecord | undefined) ?? null);
  }

  async function getByName(companyId: string, name: string): Promise<SecretRecord | null> {
    return db
      .select()
      .from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, name)))
      .then((rows) => (rows[0] as SecretRecord | undefined) ?? null);
  }

  async function create(
    companyId: string,
    input: CreateSecretValueInput,
    actor: SecretActorRef,
  ): Promise<SecretRecord> {
    const existing = await getByName(companyId, input.name);
    if (existing) throw new Error(`Secret already exists: ${input.name}`);

    const prepared = prepareVersion({ value: input.value, externalRef: input.externalRef });

    return db.transaction(async (tx) => {
      const secret = await tx
        .insert(companySecrets)
        .values({
          companyId,
          name: input.name,
          provider: input.provider,
          externalRef: prepared.externalRef,
          latestVersion: 1,
          description: input.description ?? null,
          createdByAgentId: actor.agentId,
          createdByUserId: actor.userId,
        })
        .returning()
        .then((rows) => rows[0] as SecretRecord);

      await tx.insert(companySecretVersions).values({
        secretId: secret.id,
        version: 1,
        material: prepared.material,
        valueSha256: prepared.valueSha256,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.userId,
      });

      return secret;
    });
  }

  async function rotate(
    secretId: string,
    input: RotateSecretValueInput,
    actor: SecretActorRef,
  ): Promise<SecretRecord> {
    const secret = await getById(secretId);
    if (!secret) throw new Error(`Secret not found: ${secretId}`);

    const nextVersion = secret.latestVersion + 1;
    const prepared = prepareVersion({
      value: input.value,
      externalRef: input.externalRef ?? secret.externalRef,
    });

    return db.transaction(async (tx) => {
      await tx.insert(companySecretVersions).values({
        secretId: secret.id,
        version: nextVersion,
        material: prepared.material,
        valueSha256: prepared.valueSha256,
        createdByAgentId: actor.agentId,
        createdByUserId: actor.userId,
      });

      const updated = await tx
        .update(companySecrets)
        .set({
          latestVersion: nextVersion,
          externalRef: prepared.externalRef,
          updatedAt: new Date(),
        })
        .where(eq(companySecrets.id, secret.id))
        .returning()
        .then((rows) => (rows[0] as SecretRecord | undefined) ?? null);

      if (!updated) throw new Error(`Secret not found after update: ${secretId}`);
      return updated;
    });
  }

  function list(companyId: string): Promise<SecretRecord[]> {
    return db
      .select()
      .from(companySecrets)
      .where(eq(companySecrets.companyId, companyId))
      .orderBy(desc(companySecrets.createdAt)) as Promise<SecretRecord[]>;
  }

  return { getByName, create, rotate, list };
}
