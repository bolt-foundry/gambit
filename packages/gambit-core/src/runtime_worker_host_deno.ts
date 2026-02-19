import {
  type WorkerBridge,
  type WorkerHostAdapter,
  type WorkerSandboxPermissionSet,
  WorkerSandboxUnsupportedHostError,
} from "./runtime_worker_host_contract.ts";

type RuntimeWorkerConstructor = new (
  specifier: string,
  options: { type: "module"; deno: WorkerSandboxPermissionSet },
) => WorkerBridge;

function isDenoHostRuntime(): boolean {
  const denoNs = (
    globalThis as { Deno?: { version?: { deno?: unknown } } }
  ).Deno;
  return typeof denoNs?.version?.deno === "string";
}

function getWorkerConstructor(): RuntimeWorkerConstructor | undefined {
  const candidate = (globalThis as { Worker?: unknown }).Worker;
  if (typeof candidate !== "function") return undefined;
  return candidate as RuntimeWorkerConstructor;
}

export const denoWorkerHostAdapter: WorkerHostAdapter = {
  kind: "deno",
  isSupported: isDenoHostRuntime() && Boolean(getWorkerConstructor()),
  createWorker(moduleSpecifier, options) {
    if (!isDenoHostRuntime()) {
      throw new WorkerSandboxUnsupportedHostError();
    }
    const WorkerCtor = getWorkerConstructor();
    if (!WorkerCtor) {
      throw new WorkerSandboxUnsupportedHostError(
        "workerSandbox is unsupported in this host; Worker is unavailable.",
      );
    }
    return new WorkerCtor(moduleSpecifier, { type: "module", deno: options });
  },
};
