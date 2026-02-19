const WORKER_SANDBOX_UNSUPPORTED_HOST_MESSAGE =
  "workerSandbox is unsupported in this host; @bolt-foundry/gambit-core worker sandboxing requires Deno.";

export const WORKER_SANDBOX_UNSUPPORTED_HOST_CODE =
  "worker_sandbox_unsupported_host";

export class WorkerSandboxUnsupportedHostError extends Error {
  code = WORKER_SANDBOX_UNSUPPORTED_HOST_CODE;

  constructor(message = WORKER_SANDBOX_UNSUPPORTED_HOST_MESSAGE) {
    super(message);
    this.name = "WorkerSandboxUnsupportedHostError";
  }
}

export type WorkerSandboxPermissionList = true | false | Array<string>;

export type WorkerSandboxPermissionSet = {
  permissions: {
    read: WorkerSandboxPermissionList;
    write: WorkerSandboxPermissionList;
    run: WorkerSandboxPermissionList;
    net: WorkerSandboxPermissionList;
    env: WorkerSandboxPermissionList;
    import?: WorkerSandboxPermissionList;
  };
};

export type WorkerBridgeEvent = {
  data?: unknown;
  error?: unknown;
  message?: string;
  preventDefault?: () => void;
};

export type WorkerBridge = {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  addEventListener: (
    type: "error" | "messageerror" | "message",
    listener: (event: WorkerBridgeEvent) => void,
  ) => void;
};

export type WorkerHostAdapter = {
  kind: "deno" | "unsupported";
  isSupported: boolean;
  createWorker: (
    moduleSpecifier: string,
    options: WorkerSandboxPermissionSet,
  ) => WorkerBridge;
};
