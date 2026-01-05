import { isGambitEndSignal, runDeck } from "../runtime.ts";
import { loadState, saveState } from "../state.ts";
import type { ModelProvider, TraceEvent } from "../types.ts";
import {
  defaultTestBotStatePath,
  enrichStateMeta,
  findLastAssistantMessage,
} from "../cli_utils.ts";

function shouldRetryWithStringInput(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    return error.message.includes("Schema validation failed");
  }
  return false;
}

export async function runDeckWithFallback(args: {
  path: string;
  input?: unknown;
  inputProvided?: boolean;
  modelProvider: ModelProvider;
  defaultModel?: string;
  modelOverride?: string;
  state?: import("../state.ts").SavedState;
  allowRootStringInput?: boolean;
  initialUserMessage?: string;
  onStateUpdate?: (state: import("../state.ts").SavedState) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  trace?: (event: import("../types.ts").TraceEvent) => void;
}): Promise<unknown> {
  try {
    return await runDeck({
      path: args.path,
      input: args.input,
      inputProvided: args.inputProvided,
      modelProvider: args.modelProvider,
      defaultModel: args.defaultModel,
      modelOverride: args.modelOverride,
      state: args.state,
      allowRootStringInput: args.allowRootStringInput,
      initialUserMessage: args.initialUserMessage,
      onStateUpdate: args.onStateUpdate,
      stream: args.stream,
      onStreamText: args.onStreamText,
      trace: args.trace,
    });
  } catch (error) {
    if (args.input === undefined && shouldRetryWithStringInput(error)) {
      return await runDeck({
        path: args.path,
        input: "",
        inputProvided: true,
        modelProvider: args.modelProvider,
        defaultModel: args.defaultModel,
        modelOverride: args.modelOverride,
        state: args.state,
        allowRootStringInput: args.allowRootStringInput,
        initialUserMessage: args.initialUserMessage,
        onStateUpdate: args.onStateUpdate,
        stream: args.stream,
        onStreamText: args.onStreamText,
        trace: args.trace,
      });
    }
    throw error;
  }
}

export async function runTestBotLoop(opts: {
  rootDeckPath: string;
  botDeckPath: string;
  init?: unknown;
  initProvided: boolean;
  initialUserMessage?: unknown;
  botInput?: unknown;
  maxTurns: number;
  model?: string;
  modelForce?: string;
  modelProvider: ModelProvider;
  trace?: (event: TraceEvent) => void;
  verbose?: boolean;
  statePath?: string;
}): Promise<string> {
  let rootState: import("../state.ts").SavedState | undefined = undefined;
  let botState: import("../state.ts").SavedState | undefined = undefined;
  const statePath = opts.statePath ??
    defaultTestBotStatePath(opts.rootDeckPath);
  const capturedTraces: Array<import("../types.ts").TraceEvent> = [];
  const traceWrapper = (event: import("../types.ts").TraceEvent) => {
    capturedTraces.push(event);
    opts.trace?.(event);
  };
  const saveStateToDisk = (state: import("../state.ts").SavedState) => {
    const enriched = enrichStateMeta(
      { ...state, traces: capturedTraces },
      opts.rootDeckPath,
    );
    saveState(statePath, enriched);
  };

  const existingState = loadState(statePath);
  if (existingState) {
    rootState = existingState;
    if (Array.isArray(existingState.traces)) {
      capturedTraces.push(...existingState.traces);
    }
  }

  const updateRootState = (state: import("../state.ts").SavedState) => {
    const enriched = enrichStateMeta(state, opts.rootDeckPath);
    rootState = enriched;
    saveStateToDisk(enriched);
  };
  let sessionEnded = false;

  const shouldRunRoot = !existingState ||
    opts.initialUserMessage !== undefined;
  if (shouldRunRoot) {
    const initialResult = await runDeck({
      path: opts.rootDeckPath,
      input: opts.init,
      inputProvided: opts.initProvided,
      initialUserMessage: opts.initialUserMessage,
      modelProvider: opts.modelProvider,
      isRoot: true,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: rootState,
      onStateUpdate: updateRootState,
    });
    if (isGambitEndSignal(initialResult)) {
      sessionEnded = true;
    }
  }

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    if (sessionEnded) break;
    const history = rootState?.messages ?? [];
    const assistantMessage = findLastAssistantMessage(history);
    if (!assistantMessage) break;
    const botResult = await runDeckWithFallback({
      path: opts.botDeckPath,
      input: opts.botInput,
      inputProvided: opts.botInput !== undefined,
      initialUserMessage: assistantMessage,
      modelProvider: opts.modelProvider,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: botState,
      allowRootStringInput: true,
      onStateUpdate: (state) => {
        botState = state;
      },
    });
    if (isGambitEndSignal(botResult)) {
      sessionEnded = true;
      break;
    }
    const botText = typeof botResult === "string"
      ? botResult
      : JSON.stringify(botResult);
    const userMessage = botText.trim();
    if (!userMessage) break;
    const rootResult = await runDeck({
      path: opts.rootDeckPath,
      input: opts.init,
      inputProvided: opts.initProvided,
      initialUserMessage: userMessage,
      modelProvider: opts.modelProvider,
      isRoot: true,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: rootState,
      onStateUpdate: updateRootState,
    });
    if (isGambitEndSignal(rootResult)) {
      sessionEnded = true;
      break;
    }
  }

  return statePath;
}
