import workspaceVerifyLiveWriteEntrypoint from "@iso-gambit-sim/Query/EntrypointWorkspaceVerifyLiveWrite/entrypoint.ts";
import type { Query__EntrypointWorkspaceVerifyLiveWrite__raw_response_type as WorkspaceVerifyLiveWritePayload } from "@iso-gambit-sim/Query/EntrypointWorkspaceVerifyLiveWrite/raw_response_type.ts";
import { defineGambitSubscription } from "../src/hooks/defineGambitSubscription.ts";
import {
  WORKSPACE_VERIFY_LIVE_SUBSCRIPTION_QUERY,
  WORKSPACE_VERIFY_LIVE_WRITE_ROOT_KEY,
} from "./__generated__/workspaceVerifyLiveSubscriptionQuery.ts";

type WorkspaceVerifyLiveEnvelope = {
  workspaceVerifyLive?: {
    cursor?: string | null;
    sourceOffset?: number | null;
    node?: unknown;
  } | null;
};

const WORKSPACE_ROOT_KEY: keyof WorkspaceVerifyLiveWritePayload =
  WORKSPACE_VERIFY_LIVE_WRITE_ROOT_KEY;

function toWritePayload(
  payload: WorkspaceVerifyLiveEnvelope,
): WorkspaceVerifyLiveWritePayload | null {
  const live = payload.workspaceVerifyLive;
  if (!live || typeof live !== "object") return null;
  const node = live.node;
  if (!node || typeof node !== "object") return null;
  return {
    [WORKSPACE_ROOT_KEY]:
      node as WorkspaceVerifyLiveWritePayload[typeof WORKSPACE_ROOT_KEY],
  };
}

export const gambitWorkspaceVerifyLiveSubscription = defineGambitSubscription({
  entrypoint: workspaceVerifyLiveWriteEntrypoint,
  query: WORKSPACE_VERIFY_LIVE_SUBSCRIPTION_QUERY,
  operationName: "WorkspaceVerifyLiveSubscription",
  toSubscriptionVariables: (variables) => ({
    workspaceId: variables.workspaceId,
  }),
  mapPayload: (payload: WorkspaceVerifyLiveEnvelope) => {
    return toWritePayload(payload) as never;
  },
  flightPolicy: "single",
  isEnabled: (variables) =>
    typeof variables.workspaceId === "string" &&
    variables.workspaceId.trim().length > 0,
  offset: {
    variableName: "fromOffset",
    getOffset: (payload: WorkspaceVerifyLiveEnvelope) =>
      typeof payload.workspaceVerifyLive?.sourceOffset === "number"
        ? payload.workspaceVerifyLive.sourceOffset
        : null,
    storageKey: (variables) =>
      `gambit.workspace.verifyLive.offset:${variables.workspaceId}`,
  },
});

export default gambitWorkspaceVerifyLiveSubscription;
