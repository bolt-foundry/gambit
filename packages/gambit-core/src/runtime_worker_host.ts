import { denoWorkerHostAdapter } from "./runtime_worker_host_deno.ts";
import type {
  WorkerBridge,
  WorkerBridgeEvent,
  WorkerHostAdapter,
  WorkerSandboxPermissionSet,
} from "./runtime_worker_host_contract.ts";
import { unsupportedWorkerHostAdapter } from "./runtime_worker_host_unsupported.ts";

function isDenoHostRuntime(): boolean {
  const denoNs = (
    globalThis as { Deno?: { version?: { deno?: unknown } } }
  ).Deno;
  return typeof denoNs?.version?.deno === "string";
}

const workerHostAdapter: WorkerHostAdapter = isDenoHostRuntime()
  ? denoWorkerHostAdapter
  : unsupportedWorkerHostAdapter;

export function isWorkerSandboxHostSupported(): boolean {
  return workerHostAdapter.isSupported;
}

export function createWorkerSandboxBridge(
  moduleSpecifier: string,
  options: WorkerSandboxPermissionSet,
): WorkerBridge {
  return workerHostAdapter.createWorker(moduleSpecifier, options);
}

export { WorkerSandboxUnsupportedHostError } from "./runtime_worker_host_contract.ts";
export type { WorkerBridge, WorkerBridgeEvent, WorkerSandboxPermissionSet };
