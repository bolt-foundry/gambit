import { runDeck } from "@bolt-foundry/gambit-core";
import type { ModelProvider, SavedState } from "@bolt-foundry/gambit-core";

export function stringifyOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  if (
    output &&
    typeof output === "object" &&
    "payload" in (output as Record<string, unknown>)
  ) {
    return stringifyOutput((output as { payload?: unknown }).payload);
  }
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function shouldRetryWithStringInput(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    return error.message.includes("Schema validation failed");
  }
  return false;
}

export function resolveWorkerSandboxForSignalAwareRun(args: {
  workerSandbox?: boolean;
  signal?: AbortSignal;
}): boolean | undefined {
  // gambit-core currently rejects worker sandbox runs when an AbortSignal is
  // supplied. Simulator flows require signals for stop/reset cancellation, so
  // force in-process execution for those runs.
  if (args.signal) return false;
  return args.workerSandbox;
}

export async function runDeckWithFallback(args: {
  path: string;
  input?: unknown;
  inputProvided?: boolean;
  modelProvider: ModelProvider;
  state?: SavedState;
  allowRootStringInput?: boolean;
  initialUserMessage?: string;
  onStateUpdate?: (state: SavedState) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  responsesMode?: boolean;
  workerSandbox?: boolean;
  signal?: AbortSignal;
  onCancel?: () => unknown | Promise<unknown>;
}): Promise<unknown> {
  const workerSandbox = resolveWorkerSandboxForSignalAwareRun({
    workerSandbox: args.workerSandbox,
    signal: args.signal,
  });
  try {
    return await runDeck({
      path: args.path,
      input: args.input,
      inputProvided: args.inputProvided,
      modelProvider: args.modelProvider,
      state: args.state,
      allowRootStringInput: args.allowRootStringInput,
      initialUserMessage: args.initialUserMessage,
      onStateUpdate: args.onStateUpdate,
      stream: args.stream,
      onStreamText: args.onStreamText,
      responsesMode: args.responsesMode,
      workerSandbox,
      signal: args.signal,
      onCancel: args.onCancel,
    });
  } catch (error) {
    if (args.input === undefined && shouldRetryWithStringInput(error)) {
      return await runDeck({
        path: args.path,
        input: "",
        inputProvided: true,
        modelProvider: args.modelProvider,
        state: args.state,
        allowRootStringInput: args.allowRootStringInput,
        initialUserMessage: args.initialUserMessage,
        onStateUpdate: args.onStateUpdate,
        stream: args.stream,
        onStreamText: args.onStreamText,
        responsesMode: args.responsesMode,
        workerSandbox,
        signal: args.signal,
        onCancel: args.onCancel,
      });
    }
    throw error;
  }
}
