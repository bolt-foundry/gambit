import {
  createIsographEnvironment,
  createIsographStore,
} from "@isograph/react";

type GraphqlEnvelope = {
  data?: unknown;
  errors?: Array<{ message?: string }>;
};

function makePreloadKey(queryText: string, variables: unknown): string {
  return `${queryText}::${JSON.stringify(variables ?? null)}`;
}

function extractOperation(opOrText: unknown): {
  queryText?: string;
  operationId?: string;
} {
  if (typeof opOrText === "string") return { queryText: opOrText };
  if (opOrText && typeof opOrText === "object") {
    const maybeWrapper = opOrText as
      & { text?: string; operationId?: string }
      & { operation?: { text?: string; operationId?: string } }
      & {
        networkRequestInfo?: {
          operation?: { text?: string; operationId?: string };
        };
      };
    if (maybeWrapper.text || maybeWrapper.operationId) {
      return {
        queryText: maybeWrapper.text,
        operationId: maybeWrapper.operationId,
      };
    }
    if (maybeWrapper.operation) {
      return {
        queryText: maybeWrapper.operation.text,
        operationId: maybeWrapper.operation.operationId,
      };
    }
    if (maybeWrapper.networkRequestInfo?.operation) {
      return {
        queryText: maybeWrapper.networkRequestInfo.operation.text,
        operationId: maybeWrapper.networkRequestInfo.operation.operationId,
      };
    }
  }
  return {};
}

function makeNetworkRequest<T>(
  opOrText: unknown,
  variables: unknown,
  maybeInfo?: unknown,
): Promise<T> {
  const primary = extractOperation(opOrText);
  const fallback = extractOperation(maybeInfo);
  const query = primary.queryText ?? fallback.queryText ??
    (typeof opOrText === "string" ? opOrText : "");
  const operationId = primary.operationId ?? fallback.operationId;

  try {
    const globalWithIso = globalThis as typeof globalThis & {
      __ISO_PRELOADED__?: Record<string, unknown>;
    };
    if (query && globalWithIso.__ISO_PRELOADED__) {
      const preloadKey = makePreloadKey(query, variables);
      if (
        Object.prototype.hasOwnProperty.call(
          globalWithIso.__ISO_PRELOADED__,
          preloadKey,
        )
      ) {
        const payload = globalWithIso.__ISO_PRELOADED__[preloadKey] as T;
        delete globalWithIso.__ISO_PRELOADED__[preloadKey];
        return Promise.resolve(payload);
      }
    }
  } catch {
    // Best effort preload read; fall through to network fetch.
  }

  if (!query && operationId) {
    return Promise.reject(
      new Error(
        "Persisted operations are not supported by the current /graphql endpoint.",
      ),
    );
  }

  return fetch("/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  }).then(async (response) => {
    const json = await response.json().catch(() => ({})) as GraphqlEnvelope;
    if (!response.ok) {
      throw new Error("NetworkError", { cause: json });
    }
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const firstMessage = json.errors[0]?.message ??
        "GraphQL operation failed";
      throw new Error(firstMessage, {
        cause: {
          query,
          variables,
          errors: json.errors,
        },
      });
    }
    return json as T;
  });
}

export function createFreshIsographEnvironment() {
  return createIsographEnvironment(
    createIsographStore(),
    makeNetworkRequest,
    undefined,
  );
}

export function getEnvironment() {
  const globalWithIso = globalThis as typeof globalThis & {
    __SIMULATOR_ISOGRAPH_ENVIRONMENT__?: ReturnType<
      typeof createFreshIsographEnvironment
    >;
  };
  if (!globalWithIso.__SIMULATOR_ISOGRAPH_ENVIRONMENT__) {
    globalWithIso.__SIMULATOR_ISOGRAPH_ENVIRONMENT__ =
      createFreshIsographEnvironment();
  }
  return globalWithIso.__SIMULATOR_ISOGRAPH_ENVIRONMENT__;
}
