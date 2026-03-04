import workspaceBuildTabLiveWriteEntrypoint from "@iso-gambit-sim/Query/EntrypointWorkspaceBuildTabLiveWrite/entrypoint.ts";
import type { Query__EntrypointWorkspaceBuildTabLiveWrite__raw_response_type as WorkspaceBuildTabLiveWritePayload } from "@iso-gambit-sim/Query/EntrypointWorkspaceBuildTabLiveWrite/raw_response_type.ts";
import { defineGambitSubscription } from "../src/hooks/defineGambitSubscription.ts";
import {
  WORKSPACE_BUILD_TAB_LIVE_SUBSCRIPTION_QUERY,
  WORKSPACE_BUILD_TAB_LIVE_WRITE_ROOT_KEY,
} from "./__generated__/workspaceBuildTabLiveSubscriptionQuery.ts";

type WorkspaceBuildTabLiveEnvelope = {
  workspaceBuildLive?: {
    cursor?: string | null;
    sourceOffset?: number | null;
    node?: unknown;
  } | null;
};

const WORKSPACE_ROOT_KEY: keyof WorkspaceBuildTabLiveWritePayload =
  WORKSPACE_BUILD_TAB_LIVE_WRITE_ROOT_KEY;

function toWritePayload(
  payload: WorkspaceBuildTabLiveEnvelope,
): WorkspaceBuildTabLiveWritePayload | null {
  const live = payload.workspaceBuildLive;
  if (!live || typeof live !== "object") return null;
  const node = live.node;
  if (!node || typeof node !== "object") return null;
  return {
    [WORKSPACE_ROOT_KEY]:
      node as WorkspaceBuildTabLiveWritePayload[typeof WORKSPACE_ROOT_KEY],
  };
}

export const gambitWorkspaceBuildTabLiveSubscription = defineGambitSubscription(
  {
    // Isograph 0.5.x currently does not emit full Subscription entrypoint artifacts.
    // Hack for now: subscribe with raw GraphQL text, then map payload into a Query
    // write-entrypoint shape and normalize via writeData.
    entrypoint: workspaceBuildTabLiveWriteEntrypoint,
    query: WORKSPACE_BUILD_TAB_LIVE_SUBSCRIPTION_QUERY,
    operationName: "WorkspaceBuildTabLiveSubscription",
    toSubscriptionVariables: (variables) => ({
      workspaceId: variables.workspaceId,
    }),
    mapPayload: (payload: WorkspaceBuildTabLiveEnvelope) => {
      return toWritePayload(payload) as never;
    },
    flightPolicy: "single",
    isEnabled: (variables) =>
      typeof variables.workspaceId === "string" &&
      variables.workspaceId.trim().length > 0,
    offset: {
      variableName: "fromOffset",
      getOffset: (payload: WorkspaceBuildTabLiveEnvelope) =>
        typeof payload.workspaceBuildLive?.sourceOffset === "number"
          ? payload.workspaceBuildLive.sourceOffset
          : null,
      storageKey: (variables) =>
        `gambit.workspace.buildTabLive.offset:${variables.workspaceId}`,
    },
  },
);

export default gambitWorkspaceBuildTabLiveSubscription;
