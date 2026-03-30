import type { ProviderKey } from "./router.ts";
import {
  getProviderManifest,
  type ProviderAuthRequirements,
  type ProviderDestinationRequirement,
} from "./manifest.ts";
import {
  type ResolvedProviderIdentity,
  resolveProviderIdentity,
} from "./router.ts";

export type {
  ProviderAttachmentAuthority,
  ProviderAuthRequirements,
  ProviderDestinationRequirement,
  ProviderDestinationScope,
  ProviderRuntimeAuthStateSource,
  ProviderSecretRequirement,
  ProviderStorageAuthority,
  RuntimeAuthStateProviderAuthRequirements,
  SecretProviderAuthRequirements,
} from "./manifest.ts";

export type ProviderRequirements = {
  auth: ProviderAuthRequirements;
  provider: ProviderKey;
  destinations: Array<ProviderDestinationRequirement>;
};

export type ResolvedProviderRequirements = ResolvedProviderIdentity & {
  requirements: ProviderRequirements;
};

export function getProviderRequirements(
  provider: ProviderKey,
): ProviderRequirements | null {
  const manifest = getProviderManifest(provider);
  if (!manifest?.auth) {
    return null;
  }
  return {
    auth: manifest.auth,
    provider: manifest.provider.key,
    destinations: manifest.destinations,
  };
}

export function providerAuthUsesRuntimeEnvPlaceholders(
  requirements: ProviderRequirements,
): boolean {
  return requirements.auth.mode === "secret" &&
    requirements.auth.attachmentAuthority === "runtime-env-placeholder";
}

export function providerAuthUsesMitmRequestTimeAttachment(
  requirements: ProviderRequirements,
): boolean {
  return requirements.auth.attachmentAuthority === "bfdesktop-mitm";
}

export function resolveProviderRequirements(input: {
  model: string;
  defaultProvider?: ProviderKey | null;
}): ResolvedProviderRequirements | null {
  const identity = resolveProviderIdentity(input);
  const requirements = getProviderRequirements(identity.providerKey);
  if (!requirements) {
    return null;
  }
  return {
    ...identity,
    requirements,
  };
}
