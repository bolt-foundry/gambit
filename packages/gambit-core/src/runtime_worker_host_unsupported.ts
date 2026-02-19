import {
  type WorkerHostAdapter,
  WorkerSandboxUnsupportedHostError,
} from "./runtime_worker_host_contract.ts";

export const unsupportedWorkerHostAdapter: WorkerHostAdapter = {
  kind: "unsupported",
  isSupported: false,
  createWorker() {
    throw new WorkerSandboxUnsupportedHostError();
  },
};
