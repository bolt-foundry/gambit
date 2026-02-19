import { denoExecHostAdapter } from "./runtime_exec_host_deno.ts";
import type {
  ExecCommandRequest,
  ExecCommandResult,
  ExecHostAdapter,
} from "./runtime_exec_host_contract.ts";
import { unsupportedExecHostAdapter } from "./runtime_exec_host_unsupported.ts";

function isDenoHostRuntime(): boolean {
  const denoNs = (
    globalThis as { Deno?: { version?: { deno?: unknown } } }
  ).Deno;
  return typeof denoNs?.version?.deno === "string";
}

const execHostAdapter: ExecHostAdapter = isDenoHostRuntime()
  ? denoExecHostAdapter
  : unsupportedExecHostAdapter;

export function isExecToolHostSupported(): boolean {
  return execHostAdapter.isSupported;
}

export function executeBuiltinCommand(
  request: ExecCommandRequest,
): Promise<ExecCommandResult> {
  return execHostAdapter.execute(request);
}

export { ExecToolUnsupportedHostError } from "./runtime_exec_host_contract.ts";
export type { ExecCommandRequest, ExecCommandResult };
