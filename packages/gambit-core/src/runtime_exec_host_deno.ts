import {
  type ExecCommandRequest,
  type ExecCommandResult,
  type ExecHostAdapter,
  ExecToolUnsupportedHostError,
} from "./runtime_exec_host_contract.ts";

type RuntimeDenoCommand = {
  output: () => Promise<ExecCommandResult>;
};

type RuntimeDenoCommandConstructor = new (
  command: string,
  options: {
    args?: Array<string>;
    cwd?: string;
    stdout?: "inherit" | "piped" | "null";
    stderr?: "inherit" | "piped" | "null";
    signal?: AbortSignal;
  },
) => RuntimeDenoCommand;

function isDenoHostRuntime(): boolean {
  const denoNs = (
    globalThis as { Deno?: { version?: { deno?: unknown } } }
  ).Deno;
  return typeof denoNs?.version?.deno === "string";
}

function getCommandConstructor(): RuntimeDenoCommandConstructor | undefined {
  const denoNs = (
    globalThis as { Deno?: { Command?: unknown } }
  ).Deno;
  if (!denoNs) return undefined;
  const candidate = denoNs.Command;
  if (typeof candidate !== "function") return undefined;
  return candidate as RuntimeDenoCommandConstructor;
}

export const denoExecHostAdapter: ExecHostAdapter = {
  kind: "deno",
  isSupported: isDenoHostRuntime() && Boolean(getCommandConstructor()),
  async execute(request: ExecCommandRequest): Promise<ExecCommandResult> {
    if (!isDenoHostRuntime()) {
      throw new ExecToolUnsupportedHostError();
    }
    const CommandCtor = getCommandConstructor();
    if (!CommandCtor) {
      throw new ExecToolUnsupportedHostError(
        "built-in exec is unsupported in this host; Deno.Command is unavailable.",
      );
    }
    return await new CommandCtor(request.command, {
      args: request.args,
      cwd: request.cwd,
      stdout: "piped",
      stderr: "piped",
      signal: request.signal,
    }).output();
  },
};
