import {
  type ExtractParameters,
  type NetworkResponseObject,
  useIsographEnvironment,
  writeData,
} from "@isograph/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GambitSubscriptionDefinition } from "./defineGambitSubscription.ts";
import {
  getGraphqlSubscriptionSseClient,
  type GraphqlSseEnvelope,
} from "./graphqlSubscriptionSseClient.ts";

function isBuildStreamDebugEnabled(): boolean {
  const globals = globalThis as typeof globalThis & {
    __GAMBIT_BUILD_STREAM_DEBUG__?: unknown;
  };
  return globals.__GAMBIT_BUILD_STREAM_DEBUG__ === true;
}

function logBuildStreamDebug(
  event: string,
  payload: Record<string, unknown>,
): void {
  if (!isBuildStreamDebugEnabled()) return;
  // deno-lint-ignore no-console -- gated debug logs for live subscription tracing
  console.info("[gambit-build-stream-debug]", event, payload);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, next) => {
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return next;
    }
    const record = next as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = record[key];
    }
    return sorted;
  });
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function readOffset(storageKey: string): number | null {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.floor(parsed);
  } catch {
    return null;
  }
}

function writeOffset(storageKey: string, nextOffset: number): void {
  try {
    globalThis.localStorage.setItem(storageKey, String(nextOffset));
  } catch {
    // Ignore storage write failures.
  }
}

function extractOperationName(queryText: string): string | undefined {
  const match = queryText.match(
    /\bsubscription\s+([_A-Za-z][_0-9A-Za-z]*)\b/,
  );
  return match?.[1];
}

function toSubscriptionControlVariables(
  variables: unknown,
): Record<string, unknown> {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
    return {};
  }
  return variables as Record<string, unknown>;
}

function toErrorMessage(envelope: GraphqlSseEnvelope): string {
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    const first = envelope.errors[0];
    if (
      first && typeof first.message === "string" && first.message.length > 0
    ) {
      return first.message;
    }
  }
  if (typeof envelope.reason === "string" && envelope.reason.length > 0) {
    return envelope.reason;
  }
  return "GraphQL subscription failed";
}

export function useGambitTypedSubscription<
  TReadFromStore extends { data: object; parameters: object },
  TResult,
  TRawResponseType extends NetworkResponseObject,
  TEnvelopePayload = TRawResponseType,
>(
  subscription: GambitSubscriptionDefinition<
    TReadFromStore,
    TResult,
    TRawResponseType,
    TEnvelopePayload
  >,
  variables: ExtractParameters<TReadFromStore> | null | undefined,
) {
  const environment = useIsographEnvironment();
  const client = useMemo(() => getGraphqlSubscriptionSseClient(), []);
  const [connected, setConnected] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const hookIdRef = useRef<string>(`gambit-sub-${crypto.randomUUID()}`);
  const stableVariablesKey = useMemo(() => stableStringify(variables ?? null), [
    variables,
  ]);
  const stableVariables = useMemo(() => variables ?? null, [
    stableVariablesKey,
  ]);
  const generationRef = useRef(0);

  // deno-lint-ignore gambit/no-useeffect-setstate gambit/no-useeffect-setstate -- this hook models connection lifecycle and must update status state from effect events
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    let closed = false;
    let unsubscribe:
      | ((options?: { notifyServer?: boolean }) => Promise<void>)
      | null = null;

    const cleanup = async (notifyServer: boolean) => {
      setConnected(false);
      if (!unsubscribe) return;
      const dispose = unsubscribe;
      unsubscribe = null;
      await dispose({ notifyServer });
    };

    if (stableVariables === null) {
      setError(null);
      void cleanup(true);
      return () => {
        void cleanup(false);
      };
    }

    if (
      subscription.isEnabled && !subscription.isEnabled(stableVariables)
    ) {
      setError(null);
      void cleanup(true);
      return () => {
        void cleanup(false);
      };
    }

    const queryText = subscription.query.trim();
    if (!queryText) {
      setError("Subscription query text is missing.");
      return () => {};
    }

    const operationName = subscription.operationName ??
      extractOperationName(queryText);
    const isSingleFlight = subscription.flightPolicy === "single";
    const writeVariables = stableVariables;
    const subscriptionVariablesBase =
      subscription.toSubscriptionVariables?.(writeVariables) ??
        toSubscriptionControlVariables(writeVariables);
    const defaultOffsetStorageKey = subscription.offset
      ? `gambit.graphql.subscription.offset:${
        fnv1a(
          `${queryText}:${
            stableStringify(subscriptionVariablesBase)
          }:${subscription.offset.variableName}`,
        )
      }`
      : null;
    const offsetStorageKey = subscription.offset
      ? (
        subscription.offset.storageKey?.(writeVariables) ??
          defaultOffsetStorageKey
      )
      : null;
    const resumeOffset = offsetStorageKey ? readOffset(offsetStorageKey) : null;
    const subscriptionVariables = (() => {
      if (!subscription.offset || resumeOffset === null) {
        return subscriptionVariablesBase;
      }
      const withOffset = {
        ...subscriptionVariablesBase,
      };
      withOffset[subscription.offset.variableName] = resumeOffset;
      return withOffset;
    })();

    const start = async () => {
      if (isSingleFlight && inFlightRef.current) return;
      if (isSingleFlight) {
        inFlightRef.current = true;
        setInFlight(true);
      }

      try {
        logBuildStreamDebug("subscribe.start", {
          operationName: operationName ?? null,
          subscriptionId: hookIdRef.current,
          variables: subscriptionVariables,
        });
        const dispose = await client.subscribe({
          subscriptionId: hookIdRef.current,
          query: queryText,
          variables: subscriptionVariables,
          operationName,
          onEnvelope: (envelope) => {
            if (generationRef.current !== generation) return;
            logBuildStreamDebug("subscribe.envelope", {
              operationName: operationName ?? null,
              type: envelope.type,
              hasPayload: Boolean(envelope.payload),
            });
            if (envelope.type === "next") {
              if (!envelope.payload || typeof envelope.payload !== "object") {
                return;
              }
              const envelopePayload = envelope.payload as TEnvelopePayload;
              const writePayload = subscription.mapPayload
                ? subscription.mapPayload(envelopePayload, writeVariables)
                // mapPayload is optional; when omitted, envelope payload is the write payload.
                : envelopePayload as unknown as TRawResponseType;
              if (!writePayload) return;
              writeData(
                environment,
                subscription.entrypoint,
                writePayload,
                writeVariables,
              );
              logBuildStreamDebug("subscribe.write", {
                operationName: operationName ?? null,
                hasOffset: Boolean(subscription.offset),
                variableWorkspaceId:
                  (writeVariables as Record<string, unknown>)?.workspaceId ??
                    null,
              });
              if (subscription.offset && offsetStorageKey) {
                const offset = subscription.offset.getOffset(
                  envelopePayload,
                  writeVariables,
                );
                if (typeof offset === "number" && Number.isFinite(offset)) {
                  writeOffset(
                    offsetStorageKey,
                    Math.max(0, Math.floor(offset) + 1),
                  );
                }
              }
              setError(null);
              return;
            }
            if (envelope.type === "error") {
              setError(toErrorMessage(envelope));
              logBuildStreamDebug("subscribe.error", {
                operationName: operationName ?? null,
                reason: toErrorMessage(envelope),
              });
              return;
            }
            if (
              envelope.type === "complete" ||
              envelope.type === "unsubscribed"
            ) {
              setConnected(false);
            }
          },
        });

        if (closed || generationRef.current !== generation) {
          await dispose({ notifyServer: false });
          return;
        }
        unsubscribe = dispose;
        setConnected(true);
        setError(null);
      } catch (cause) {
        if (closed || generationRef.current !== generation) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message || "GraphQL subscription failed");
        logBuildStreamDebug("subscribe.exception", {
          operationName: operationName ?? null,
          message: message || "GraphQL subscription failed",
        });
        setConnected(false);
      } finally {
        if (isSingleFlight) {
          inFlightRef.current = false;
          setInFlight(false);
        }
      }
    };

    void start();

    return () => {
      closed = true;
      void cleanup(true);
    };
  }, [
    client,
    environment,
    stableVariables,
    subscription,
    stableVariablesKey,
  ]);

  return { connected, inFlight, error } as const;
}
