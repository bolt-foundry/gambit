import { isGambitEndSignal, runDeck } from "@bolt-foundry/gambit-core";
import { loadState, saveState } from "@bolt-foundry/gambit-core";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import type { PermissionDeclarationInput } from "@bolt-foundry/gambit-core";
import { enrichStateMeta } from "../cli_utils.ts";

const logger = console;

export async function handleRunCommand(opts: {
  deckPath: string;
  context: unknown;
  contextProvided: boolean;
  message: unknown;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  trace?: (
    event: import("@bolt-foundry/gambit-core").TraceEvent,
  ) => void;
  stream?: boolean;
  statePath?: string;
  responsesMode?: boolean;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
}) {
  const state = opts.statePath ? loadState(opts.statePath) : undefined;
  const onStateUpdate = opts.statePath
    ? (s: import("@bolt-foundry/gambit-core").SavedState) => {
      saveState(opts.statePath!, enrichStateMeta(s, opts.deckPath));
    }
    : undefined;

  const result = await runDeck({
    path: opts.deckPath,
    input: opts.context,
    inputProvided: opts.contextProvided,
    initialUserMessage: opts.message,
    modelProvider: opts.modelProvider,
    isRoot: true,
    defaultModel: opts.model,
    modelOverride: opts.modelForce,
    trace: opts.trace,
    stream: opts.stream,
    state,
    onStateUpdate,
    responsesMode: opts.responsesMode,
    workspacePermissions: opts.workspacePermissions,
    workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
  });

  if (isGambitEndSignal(result)) {
    if (result.message) {
      logger.log(result.message);
    } else if (result.payload !== undefined) {
      if (typeof result.payload === "string") {
        logger.log(result.payload);
      } else {
        logger.log(JSON.stringify(result.payload, null, 2));
      }
    } else {
      logger.log(JSON.stringify(result, null, 2));
    }
  } else if (typeof result === "string") {
    logger.log(result);
  } else {
    logger.log(JSON.stringify(result, null, 2));
  }
}
