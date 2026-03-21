import type {
  LocalEncryptedSecretVersionMaterial,
  SecretProvider,
  SecretProviderDescriptor,
  StoredSecretVersionMaterial,
} from "@paperclipai/shared";

export type { StoredSecretVersionMaterial };
export type { LocalEncryptedSecretVersionMaterial };

export interface SecretProviderModule {
  id: SecretProvider;
  descriptor: SecretProviderDescriptor;
  createVersion(input: {
    value: string;
    externalRef: string | null;
  }): Promise<{
    material: StoredSecretVersionMaterial;
    valueSha256: string;
    externalRef: string | null;
  }>;
  resolveVersion(input: {
    material: StoredSecretVersionMaterial;
    externalRef: string | null;
  }): Promise<string>;
}
