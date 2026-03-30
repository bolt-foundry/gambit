import workspaceTestLiveWriteEntrypoint from "@iso-gambit-sim/Query/EntrypointWorkspaceTestLiveWrite/entrypoint.ts";
import type { Query__EntrypointWorkspaceTestLiveWrite__raw_response_type as WorkspaceTestLiveWritePayload } from "@iso-gambit-sim/Query/EntrypointWorkspaceTestLiveWrite/raw_response_type.ts";
import { defineGambitSubscription } from "../src/hooks/defineGambitSubscription.ts";
import {
  WORKSPACE_TEST_LIVE_SUBSCRIPTION_QUERY,
  WORKSPACE_TEST_LIVE_WRITE_ROOT_KEY,
} from "./__generated__/workspaceTestLiveSubscriptionQuery.ts";

function logTestStreamDebug(
  event: string,
  payload: Record<string, unknown>,
): void {
  // deno-lint-ignore no-console -- temporary debug logs for test live subscription tracing
  console.info("[gambit-test-stream-debug]", event, payload);
}

type WorkspaceTestLiveEnvelope = {
  workspaceTestLive?: {
    cursor?: string | null;
    sourceOffset?: number | null;
    node?: unknown;
  } | null;
};

const WORKSPACE_ROOT_KEY: keyof WorkspaceTestLiveWritePayload =
  WORKSPACE_TEST_LIVE_WRITE_ROOT_KEY;

function toWritePayload(
  payload: WorkspaceTestLiveEnvelope,
): WorkspaceTestLiveWritePayload | null {
  const live = payload.workspaceTestLive;
  if (!live || typeof live !== "object") {
    logTestStreamDebug("subscription.drop.live", {
      reason: "missing-live-payload",
      hasWorkspaceTestLive: Boolean(payload.workspaceTestLive),
    });
    return null;
  }
  const node = live.node;
  if (!node || typeof node !== "object") {
    logTestStreamDebug("subscription.drop.node", {
      reason: "missing-live-node",
      sourceOffset: live.sourceOffset ?? null,
      cursor: live.cursor ?? null,
    });
    return null;
  }
  const nodeRecord = node as Record<string, unknown>;
  const scenarioRuns = nodeRecord["scenarioRuns____first___l_25"];
  const scenarioRunEdges = scenarioRuns &&
      typeof scenarioRuns === "object" &&
      Array.isArray(
        (scenarioRuns as { edges?: unknown }).edges,
      )
    ? ((scenarioRuns as { edges: Array<unknown> }).edges)
    : [];
  logTestStreamDebug("subscription.write", {
    sourceOffset: live.sourceOffset ?? null,
    cursor: live.cursor ?? null,
    workspaceId: typeof nodeRecord.id === "string" ? nodeRecord.id : null,
    scenarioRunEdgeCount: scenarioRunEdges.length,
  });
  return {
    [WORKSPACE_ROOT_KEY]:
      node as WorkspaceTestLiveWritePayload[typeof WORKSPACE_ROOT_KEY],
  };
}

export const gambitWorkspaceTestLiveSubscription = defineGambitSubscription({
  // Isograph 0.5.x currently does not emit full Subscription entrypoint artifacts.
  // Hack for now: subscribe with raw GraphQL text, then map payload into a Query
  // write-entrypoint shape and normalize via writeData.
  entrypoint: workspaceTestLiveWriteEntrypoint,
  query: WORKSPACE_TEST_LIVE_SUBSCRIPTION_QUERY,
  operationName: "WorkspaceTestLiveSubscription",
  toSubscriptionVariables: (variables) => ({
    workspaceId: variables.workspaceId,
  }),
  mapPayload: (payload: WorkspaceTestLiveEnvelope) => {
    return toWritePayload(payload) as never;
  },
  flightPolicy: "single",
  isEnabled: (variables) =>
    typeof variables.workspaceId === "string" &&
    variables.workspaceId.trim().length > 0,
  offset: {
    variableName: "fromOffset",
    getOffset: (payload: WorkspaceTestLiveEnvelope) =>
      typeof payload.workspaceTestLive?.sourceOffset === "number"
        ? payload.workspaceTestLive.sourceOffset
        : null,
    storageKey: (variables) =>
      `gambit.workspace.testLive.offset:${variables.workspaceId}`,
  },
});

export default gambitWorkspaceTestLiveSubscription;
