import {
  readCodexAuthBundleFromEnv,
  refreshCodexChatgptAuthTokens,
  summarizeCodexAuthBundle,
} from "./codex_auth.ts";
import { logCodexAppServerDebug } from "./codex_app_server_debug.ts";
import {
  callRuntimeHostService,
  CODEX_REFRESH_HOST_SERVICE_METHOD,
  type CodexRefreshHostServiceResult,
  RUNTIME_HOST_SERVICE_SOCKET_ENV,
  RUNTIME_HOST_SERVICE_TOKEN_ENV,
} from "./runtime_host_service.ts";

const CODEX_BIN_ENV = "GAMBIT_CODEX_BIN";
export const MINIMUM_SUPPORTED_CODEX_CLI_VERSION = "0.121.0";

export type CodexLoginStatus = {
  codexLoggedIn: boolean;
  codexLoginStatus: string;
  codexVersion: string | null;
  codexVersionSupported: boolean;
  minimumSupportedCodexVersion: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseSemverTriplet(value: string): [number, number, number] | null {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
}

function codexVersionSatisfiesMinimum(version: string | null): boolean {
  if (!version) return true;
  const actual = parseSemverTriplet(version);
  const minimum = parseSemverTriplet(MINIMUM_SUPPORTED_CODEX_CLI_VERSION);
  if (!actual || !minimum) return true;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

async function readCodexCliVersion(): Promise<string | null> {
  const codexBin = Deno.env.get(CODEX_BIN_ENV)?.trim() || "codex";
  try {
    const output = await new Deno.Command(codexBin, {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const combined = `${new TextDecoder().decode(output.stdout)} ${
      new TextDecoder().decode(output.stderr)
    }`.trim();
    const match = combined.match(
      /([0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9.]+)?)/,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function buildUnsupportedCodexVersionMessage(version: string | null): string {
  const rendered = version ?? "unknown";
  return `Codex CLI ${rendered} is too old; require >= ${MINIMUM_SUPPORTED_CODEX_CLI_VERSION} for Gambit's app-server transport.`;
}

function hasRuntimeHostServiceRefreshConfig(): boolean {
  return Boolean(
    Deno.env.get(RUNTIME_HOST_SERVICE_SOCKET_ENV)?.trim() &&
      Deno.env.get(RUNTIME_HOST_SERVICE_TOKEN_ENV)?.trim(),
  );
}

async function appServerPreflightRequestResult(input: {
  bundle: NonNullable<ReturnType<typeof readCodexAuthBundleFromEnv>>;
  method: string;
  params: Record<string, unknown>;
}): Promise<{
  bundle: NonNullable<ReturnType<typeof readCodexAuthBundleFromEnv>>;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
  };
}> {
  if (input.method === "account/chatgptAuthTokens/refresh") {
    const previousAccountId = typeof input.params.previousAccountId === "string"
      ? input.params.previousAccountId
      : null;
    const reason =
      typeof input.params.reason === "string" && input.params.reason
        ? input.params.reason
        : "account/chatgptAuthTokens/refresh";
    const hostRefreshed = await refreshCodexPreflightViaHost({
      previousAccountId,
      reason,
    });
    const refreshed = hostRefreshed
      ? {
        ...input.bundle,
        accessToken: hostRefreshed.accessToken,
        chatgptAccountId: hostRefreshed.chatgptAccountId,
        chatgptPlanType: hostRefreshed.chatgptPlanType,
        lastRefresh: new Date().toISOString(),
      }
      : await refreshCodexChatgptAuthTokens({
        bundle: input.bundle,
        previousAccountId,
        reason,
      });
    return {
      bundle: refreshed,
      result: {
        accessToken: refreshed.accessToken,
        chatgptAccountId: refreshed.chatgptAccountId,
        chatgptPlanType: refreshed.chatgptPlanType,
        type: "chatgptAuthTokens",
      },
    };
  }

  return {
    bundle: input.bundle,
    error: {
      code: -32601,
      message: `Unsupported app-server request: ${input.method}`,
    },
  };
}

async function refreshCodexPreflightViaHost(input: {
  previousAccountId?: string | null;
  reason: string;
}): Promise<CodexRefreshHostServiceResult | null> {
  if (!hasRuntimeHostServiceRefreshConfig()) return null;
  return await callRuntimeHostService({
    method: CODEX_REFRESH_HOST_SERVICE_METHOD,
    params: input,
  });
}

async function readLegacyCodexLoginStatus(): Promise<CodexLoginStatus> {
  const codexBin = Deno.env.get(CODEX_BIN_ENV)?.trim() || "codex";
  const codexVersion = await readCodexCliVersion();
  const codexVersionSupported = codexVersionSatisfiesMinimum(codexVersion);
  if (!codexVersionSupported) {
    return {
      codexLoggedIn: false,
      codexLoginStatus: buildUnsupportedCodexVersionMessage(codexVersion),
      codexVersion,
      codexVersionSupported,
      minimumSupportedCodexVersion: MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
    };
  }
  try {
    const output = await new Deno.Command(codexBin, {
      args: ["login", "status"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    const detail = stdout || stderr || "Unknown login status";
    return {
      codexLoggedIn: output.success,
      codexLoginStatus: detail,
      codexVersion,
      codexVersionSupported,
      minimumSupportedCodexVersion: MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
    };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return {
        codexLoggedIn: false,
        codexLoginStatus: "Codex CLI not found in PATH.",
        codexVersion,
        codexVersionSupported,
        minimumSupportedCodexVersion: MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
      };
    }
    return {
      codexLoggedIn: false,
      codexLoginStatus: err instanceof Error ? err.message : String(err),
      codexVersion,
      codexVersionSupported,
      minimumSupportedCodexVersion: MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
    };
  }
}

export async function readCodexLoginStatus(): Promise<CodexLoginStatus> {
  const bundle = readCodexAuthBundleFromEnv();
  if (!bundle) {
    return readLegacyCodexLoginStatus();
  }
  const codexBin = Deno.env.get(CODEX_BIN_ENV)?.trim() || "codex";
  const codexVersion = await readCodexCliVersion();
  const codexVersionSupported = codexVersionSatisfiesMinimum(codexVersion);
  if (!codexVersionSupported) {
    return {
      codexLoggedIn: false,
      codexLoginStatus: buildUnsupportedCodexVersionMessage(codexVersion),
      codexVersion,
      codexVersionSupported,
      minimumSupportedCodexVersion: MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
    };
  }
  try {
    let currentBundle = bundle;
    const child = new Deno.Command(codexBin, {
      args: ["app-server"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const encoder = new TextEncoder();
    const stdoutReader = child.stdout.getReader();
    const stderrReader = child.stderr.getReader();
    const stdinWriter = child.stdin.getWriter();
    let nextId = 1;
    let childClosedError: Error | null = null;
    const pending = new Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    const stderrChunks: Array<string> = [];
    const childStatus = child.status.then((status) => {
      const stderr = stderrChunks.join("").trim();
      childClosedError = new Error(
        stderr || `Codex app-server exited with code ${status.code}.`,
      );
      for (const request of pending.values()) request.reject(childClosedError);
      pending.clear();
      return status;
    });

    const writeMessage = async (message: Record<string, unknown>) => {
      logCodexAppServerDebug("preflight:message:out", {
        message,
      });
      await stdinWriter.write(encoder.encode(`${JSON.stringify(message)}\n`));
    };

    const request = async (
      method: string,
      params: Record<string, unknown>,
    ): Promise<unknown> => {
      const id = String(nextId++);
      const promise = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      }).finally(() => pending.delete(id));
      await writeMessage({ id, method, params });
      return promise;
    };

    const stdoutLoop = (async () => {
      const decoder = new TextDecoder();
      let buffered = "";
      while (true) {
        const { value, done } = await stdoutReader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const parts = buffered.split(/\r?\n/);
        buffered = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("{")) continue;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(trimmed) as Record<string, unknown>;
          } catch (error) {
            logCodexAppServerDebug("preflight:message:in:parse_failed", {
              error: error instanceof Error ? error.message : String(error),
              lineLength: trimmed.length,
            });
            continue;
          }
          logCodexAppServerDebug("preflight:message:in", {
            message: parsed,
          });
          if (typeof parsed.method === "string") {
            const requestId = Object.prototype.hasOwnProperty.call(parsed, "id")
              ? String(parsed.id)
              : null;
            if (!requestId) continue;
            const response = await appServerPreflightRequestResult({
              bundle: currentBundle,
              method: parsed.method,
              params: asRecord(parsed.params),
            });
            currentBundle = response.bundle;
            logCodexAppServerDebug("preflight:message:host_response", {
              method: parsed.method,
              requestId,
              response,
            });
            await writeMessage({
              id: requestId,
              ...(response.result ? { result: response.result } : {}),
              ...(response.error ? { error: response.error } : {}),
            });
            continue;
          }
          if (!Object.prototype.hasOwnProperty.call(parsed, "id")) continue;
          const id = String(parsed.id);
          const resolver = pending.get(id);
          if (!resolver) continue;
          if (parsed.error) {
            const error = asRecord(parsed.error);
            logCodexAppServerDebug("preflight:message:in:error", {
              id,
              error,
            });
            resolver.reject(
              new Error(
                typeof error.message === "string" && error.message
                  ? error.message
                  : "Codex app-server request failed.",
              ),
            );
            continue;
          }
          logCodexAppServerDebug("preflight:message:in:result", {
            id,
            result: parsed.result,
          });
          resolver.resolve(parsed.result);
        }
      }
    })();

    const stderrLoop = (async () => {
      const decoder = new TextDecoder();
      let buffered = "";
      while (true) {
        const { value, done } = await stderrReader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        stderrChunks.push(chunk);
        buffered += chunk;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          logCodexAppServerDebug("preflight:stderr", {
            line: trimmed,
          });
        }
      }
      if (buffered.trim()) {
        logCodexAppServerDebug("preflight:stderr", {
          line: buffered.trim(),
        });
      }
    })();

    try {
      await request("initialize", {
        clientInfo: {
          name: "gambit-preflight",
          title: "Gambit",
          version: "0.0.0",
        },
        capabilities: { experimentalApi: true },
      });
      await writeMessage({ method: "initialized", params: {} });
      let loginBundle = bundle;
      const loginAndRead = async () => {
        await request("account/login/start", {
          accessToken: loginBundle.accessToken,
          chatgptAccountId: loginBundle.chatgptAccountId,
          chatgptPlanType: loginBundle.chatgptPlanType,
          type: "chatgptAuthTokens",
        });
        return await request("account/read", {
          type: "chatgptAuthTokens",
        }) as Record<string, unknown>;
      };
      let result = await loginAndRead();
      const account = asRecord(result.account);
      let requiresOpenaiAuth = result.requiresOpenaiAuth === true;
      let confirmedAccountId = typeof account.id === "string"
        ? account.id.trim()
        : "";
      if (requiresOpenaiAuth || !confirmedAccountId) {
        const refreshed = await refreshCodexPreflightViaHost({
          previousAccountId: confirmedAccountId || bundle.chatgptAccountId,
          reason: "codex-preflight-account-read-stale",
        });
        if (refreshed) {
          loginBundle = {
            ...loginBundle,
            accessToken: refreshed.accessToken,
            chatgptAccountId: refreshed.chatgptAccountId,
            chatgptPlanType: refreshed.chatgptPlanType,
            lastRefresh: new Date().toISOString(),
          };
          result = await loginAndRead();
          const retryAccount = asRecord(result.account);
          requiresOpenaiAuth = result.requiresOpenaiAuth === true;
          confirmedAccountId = typeof retryAccount.id === "string"
            ? retryAccount.id.trim()
            : "";
        }
      }
      const finalAccount = asRecord(result.account);
      const planType = typeof finalAccount.planType === "string"
        ? finalAccount.planType
        : loginBundle.chatgptPlanType;
      const hasConfirmedAccountId = confirmedAccountId.length > 0;
      return {
        codexLoggedIn: hasConfirmedAccountId,
        codexLoginStatus: hasConfirmedAccountId
          ? !requiresOpenaiAuth
            ? `Codex account ready via app-server external auth (account=${confirmedAccountId}${
              planType ? ` plan=${planType}` : ""
            }).`
            : `Codex host auth bundle is present and account bootstrap is available (account=${confirmedAccountId}${
              planType ? ` plan=${planType}` : ""
            }); account/read still reports requiresOpenaiAuth.`
          : `Codex host auth bundle is present but account/read still requires auth: ${
            JSON.stringify(summarizeCodexAuthBundle(bundle))
          }`,
        codexVersion,
        codexVersionSupported,
        minimumSupportedCodexVersion: MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
      };
    } finally {
      for (const request of pending.values()) {
        request.reject(new Error("Codex app-server session closed."));
      }
      pending.clear();
      await stdinWriter.close().catch(() => undefined);
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      await Promise.allSettled([stdoutLoop, stderrLoop, childStatus]);
      if (childClosedError) {
        childClosedError = null;
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {
        codexLoggedIn: false,
        codexLoginStatus: "Codex CLI not found in PATH.",
        codexVersion,
        codexVersionSupported,
        minimumSupportedCodexVersion: MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
      };
    }
    return {
      codexLoggedIn: false,
      codexLoginStatus: error instanceof Error ? error.message : String(error),
      codexVersion,
      codexVersionSupported,
      minimumSupportedCodexVersion: MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
    };
  }
}
