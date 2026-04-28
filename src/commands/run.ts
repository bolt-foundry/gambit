import {
  isGambitEndSignal,
  runDeckResponses,
  stringifyResponseOutput,
} from "@bolt-foundry/gambit-core";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import type { PermissionDeclarationInput } from "@bolt-foundry/gambit-core";
import { enrichStateMeta } from "../cli_utils.ts";
import {
  loadCanonicalWorkspaceState,
  saveCanonicalWorkspaceState,
} from "../workspace_sqlite.ts";

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
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  workerSandbox?: boolean;
}) {
  const state = opts.statePath
    ? loadCanonicalWorkspaceState(opts.statePath).state
    : undefined;
  const onStateUpdate = opts.statePath
    ? (s: import("@bolt-foundry/gambit-core").SavedState) => {
      saveCanonicalWorkspaceState(
        opts.statePath!,
        enrichStateMeta(s, opts.deckPath),
      );
    }
    : undefined;

  const result = await runDeckResponses({
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
    sessionPermissions: opts.sessionPermissions,
    sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
    workerSandbox: opts.workerSandbox,
  });

  const outputText = stringifyResponseOutput(result.output);
  if (outputText) {
    logger.log(outputText);
    return;
  }
  if (isGambitEndSignal(result.legacyResult)) {
    if (result.legacyResult.message) {
      logger.log(result.legacyResult.message);
    } else if (result.legacyResult.payload !== undefined) {
      if (typeof result.legacyResult.payload === "string") {
        logger.log(result.legacyResult.payload);
      } else {
        logger.log(JSON.stringify(result.legacyResult.payload, null, 2));
      }
    } else {
      logger.log(JSON.stringify(result.legacyResult, null, 2));
    }
  } else if (typeof result.legacyResult === "string") {
    logger.log(result.legacyResult);
  } else {
    logger.log(JSON.stringify(result.legacyResult, null, 2));
  }
}
