import { parse as parseManifestToml } from "@std/toml";
import type { ProviderKey } from "./router.ts";

export type ProviderSecretRequirement = {
  secretId: string;
  envName: string;
};

export type ProviderAuthCommand = {
  command: Array<string>;
};

export type ProviderDestinationRequirement = {
  url: string;
};

export type ProviderImportedSecretSource = {
  jsonPath: string;
  kind: "json-file";
  path: string;
};

export type ProviderRuntimeAuthStateSource = {
  kind: "json-file";
  path: string;
};

export type ProviderStorageAuthority = "bfdesktop";

export type ProviderAttachmentAuthority =
  | "bfdesktop-mitm"
  | "runtime-env-placeholder";

export type ProviderDestinationScope = "declared-destinations";

type BaseProviderAuthRequirements = {
  attachmentAuthority: ProviderAttachmentAuthority;
  destinationScope: ProviderDestinationScope;
  storageAuthority: ProviderStorageAuthority;
};

export type SecretProviderAuthRequirements = BaseProviderAuthRequirements & {
  mode: "secret";
  secrets: Array<ProviderSecretRequirement>;
};

export type RuntimeAuthStateProviderAuthRequirements =
  & BaseProviderAuthRequirements
  & {
    mode: "runtime-auth-state";
    runtimeAuthState: {
      runtimeHomeEnv?: string;
      runtimePath: string;
      source: ProviderRuntimeAuthStateSource;
    };
  };

export type ProviderAuthRequirements =
  | SecretProviderAuthRequirements
  | RuntimeAuthStateProviderAuthRequirements;

export type ProviderRegistryEntry = {
  key: ProviderKey;
  entrypoint: string;
  routingPrefix: string;
  bareAlias?: string;
};

export type ProviderManifest = {
  version: string;
  provider: ProviderRegistryEntry;
  auth?: ProviderAuthRequirements;
  destinations: Array<ProviderDestinationRequirement>;
};

type RawProviderManifest = {
  version?: unknown;
  provider?: {
    key?: unknown;
    entrypoint?: unknown;
    routingPrefix?: unknown;
    bareAlias?: unknown;
  };
  auth?: {
    attachmentAuthority?: unknown;
    destinationScope?: unknown;
    storageAuthority?: unknown;
    mode?: unknown;
    secrets?: Array<{
      envName?: unknown;
      secretId?: unknown;
    }>;
    runtimeAuthState?: {
      runtimeHomeEnv?: unknown;
      runtimePath?: unknown;
      source?: {
        kind?: unknown;
        path?: unknown;
      };
    };
  };
  destinations?: Array<{ url?: unknown }>;
};

const PROVIDER_MANIFEST_TEXT: Record<ProviderKey, string> = {
  "claude-code-cli": `version = "provider-manifest-v1"

[provider]
key = "claude-code-cli"
entrypoint = "../claude_code.ts"
routingPrefix = "claude-code-cli/"
bareAlias = "claude-code-cli"
`,
  "codex-cli": `version = "provider-manifest-v1"

[provider]
key = "codex-cli"
entrypoint = "../codex.ts"
routingPrefix = "codex-cli/"
bareAlias = "codex-cli"

[auth]
mode = "runtime-auth-state"
storageAuthority = "bfdesktop"
attachmentAuthority = "bfdesktop-mitm"
destinationScope = "declared-destinations"

[auth.runtimeAuthState]
runtimeHomeEnv = "CODEX_HOME"
runtimePath = "codex/auth.json"

[auth.runtimeAuthState.source]
kind = "json-file"
path = "$CODEX_HOME/auth.json"

[[destinations]]
url = "https://api.openai.com/v1/responses"

[[destinations]]
url = "https://chatgpt.com/backend-api/codex/"
`,
  google: `version = "provider-manifest-v1"

[provider]
key = "google"
entrypoint = "../google.ts"
routingPrefix = "google/"
`,
  ollama: `version = "provider-manifest-v1"

[provider]
key = "ollama"
entrypoint = "../ollama.ts"
routingPrefix = "ollama/"
`,
  openrouter: `version = "provider-manifest-v1"

[provider]
key = "openrouter"
entrypoint = "../openrouter.ts"
routingPrefix = "openrouter/"

[auth]
mode = "secret"
storageAuthority = "bfdesktop"
attachmentAuthority = "runtime-env-placeholder"
destinationScope = "declared-destinations"

[[auth.secrets]]
secretId = "openrouter-api-key"
envName = "OPENROUTER_API_KEY"

[[destinations]]
url = "https://openrouter.ai/api/v1/"
`,
};

function isSupportedProviderKey(value: string): value is ProviderKey {
  return value === "openrouter" || value === "ollama" || value === "google" ||
    value === "codex-cli" || value === "claude-code-cli";
}

function isSupportedStorageAuthority(
  value: string,
): value is ProviderStorageAuthority {
  return value === "bfdesktop";
}

function isSupportedAttachmentAuthority(
  value: string,
): value is ProviderAttachmentAuthority {
  return value === "bfdesktop-mitm" || value === "runtime-env-placeholder";
}

function isSupportedDestinationScope(
  value: string,
): value is ProviderDestinationScope {
  return value === "declared-destinations";
}

function normalizeSecretRequirement(input: {
  envName?: unknown;
  secretId?: unknown;
}): ProviderSecretRequirement {
  const envName = typeof input.envName === "string" ? input.envName.trim() : "";
  const secretId = typeof input.secretId === "string"
    ? input.secretId.trim()
    : "";
  if (!envName || !secretId) {
    throw new Error(
      "Provider secret requirements must declare secretId and envName.",
    );
  }
  return { envName, secretId };
}

function normalizeRuntimeAuthStateSource(
  input: NonNullable<
    NonNullable<RawProviderManifest["auth"]>["runtimeAuthState"]
  >["source"],
): ProviderRuntimeAuthStateSource {
  const kind = typeof input?.kind === "string" ? input.kind.trim() : "";
  if (kind !== "json-file") {
    throw new Error(
      `Unsupported provider runtimeAuthState source kind "${input?.kind}".`,
    );
  }
  const path = typeof input?.path === "string" ? input.path.trim() : "";
  if (!path) {
    throw new Error(
      "Provider auth runtimeAuthState source must declare a non-empty path.",
    );
  }
  return { kind, path };
}

function normalizeProviderAuthRequirements(
  input: RawProviderManifest["auth"],
): ProviderAuthRequirements | undefined {
  if (!input) {
    return undefined;
  }
  const storageAuthority = typeof input.storageAuthority === "string"
    ? input.storageAuthority.trim()
    : "";
  if (!storageAuthority || !isSupportedStorageAuthority(storageAuthority)) {
    throw new Error(
      `Unsupported provider auth storageAuthority "${input.storageAuthority}".`,
    );
  }
  const attachmentAuthority = typeof input.attachmentAuthority === "string"
    ? input.attachmentAuthority.trim()
    : "";
  if (
    !attachmentAuthority ||
    !isSupportedAttachmentAuthority(attachmentAuthority)
  ) {
    throw new Error(
      `Unsupported provider auth attachmentAuthority "${input.attachmentAuthority}".`,
    );
  }
  const destinationScope = typeof input.destinationScope === "string"
    ? input.destinationScope.trim()
    : "";
  if (!destinationScope || !isSupportedDestinationScope(destinationScope)) {
    throw new Error(
      `Unsupported provider auth destinationScope "${input.destinationScope}".`,
    );
  }

  if (input.mode === "secret") {
    return {
      mode: "secret",
      storageAuthority,
      attachmentAuthority,
      destinationScope,
      secrets: (input.secrets ?? []).map(normalizeSecretRequirement),
    };
  }

  if (input.mode === "runtime-auth-state") {
    const runtimePath = typeof input.runtimeAuthState?.runtimePath === "string"
      ? input.runtimeAuthState.runtimePath.trim()
      : "";
    if (!runtimePath) {
      throw new Error(
        "Provider auth runtime-auth-state mode must declare runtimeAuthState.runtimePath.",
      );
    }
    return {
      mode: "runtime-auth-state",
      storageAuthority,
      attachmentAuthority,
      destinationScope,
      runtimeAuthState: {
        runtimeHomeEnv: typeof input.runtimeAuthState?.runtimeHomeEnv ===
            "string"
          ? input.runtimeAuthState.runtimeHomeEnv.trim() || undefined
          : undefined,
        runtimePath,
        source: normalizeRuntimeAuthStateSource(input.runtimeAuthState?.source),
      },
    };
  }

  throw new Error(`Unsupported provider auth mode "${input.mode}".`);
}

function normalizeProviderRegistryEntry(
  input: RawProviderManifest["provider"],
  expectedKey: ProviderKey,
): ProviderRegistryEntry {
  const key = typeof input?.key === "string" ? input.key.trim() : "";
  if (!key || !isSupportedProviderKey(key)) {
    throw new Error(`Unsupported provider manifest key "${input?.key}".`);
  }
  if (key !== expectedKey) {
    throw new Error(
      `Provider manifest key "${key}" does not match expected provider "${expectedKey}".`,
    );
  }
  const entrypoint = typeof input?.entrypoint === "string"
    ? input.entrypoint.trim()
    : "";
  if (!entrypoint) {
    throw new Error(`Provider manifest "${key}" must declare an entrypoint.`);
  }
  const routingPrefix = typeof input?.routingPrefix === "string"
    ? input.routingPrefix.trim()
    : "";
  if (!routingPrefix) {
    throw new Error(
      `Provider manifest "${key}" must declare a routingPrefix.`,
    );
  }
  const bareAlias = typeof input?.bareAlias === "string"
    ? input.bareAlias.trim()
    : "";
  const entry: ProviderRegistryEntry = {
    key,
    entrypoint,
    routingPrefix,
  };
  if (bareAlias) {
    entry.bareAlias = bareAlias;
  }
  return entry;
}

function normalizeDestinations(
  input: RawProviderManifest["destinations"],
): Array<ProviderDestinationRequirement> {
  return (input ?? []).map((destination) => {
    const url = typeof destination.url === "string"
      ? destination.url.trim()
      : "";
    if (!url) {
      throw new Error(
        "Provider destinations must declare a non-empty URL.",
      );
    }
    return { url };
  });
}

function normalizeManifest(
  input: RawProviderManifest,
  expectedKey: ProviderKey,
): ProviderManifest {
  const version = typeof input.version === "string" ? input.version.trim() : "";
  if (!version) {
    throw new Error(
      `Provider manifest "${expectedKey}" must declare a version.`,
    );
  }
  return {
    version,
    provider: normalizeProviderRegistryEntry(input.provider, expectedKey),
    auth: normalizeProviderAuthRequirements(input.auth),
    destinations: normalizeDestinations(input.destinations),
  };
}

const loadedProviderManifests = Object.entries(PROVIDER_MANIFEST_TEXT).map(
  ([providerKey, manifestToml]) => {
    const parsed = parseManifestToml(manifestToml) as RawProviderManifest;
    return normalizeManifest(parsed, providerKey as ProviderKey);
  },
);

const providerManifestByKey = new Map(
  loadedProviderManifests.map((manifest) => [manifest.provider.key, manifest]),
);

export function getProviderManifests(): Array<ProviderManifest> {
  return [...loadedProviderManifests];
}

export function getProviderManifest(
  provider: ProviderKey,
): ProviderManifest | null {
  return providerManifestByKey.get(provider) ?? null;
}

export function getProviderRegistryEntries(): Array<ProviderRegistryEntry> {
  return loadedProviderManifests.map((manifest) => manifest.provider);
}
