import workspaceBuildLiveWriteEntrypoint from "@iso-gambit-sim/Query/EntrypointWorkspaceBuildLiveWrite/entrypoint.ts";
import type { Query__EntrypointWorkspaceBuildLiveWrite__raw_response_type as WorkspaceTestLiveWritePayload } from "@iso-gambit-sim/Query/EntrypointWorkspaceBuildLiveWrite/raw_response_type.ts";
import { defineGambitSubscription } from "../src/hooks/defineGambitSubscription.ts";
import {
  WORKSPACE_TEST_LIVE_SUBSCRIPTION_QUERY,
  WORKSPACE_TEST_LIVE_WRITE_ROOT_KEY,
} from "./__generated__/workspaceTestLiveSubscriptionQuery.ts";

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
  if (!live || typeof live !== "object") return null;
  const node = live.node;
  if (!node || typeof node !== "object") return null;
  return {
    [WORKSPACE_ROOT_KEY]:
      node as WorkspaceTestLiveWritePayload[typeof WORKSPACE_ROOT_KEY],
  };
}

export const gambitWorkspaceTestLiveSubscription = defineGambitSubscription({
  // Isograph 0.5.x currently does not emit full Subscription entrypoint artifacts.
  // Hack for now: subscribe with raw GraphQL text, then map payload into a Query
  // write-entrypoint shape and normalize via writeData.
  entrypoint: workspaceBuildLiveWriteEntrypoint,
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
