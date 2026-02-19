import {
  type ExecHostAdapter,
  ExecToolUnsupportedHostError,
} from "./runtime_exec_host_contract.ts";

export const unsupportedExecHostAdapter: ExecHostAdapter = {
  kind: "unsupported",
  isSupported: false,
  execute() {
    throw new ExecToolUnsupportedHostError();
  },
};
