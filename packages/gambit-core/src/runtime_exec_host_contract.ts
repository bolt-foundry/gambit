const EXEC_TOOL_UNSUPPORTED_HOST_MESSAGE =
  "built-in exec is unsupported in this host; @bolt-foundry/gambit-core exec requires Deno.";

export const EXEC_TOOL_UNSUPPORTED_HOST_CODE = "exec_unsupported_host";

export class ExecToolUnsupportedHostError extends Error {
  code = EXEC_TOOL_UNSUPPORTED_HOST_CODE;

  constructor(message = EXEC_TOOL_UNSUPPORTED_HOST_MESSAGE) {
    super(message);
    this.name = "ExecToolUnsupportedHostError";
  }
}

export type ExecCommandRequest = {
  command: string;
  args: Array<string>;
  cwd: string;
  signal?: AbortSignal;
};

export type ExecCommandResult = {
  code: number;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

export type ExecHostAdapter = {
  kind: "deno" | "unsupported";
  isSupported: boolean;
  execute: (request: ExecCommandRequest) => Promise<ExecCommandResult>;
};
