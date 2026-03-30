import workspaceGradeLiveWriteEntrypoint from "@iso-gambit-sim/Query/EntrypointWorkspaceGradeLiveWrite/entrypoint.ts";
import type { Query__EntrypointWorkspaceGradeLiveWrite__raw_response_type as WorkspaceGradeLiveWritePayload } from "@iso-gambit-sim/Query/EntrypointWorkspaceGradeLiveWrite/raw_response_type.ts";
import { defineGambitSubscription } from "../src/hooks/defineGambitSubscription.ts";
import {
  WORKSPACE_GRADE_LIVE_SUBSCRIPTION_QUERY,
  WORKSPACE_GRADE_LIVE_WRITE_ROOT_KEY,
} from "./__generated__/workspaceGradeLiveSubscriptionQuery.ts";

type WorkspaceGradeLiveEnvelope = {
  workspaceGradeLive?: {
    cursor?: string | null;
    sourceOffset?: number | null;
    node?: unknown;
  } | null;
};

const WORKSPACE_ROOT_KEY: keyof WorkspaceGradeLiveWritePayload =
  WORKSPACE_GRADE_LIVE_WRITE_ROOT_KEY;

function toWritePayload(
  payload: WorkspaceGradeLiveEnvelope,
): WorkspaceGradeLiveWritePayload | null {
  const live = payload.workspaceGradeLive;
  if (!live || typeof live !== "object") return null;
  const node = live.node;
  if (!node || typeof node !== "object") return null;
  return {
    [WORKSPACE_ROOT_KEY]:
      node as WorkspaceGradeLiveWritePayload[typeof WORKSPACE_ROOT_KEY],
  };
}

export const gambitWorkspaceGradeLiveSubscription = defineGambitSubscription({
  entrypoint: workspaceGradeLiveWriteEntrypoint,
  query: WORKSPACE_GRADE_LIVE_SUBSCRIPTION_QUERY,
  operationName: "WorkspaceGradeLiveSubscription",
  toSubscriptionVariables: (variables) => ({
    workspaceId: variables.workspaceId,
  }),
  mapPayload: (payload: WorkspaceGradeLiveEnvelope) => {
    return toWritePayload(payload) as never;
  },
  flightPolicy: "single",
  isEnabled: (variables) =>
    typeof variables.workspaceId === "string" &&
    variables.workspaceId.trim().length > 0,
  offset: {
    variableName: "fromOffset",
    getOffset: (payload: WorkspaceGradeLiveEnvelope) =>
      typeof payload.workspaceGradeLive?.sourceOffset === "number"
        ? payload.workspaceGradeLive.sourceOffset
        : null,
    storageKey: (variables) =>
      `gambit.workspace.gradeLive.offset:${variables.workspaceId}`,
  },
});

export default gambitWorkspaceGradeLiveSubscription;
