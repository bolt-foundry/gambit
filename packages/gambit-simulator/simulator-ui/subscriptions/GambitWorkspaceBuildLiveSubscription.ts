import workspaceBuildLiveWriteEntrypoint from "@iso-gambit-sim/Query/EntrypointWorkspaceBuildLiveWrite/entrypoint.ts";
import type { Query__EntrypointWorkspaceBuildLiveWrite__raw_response_type as WorkspaceBuildLiveWritePayload } from "@iso-gambit-sim/Query/EntrypointWorkspaceBuildLiveWrite/raw_response_type.ts";
import { defineGambitSubscription } from "../src/hooks/defineGambitSubscription.ts";
import {
  WORKSPACE_BUILD_LIVE_SUBSCRIPTION_QUERY,
  WORKSPACE_BUILD_LIVE_WRITE_ROOT_KEY,
} from "./__generated__/workspaceBuildLiveSubscriptionQuery.ts";

type WorkspaceBuildLiveEnvelope = {
  workspaceBuildLive?: {
    cursor?: string | null;
    sourceOffset?: number | null;
    node?: unknown;
  } | null;
};

const WORKSPACE_ROOT_KEY: keyof WorkspaceBuildLiveWritePayload =
  WORKSPACE_BUILD_LIVE_WRITE_ROOT_KEY;

function toWritePayload(
  payload: WorkspaceBuildLiveEnvelope,
): WorkspaceBuildLiveWritePayload | null {
  const live = payload.workspaceBuildLive;
  if (!live || typeof live !== "object") return null;
  const node = live.node;
  if (!node || typeof node !== "object") return null;
  return {
    [WORKSPACE_ROOT_KEY]:
      node as WorkspaceBuildLiveWritePayload[typeof WORKSPACE_ROOT_KEY],
  };
}

export const gambitWorkspaceBuildLiveSubscription = defineGambitSubscription({
  // Isograph 0.5.x currently does not emit full Subscription entrypoint artifacts.
  // Hack for now: subscribe with raw GraphQL text, then map payload into a Query
  // write-entrypoint shape and normalize via writeData.
  entrypoint: workspaceBuildLiveWriteEntrypoint,
  query: WORKSPACE_BUILD_LIVE_SUBSCRIPTION_QUERY,
  operationName: "WorkspaceBuildLiveSubscription",
  toSubscriptionVariables: (variables) => ({
    workspaceId: variables.workspaceId,
  }),
  mapPayload: (payload: WorkspaceBuildLiveEnvelope) => {
    return toWritePayload(payload) as never;
  },
  flightPolicy: "single",
  isEnabled: (variables) =>
    typeof variables.workspaceId === "string" &&
    variables.workspaceId.trim().length > 0,
  offset: {
    variableName: "fromOffset",
    getOffset: (payload: WorkspaceBuildLiveEnvelope) =>
      typeof payload.workspaceBuildLive?.sourceOffset === "number"
        ? payload.workspaceBuildLive.sourceOffset
        : null,
    storageKey: (variables) =>
      `gambit.workspace.buildLive.offset:${variables.workspaceId}`,
  },
});

export default gambitWorkspaceBuildLiveSubscription;
