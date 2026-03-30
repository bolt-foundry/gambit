import workspaceWorkbenchLiveWriteEntrypoint from "@iso-gambit-sim/Query/EntrypointWorkspaceWorkbenchLiveWrite/entrypoint.ts";
import type { Query__EntrypointWorkspaceWorkbenchLiveWrite__raw_response_type as WorkspaceWorkbenchLiveWritePayload } from "@iso-gambit-sim/Query/EntrypointWorkspaceWorkbenchLiveWrite/raw_response_type.ts";
import { defineGambitSubscription } from "../src/hooks/defineGambitSubscription.ts";
import {
  WORKSPACE_WORKBENCH_LIVE_SUBSCRIPTION_QUERY,
  WORKSPACE_WORKBENCH_LIVE_WRITE_ROOT_KEY,
} from "./__generated__/workspaceWorkbenchLiveSubscriptionQuery.ts";

type WorkspaceWorkbenchLiveEnvelope = {
  workspaceBuildLive?: {
    cursor?: string | null;
    sourceOffset?: number | null;
    node?: unknown;
  } | null;
};

const WORKSPACE_ROOT_KEY: keyof WorkspaceWorkbenchLiveWritePayload =
  WORKSPACE_WORKBENCH_LIVE_WRITE_ROOT_KEY;

function toWritePayload(
  payload: WorkspaceWorkbenchLiveEnvelope,
): WorkspaceWorkbenchLiveWritePayload | null {
  const live = payload.workspaceBuildLive;
  if (!live || typeof live !== "object") return null;
  const node = live.node;
  if (!node || typeof node !== "object") return null;
  const nodeRecord = node as Record<string, unknown>;
  const buildRuns = nodeRecord["buildRuns____first___l_1"];
  const buildRunNode = buildRuns &&
      typeof buildRuns === "object" &&
      Array.isArray((buildRuns as { edges?: unknown }).edges)
    ? (buildRuns as { edges: Array<unknown> }).edges.flatMap((edge) =>
      edge && typeof edge === "object" &&
        (edge as { node?: unknown }).node &&
        typeof (edge as { node?: unknown }).node === "object"
        ? [(edge as { node: Record<string, unknown> }).node]
        : []
    )[0] ?? null
    : null;
  return {
    [WORKSPACE_ROOT_KEY]:
      node as WorkspaceWorkbenchLiveWritePayload[typeof WORKSPACE_ROOT_KEY],
  };
}

export const gambitWorkspaceWorkbenchLiveSubscription =
  defineGambitSubscription({
    // Isograph 0.5.x currently does not emit full Subscription entrypoint artifacts.
    // Hack for now: subscribe with raw GraphQL text, then map payload into a Query
    // write-entrypoint shape and normalize via writeData.
    entrypoint: workspaceWorkbenchLiveWriteEntrypoint,
    query: WORKSPACE_WORKBENCH_LIVE_SUBSCRIPTION_QUERY,
    operationName: "WorkspaceWorkbenchLiveSubscription",
    toSubscriptionVariables: (variables) => ({
      workspaceId: variables.workspaceId,
    }),
    mapPayload: (payload: WorkspaceWorkbenchLiveEnvelope) => {
      return toWritePayload(payload) as never;
    },
    flightPolicy: "single",
    isEnabled: (variables) =>
      typeof variables.workspaceId === "string" &&
      variables.workspaceId.trim().length > 0,
    offset: {
      variableName: "fromOffset",
      getOffset: (payload: WorkspaceWorkbenchLiveEnvelope) =>
        typeof payload.workspaceBuildLive?.sourceOffset === "number"
          ? payload.workspaceBuildLive.sourceOffset
          : null,
      storageKey: (variables) =>
        `gambit.workspace.workbenchLive.offset:${variables.workspaceId}`,
    },
  });

export default gambitWorkspaceWorkbenchLiveSubscription;
