import { isGambitEndSignal, runDeck } from "../runtime.ts";
import { loadState, saveState } from "../state.ts";
import type { ModelProvider } from "../types.ts";
import { enrichStateMeta } from "../cli_utils.ts";

const logger = console;

export async function handleRunCommand(opts: {
  deckPath: string;
  init: unknown;
  initProvided: boolean;
  message: unknown;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  trace?: (event: import("../types.ts").TraceEvent) => void;
  stream?: boolean;
  statePath?: string;
}) {
  const state = opts.statePath ? loadState(opts.statePath) : undefined;
  const onStateUpdate = opts.statePath
    ? (s: import("../state.ts").SavedState) => {
      saveState(opts.statePath!, enrichStateMeta(s, opts.deckPath));
    }
    : undefined;

  const result = await runDeck({
    path: opts.deckPath,
    input: opts.init,
    inputProvided: opts.initProvided,
    initialUserMessage: opts.message,
    modelProvider: opts.modelProvider,
    isRoot: true,
    defaultModel: opts.model,
    modelOverride: opts.modelForce,
    trace: opts.trace,
    stream: opts.stream,
    state,
    onStateUpdate,
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
