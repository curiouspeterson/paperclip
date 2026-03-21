export interface StoredSecretVersionMaterial extends Record<string, unknown> {}

export interface LocalEncryptedSecretVersionMaterial
  extends StoredSecretVersionMaterial {
  scheme: "local_encrypted_v1";
  iv: string;
  tag: string;
  ciphertext: string;
}
