import * as path from "@std/path";
import type {
  CreateResponseRequest,
  CreateResponseResponse,
  JSONValue,
  ModelMessage,
  ModelProvider,
  ProviderTraceEvent,
  ResponseEvent,
  ResponseItem,
  ResponseMessageItem,
  ResponseToolDefinition,
  SavedState,
  ToolDefinition,
} from "@bolt-foundry/gambit-core";
import { joinTextParts, loadDeck } from "@bolt-foundry/gambit-core";
import type { CodexChatgptAuthTokens } from "../codex_auth.ts";
import { logCodexAppServerDebug } from "../codex_app_server_debug.ts";
import { ensureTempMcpDenoConfigSync } from "../mcp_deno_config.ts";

export const CODEX_PREFIX = "codex-cli/";
const CODEX_THREAD_META_KEY = "codex.threadId";
const BOT_ROOT_ENV = "GAMBIT_BOT_ROOT";
const CODEX_MCP_ENV = "GAMBIT_CODEX_ENABLE_MCP";
const CODEX_DISABLE_MCP_ENV = "GAMBIT_CODEX_DISABLE_MCP";
const CODEX_REASONING_EFFORT_ENV = "GAMBIT_CODEX_REASONING_EFFORT";
const CODEX_REASONING_SUMMARY_ENV = "GAMBIT_CODEX_REASONING_SUMMARY";
const CODEX_VERBOSITY_ENV = "GAMBIT_CODEX_VERBOSITY";
const CODEX_BIN_ENV = "GAMBIT_CODEX_BIN";
const CODEX_SKIP_SANDBOX_CONFIG_ENV = "GAMBIT_CODEX_SKIP_SANDBOX_CONFIG";
const CODEX_DANGEROUS_BYPASS_ENV =
  "GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX";
const MCP_DENO_BIN_ENV = "GAMBIT_MCP_DENO_BIN";
const MCP_ROOT_DECK_PATH_ENV = "GAMBIT_MCP_ROOT_DECK_PATH";
const EXTERNAL_TOOL_BRIDGE_ENV = "GAMBIT_EXTERNAL_TOOL_BRIDGE";
const MCP_DEBUG_LOG_PATH_ENV = "GAMBIT_MCP_DEBUG_LOG_PATH";
const DENO_DIR_ENV = "DENO_DIR";
const DEBUG_MCP_ENV = "WORKLOOP_CHIEF_RUNTIME_DEBUG_MCP";
const LEGACY_DEBUG_MCP_ENV = "BOLT_FOUNDRY_DESKTOP_CHIEF_RUNTIME_DEBUG_MCP";
const MCP_SERVER_PATH = (() => {
  try {
    const moduleUrl = new URL(import.meta.url);
    if (moduleUrl.protocol !== "file:") return null;
    return path.resolve(
      path.dirname(path.fromFileUrl(moduleUrl)),
      "../mcp_server.ts",
    );
  } catch {
    return null;
  }
})();
const MCP_SERVER_DENO_CONFIG_PATH = (() => {
  try {
    return ensureTempMcpDenoConfigSync();
  } catch {
    return null;
  }
})();
const MCP_SERVER_DENO_LOCK_PATH = (() => {
  try {
    const moduleUrl = new URL(import.meta.url);
    if (moduleUrl.protocol !== "file:") return null;
    const candidate = path.resolve(
      path.dirname(path.fromFileUrl(moduleUrl)),
      "../../deno.mcp.lock",
    );
    const stat = Deno.statSync(candidate);
    return stat.isFile ? candidate : null;
  } catch {
    return null;
  }
})();

type CommandStatusLike = {
  success: boolean;
  code: number;
};

type CodexAssistantMessage = {
  itemId: string | null;
  text: string;
};

type AppServerTurnRunnerInput = {
  model: string;
  messages: Array<ModelMessage>;
  tools?: Array<ToolDefinition>;
  state?: SavedState;
  params?: Record<string, unknown>;
  deckPath?: string;
  signal?: AbortSignal;
  onStreamEvent?: (event: Record<string, JSONValue>) => void;
  instructions?: string;
  prompt: string;
  injectItems?: Array<ResponseItem>;
  cwd: string;
  priorThreadId?: string;
};

type AppServerTurnRunnerOutput = {
  threadId?: string;
  assistantMessages: Array<CodexAssistantMessage>;
  rawResponseItems?: Array<ResponseItem>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

type AppServerTurnRunner = (
  input: AppServerTurnRunnerInput,
) => Promise<AppServerTurnRunnerOutput>;

export type CodexHostAuthBridge = {
  readAuthTokens: (input: {
    reason: string;
  }) => Promise<CodexChatgptAuthTokens>;
  refreshAuthTokens: (input: {
    previousAccountId?: string | null;
    reason: string;
  }) => Promise<CodexChatgptAuthTokens>;
};

const REASONING_EFFORT_VALUES = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
const REASONING_SUMMARY_VALUES = new Set([
  "none",
  "auto",
  "concise",
  "detailed",
]);
const VERBOSITY_VALUES = new Set(["low", "medium", "high"]);
let codexHostAuthBridge: CodexHostAuthBridge | null = null;

export function setCodexHostAuthBridgeForTests(
  bridge: CodexHostAuthBridge | null,
): void {
  codexHostAuthBridge = bridge;
}

function requireCodexHostAuthBridge(): CodexHostAuthBridge {
  if (!codexHostAuthBridge) {
    throw new Error(
      "Codex host auth bridge is required for app-server external auth bootstrap.",
    );
  }
  return codexHostAuthBridge;
}

function runCwd(): string {
  const botRoot = Deno.env.get(BOT_ROOT_ENV);
  if (typeof botRoot === "string" && botRoot.trim().length > 0) {
    return botRoot.trim();
  }
  return Deno.cwd();
}

function codexDeckDir(deckPath?: string): string | undefined {
  const trimmed = deckPath?.trim();
  if (!trimmed) return undefined;
  return path.dirname(
    path.isAbsolute(trimmed) ? trimmed : path.resolve(runCwd(), trimmed),
  );
}

function codexRunCwd(input: { cwd?: string; deckPath?: string }): string {
  const explicitCwd = input.cwd?.trim();
  if (explicitCwd) return explicitCwd;
  const deckDir = codexDeckDir(input.deckPath);
  if (deckDir) return deckDir;
  return runCwd();
}

function shouldEnableMcpBridge(): boolean {
  const disableRaw = Deno.env.get(CODEX_DISABLE_MCP_ENV);
  if (disableRaw && parseTruthy(disableRaw)) return false;
  const enableRaw = Deno.env.get(CODEX_MCP_ENV);
  if (!enableRaw) return true;
  const normalized = enableRaw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function shouldDebugMcpBridge(): boolean {
  return [DEBUG_MCP_ENV, LEGACY_DEBUG_MCP_ENV].some((envName) => {
    const raw = Deno.env.get(envName)?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  });
}

function isCodexNativeOrGambitBuiltinTool(name: string): boolean {
  return new Set([
    "apply_patch",
    "exec",
    "gambit_consume_async_action",
    "gambit_emit_output_item",
    "grep_files",
    "list_dir",
    "read_file",
  ]).has(name);
}

function logCodexMcpDebug(
  event: string,
  details?: Record<string, unknown>,
): void {
  if (!shouldDebugMcpBridge()) return;
  globalThis.console.error("[gambit-codex-mcp]", event, details ?? {});
}

function codexMcpDebugLogPath(cwd: string): string {
  return path.join(
    cwd,
    ".boltfoundry",
    "runtime",
    "chief-runtime",
    "gambit-mcp-debug.log",
  );
}

function mcpServerDenoBin(): string {
  return Deno.env.get(MCP_DENO_BIN_ENV)?.trim() || "deno";
}

function parseTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function shouldDangerouslyBypassCodexApprovalsAndSandbox(
  params?: Record<string, unknown>,
): boolean {
  const dangerousBypass = params?.gambitDangerouslyBypassApprovalsAndSandbox;
  if (typeof dangerousBypass === "boolean") return dangerousBypass;
  const codex = asRecord(params?.codex);
  const codexDangerousBypass = codex.dangerously_bypass_approvals_and_sandbox;
  if (typeof codexDangerousBypass === "boolean") {
    return codexDangerousBypass;
  }
  const envRaw = Deno.env.get(CODEX_DANGEROUS_BYPASS_ENV);
  return Boolean(envRaw && parseTruthy(envRaw));
}

function shouldSkipCodexSandboxConfig(
  params?: Record<string, unknown>,
): boolean {
  if (shouldDangerouslyBypassCodexApprovalsAndSandbox(params)) {
    return true;
  }
  const yolo = params?.gambitYolo;
  if (typeof yolo === "boolean") return yolo;
  const codex = asRecord(params?.codex);
  const codexSkipSandboxConfig = codex.skip_sandbox_config;
  if (typeof codexSkipSandboxConfig === "boolean") {
    return codexSkipSandboxConfig;
  }
  const envRaw = Deno.env.get(CODEX_SKIP_SANDBOX_CONFIG_ENV);
  return Boolean(envRaw && parseTruthy(envRaw));
}

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tomlStringArray(values: Array<string>): string {
  return `[${values.map(tomlString).join(",")}]`;
}

function tomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

function tomlValue(value: unknown): string {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid Codex config number: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => tomlValue(entry)).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{ ${
      entries
        .map(([key, entry]) => `${tomlKeySegment(key)} = ${tomlValue(entry)}`)
        .join(", ")
    } }`;
  }
  throw new Error(
    `Unsupported Codex config value type: ${typeof value}.`,
  );
}

function sanitizeCodexSpawnArgsForDebug(args: Array<string>): Array<string> {
  const sanitized = [...args];
  for (let idx = 0; idx < sanitized.length; idx += 1) {
    if (sanitized[idx] !== "-c") continue;
    const next = sanitized[idx + 1];
    if (!next?.startsWith("developer_instructions=")) continue;
    sanitized[idx + 1] = "developer_instructions=<redacted>";
  }
  return sanitized;
}

function extractCodexConfigValues(
  args: Array<string>,
  flag: string,
  prefix?: string,
): Array<string> {
  const values: Array<string> = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    if (args[idx] !== flag) continue;
    const value = args[idx + 1];
    if (typeof value !== "string" || value.length === 0) continue;
    if (typeof prefix === "string" && !value.startsWith(prefix)) continue;
    values.push(value);
  }
  return values;
}

function codexAdditionalConfigArgs(
  params?: Record<string, unknown>,
): Array<string> {
  const codex = params?.codex;
  if (!codex || typeof codex !== "object" || Array.isArray(codex)) return [];
  const args: Array<string> = [];
  const visit = (prefix: Array<string>, value: unknown) => {
    if (value === undefined) return;
    if (
      value && typeof value === "object" && !Array.isArray(value)
    ) {
      const entries = Object.entries(value).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      for (const [key, entry] of entries) {
        visit([...prefix, key], entry);
      }
      return;
    }
    const dottedKey = prefix.map(tomlKeySegment).join(".");
    args.push("-c", `${dottedKey}=${tomlValue(value)}`);
  };
  for (
    const [key, value] of Object.entries(codex).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  ) {
    visit([key], value);
  }
  return args;
}

function codexConfigArgs(input: {
  cwd: string;
  deckPath?: string;
  params?: Record<string, unknown>;
  instructions?: string;
}): Array<string> {
  const args: Array<string> = [];
  args.push(...codexAdditionalConfigArgs(input.params));
  args.push("-c", `approval_policy=${tomlString("never")}`);
  const pathEnv = Deno.env.get("PATH")?.trim();
  if (pathEnv) {
    args.push("-c", `shell_environment_policy.set.PATH=${tomlString(pathEnv)}`);
  }
  if (!shouldSkipCodexSandboxConfig(input.params)) {
    args.push("-c", `sandbox_mode=${tomlString("workspace-write")}`);
    args.push(
      "-c",
      `sandbox_workspace_write.writable_roots=${tomlStringArray([input.cwd])}`,
    );
  }
  const params = input.params ?? {};
  const reasoning = asRecord(params.reasoning);
  const effort = typeof reasoning.effort === "string"
    ? assertEnumForCallTime({
      value: reasoning.effort,
      allowed: REASONING_EFFORT_VALUES,
      field: "reasoning.effort",
    })
    : Deno.env.get(CODEX_REASONING_EFFORT_ENV);
  if (typeof effort === "string" && effort.trim()) {
    args.push("-c", `model_reasoning_effort=${tomlString(effort.trim())}`);
  }
  const summary = typeof reasoning.summary === "string"
    ? assertEnumForCallTime({
      value: reasoning.summary,
      allowed: REASONING_SUMMARY_VALUES,
      field: "reasoning.summary",
    })
    : Deno.env.get(CODEX_REASONING_SUMMARY_ENV);
  if (typeof summary === "string" && summary.trim()) {
    args.push("-c", `model_reasoning_summary=${tomlString(summary.trim())}`);
  }
  const verbosity = typeof params.verbosity === "string"
    ? assertEnumForCallTime({
      value: params.verbosity,
      allowed: VERBOSITY_VALUES,
      field: "verbosity",
    })
    : Deno.env.get(CODEX_VERBOSITY_ENV);
  if (typeof verbosity === "string" && verbosity.trim()) {
    args.push("-c", `model_verbosity=${tomlString(verbosity.trim())}`);
  }
  if (typeof input.instructions === "string" && input.instructions.trim()) {
    args.push(
      "-c",
      `developer_instructions=${tomlString(input.instructions.trim())}`,
    );
  }

  if (shouldEnableMcpBridge() && MCP_SERVER_PATH) {
    const debugLogPath = shouldDebugMcpBridge()
      ? codexMcpDebugLogPath(input.cwd)
      : null;
    logCodexMcpDebug("configArgs:enableServer", {
      cwd: input.cwd,
      deckPath: input.deckPath?.trim() || null,
      debugLogPath,
      mcpServerCommand: mcpServerDenoBin(),
      mcpServerConfigPath: MCP_SERVER_DENO_CONFIG_PATH,
      mcpServerLockPath: MCP_SERVER_DENO_LOCK_PATH,
      mcpServerPath: MCP_SERVER_PATH,
    });
    args.push(
      "-c",
      `mcp_servers.gambit.command=${tomlString(mcpServerDenoBin())}`,
    );
    const mcpServerArgs = ["run", "-A", "--frozen"];
    if (MCP_SERVER_DENO_LOCK_PATH) {
      mcpServerArgs.push("--lock", MCP_SERVER_DENO_LOCK_PATH);
    }
    if (MCP_SERVER_DENO_CONFIG_PATH) {
      mcpServerArgs.push("--config", MCP_SERVER_DENO_CONFIG_PATH);
    }
    mcpServerArgs.push(MCP_SERVER_PATH);
    args.push(
      "-c",
      `mcp_servers.gambit.args=${tomlStringArray(mcpServerArgs)}`,
    );
    args.push("-c", `mcp_servers.gambit.cwd=${tomlString(input.cwd)}`);
    args.push(
      "-c",
      `mcp_servers.gambit.env.GAMBIT_BOT_ROOT=${tomlString(input.cwd)}`,
    );
    const denoDir = Deno.env.get(DENO_DIR_ENV)?.trim();
    if (denoDir) {
      args.push(
        "-c",
        `mcp_servers.gambit.env.${DENO_DIR_ENV}=${tomlString(denoDir)}`,
      );
    }
    const externalToolBridge = Deno.env.get(EXTERNAL_TOOL_BRIDGE_ENV)?.trim();
    if (externalToolBridge) {
      args.push(
        "-c",
        `mcp_servers.gambit.env.${EXTERNAL_TOOL_BRIDGE_ENV}=${
          tomlString(externalToolBridge)
        }`,
      );
    }
    const rootDeckPath = input.deckPath?.trim();
    if (rootDeckPath) {
      args.push(
        "-c",
        `mcp_servers.gambit.env.${MCP_ROOT_DECK_PATH_ENV}=${
          tomlString(rootDeckPath)
        }`,
      );
    }
    if (debugLogPath) {
      args.push(
        "-c",
        `mcp_servers.gambit.env.${DEBUG_MCP_ENV}=${tomlString("1")}`,
      );
      args.push(
        "-c",
        `mcp_servers.gambit.env.${MCP_DEBUG_LOG_PATH_ENV}=${
          tomlString(debugLogPath)
        }`,
      );
    }
    args.push("-c", "mcp_servers.gambit.enabled=true");
    args.push("-c", "mcp_servers.gambit.startup_timeout_sec=30");
    args.push("-c", "mcp_servers.gambit.tool_timeout_sec=30");
    const sanitizedArgs = sanitizeCodexSpawnArgsForDebug(args);
    logCodexMcpDebug("configArgs:final", {
      cwd: input.cwd,
      deckPath: input.deckPath?.trim() || null,
      gambitConfigArgs: extractCodexConfigValues(
        sanitizedArgs,
        "-c",
        "mcp_servers.gambit.",
      ),
      gambitGlobalConfigArgs: extractCodexConfigValues(
        codexGlobalConfigArgs(sanitizedArgs),
        "--config",
        "mcp_servers.gambit.",
      ),
    });
  }
  return args;
}

async function prepareCodexMcpRootDeck(input: {
  deckPath?: string;
  tools?: Array<ToolDefinition>;
}): Promise<{
  deckPath?: string;
  cleanup?: () => Promise<void>;
}> {
  const rootDeckPath = input.deckPath?.trim();
  if (!rootDeckPath || !shouldEnableMcpBridge()) {
    logCodexMcpDebug("prepareRootDeck:skip", {
      deckPath: rootDeckPath ?? null,
      mcpEnabled: shouldEnableMcpBridge(),
    });
    return {};
  }
  const deck = await loadDeck(rootDeckPath);
  const deckActionNames = new Set(
    deck.actionDecks.map((action) => action.name),
  );
  const deckToolNames = new Set(deck.tools.map((tool) => tool.name));
  const extraExternalTools = (input.tools ?? [])
    .map((tool) => tool.function)
    .filter((tool) =>
      tool &&
      !isCodexNativeOrGambitBuiltinTool(tool.name) &&
      !deckActionNames.has(tool.name) &&
      !deckToolNames.has(tool.name)
    );
  if (deck.actionDecks.length === 0 && extraExternalTools.length === 0) {
    logCodexMcpDebug("prepareRootDeck:reuseOriginal", {
      actionCount: 0,
      deckPath: rootDeckPath,
      toolCount: deck.tools.length,
      toolNames: deck.tools.map((tool) => tool.name),
    });
    return { deckPath: rootDeckPath };
  }
  const tempDir = await Deno.makeTempDir({ prefix: "gambit-codex-mcp-root-" });
  const tempDeckPath = path.join(tempDir, "PROMPT.md");
  const frontmatter = [
    "+++",
    'label = "codex_mcp_tool_surface"',
    "",
  ];
  for (const action of deck.actionDecks) {
    frontmatter.push("[[actions]]");
    frontmatter.push(`name = ${tomlString(action.name)}`);
    frontmatter.push(`path = ${tomlString(action.path)}`);
    if (typeof action.description === "string" && action.description.trim()) {
      frontmatter.push(
        `description = ${tomlString(action.description.trim())}`,
      );
    }
    frontmatter.push("");
  }
  for (const externalTool of deck.tools) {
    frontmatter.push("[[tools]]");
    frontmatter.push(`name = ${tomlString(externalTool.name)}`);
    if (
      typeof externalTool.description === "string" &&
      externalTool.description.trim()
    ) {
      frontmatter.push(
        `description = ${tomlString(externalTool.description.trim())}`,
      );
    }
    frontmatter.push("");
  }
  for (const externalTool of extraExternalTools) {
    frontmatter.push("[[tools]]");
    frontmatter.push(`name = ${tomlString(externalTool.name)}`);
    if (
      typeof externalTool.description === "string" &&
      externalTool.description.trim()
    ) {
      frontmatter.push(
        `description = ${tomlString(externalTool.description.trim())}`,
      );
    }
    frontmatter.push("");
  }
  frontmatter.push("+++", "", "Codex MCP tool surface.");
  await Deno.writeTextFile(tempDeckPath, frontmatter.join("\n"));
  logCodexMcpDebug("prepareRootDeck:synthesized", {
    actionCount: deck.actionDecks.length,
    actionNames: deck.actionDecks.map((action) => action.name),
    extraToolNames: extraExternalTools.map((tool) => tool.name),
    rootDeckPath,
    synthesizedDeckPath: tempDeckPath,
    toolCount: deck.tools.length + extraExternalTools.length,
    toolNames: [
      ...deck.tools.map((tool) => tool.name),
      ...extraExternalTools.map((tool) => tool.name),
    ],
  });
  return {
    deckPath: tempDeckPath,
    cleanup: async () => {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    },
  };
}

function appServerThreadSandboxPolicy(input: {
  cwd: string;
  params?: Record<string, unknown>;
}): Record<string, unknown> {
  if (shouldSkipCodexSandboxConfig(input.params)) {
    return { type: "dangerFullAccess" };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [input.cwd],
  };
}

function appServerTurnSandboxPolicy(input: {
  cwd: string;
  params?: Record<string, unknown>;
}): Record<string, unknown> {
  if (shouldSkipCodexSandboxConfig(input.params)) {
    return { type: "dangerFullAccess" };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [input.cwd],
  };
}

async function appServerRequestResult(input: {
  method: string;
  params: Record<string, unknown>;
}): Promise<{
  result?: Record<string, JSONValue>;
  error?: {
    code: number;
    message: string;
  };
}> {
  if (input.method.startsWith("mcp")) {
    logCodexMcpDebug("appServer:request", {
      method: input.method,
      params: safeJsonObjectFromRecord(input.params),
    });
  }
  if (input.method === "mcpServer/elicitation/request") {
    const mode = typeof input.params.mode === "string" ? input.params.mode : "";
    const requestedSchema = asRecord(input.params.requestedSchema);
    const properties = asRecord(requestedSchema.properties);
    if (mode === "form" && Object.keys(properties).length === 0) {
      return {
        result: {
          action: "accept",
          content: {},
        },
      };
    }
  }
  if (input.method === "account/chatgptAuthTokens/refresh") {
    const bridge = requireCodexHostAuthBridge();
    const refreshed = await bridge.refreshAuthTokens({
      previousAccountId: typeof input.params.previousAccountId === "string"
        ? input.params.previousAccountId
        : null,
      reason: typeof input.params.reason === "string" && input.params.reason
        ? input.params.reason
        : "account/chatgptAuthTokens/refresh",
    });
    return {
      result: {
        accessToken: refreshed.accessToken,
        chatgptAccountId: refreshed.chatgptAccountId,
        chatgptPlanType: refreshed.chatgptPlanType,
        type: "chatgptAuthTokens",
      },
    };
  }
  return {
    error: {
      code: -32601,
      message: `Unsupported app-server request: ${input.method}`,
    },
  };
}

async function bootstrapCodexExternalAuth(input: {
  request: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}): Promise<void> {
  if (!codexHostAuthBridge) {
    return;
  }
  const bridge = codexHostAuthBridge;
  const auth = await bridge.readAuthTokens({
    reason: "account/login/start",
  });
  await input.request("account/login/start", {
    accessToken: auth.accessToken,
    chatgptAccountId: auth.chatgptAccountId,
    chatgptPlanType: auth.chatgptPlanType,
    type: "chatgptAuthTokens",
  });
}

function codexGlobalConfigArgs(configArgs: Array<string>): Array<string> {
  const args: Array<string> = [];
  for (let idx = 0; idx < configArgs.length; idx += 2) {
    if (configArgs[idx] !== "-c") continue;
    const value = configArgs[idx + 1];
    if (typeof value === "string" && value.length > 0) {
      args.push("--config", value);
    }
  }
  return args;
}

function normalizeCodexModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (trimmed === "codex-cli") return "default";
  if (trimmed === "codex" || trimmed.startsWith("codex/")) {
    throw new Error(
      'Legacy Codex model prefix "codex" is no longer supported. Use "codex-cli/default" or "codex-cli/<model>".',
    );
  }
  if (trimmed.startsWith(CODEX_PREFIX)) {
    const stripped = trimmed.slice(CODEX_PREFIX.length).trim();
    if (!stripped) {
      throw new Error(
        'Codex model prefix requires a model segment. Use "codex-cli/default" or "codex-cli/<model>".',
      );
    }
    return stripped;
  }
  return trimmed;
}

function assertEnumForCallTime(input: {
  value: string;
  allowed: Set<string>;
  field: string;
}): string {
  const normalized = input.value.trim().toLowerCase();
  if (!normalized) return normalized;
  if (input.allowed.has(normalized)) return normalized;
  const allowed = Array.from(input.allowed).join(", ");
  throw new Error(
    `Invalid Codex call-time ${input.field}: "${input.value}". Allowed values: ${allowed}.`,
  );
}

function safeJsonObject(
  text: string,
): Record<string, JSONValue> {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, JSONValue>;
    }
  } catch {
    // ignore parse failure
  }
  return {};
}

function safeJsonObjectFromRecord(
  value: Record<string, unknown>,
): Record<string, JSONValue> {
  try {
    return safeJsonObject(JSON.stringify(value));
  } catch {
    return {};
  }
}

function parseJsonValue(text: string): JSONValue {
  try {
    return JSON.parse(text) as JSONValue;
  } catch {
    return text;
  }
}

function stringifyJsonValue(value: JSONValue): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function codexResponseItemKey(item: ResponseItem): string {
  const record = asRecord(item);
  const id = typeof record.id === "string" ? record.id : "";
  const callId = typeof record.call_id === "string" ? record.call_id : "";
  if (id || callId) {
    return `${item.type}:${id}:${callId}`;
  }
  return `${item.type}:${JSON.stringify(record)}`;
}

function isCodexRawResponseItemRenderable(item: ResponseItem): boolean {
  return item.type !== "message" && item.type !== "reasoning" &&
    item.type !== "function_call" && item.type !== "function_call_output";
}

function codexRawResponseItemRecord(
  value: unknown,
): Record<string, unknown> | null {
  const item = asRecord(value);
  const type = typeof item.type === "string" ? item.type.trim() : "";
  return type ? item : null;
}

function isProviderTraceEvent(
  event: ResponseEvent,
): event is Extract<ResponseEvent, { type: "tool.call" | "tool.result" }> {
  return (event.type === "tool.call" || event.type === "tool.result") &&
    typeof event.toolKind === "string";
}

function responseEventToJsonRecord(
  event: ResponseEvent,
): Record<string, JSONValue> {
  return safeJsonObject(JSON.stringify(event));
}

function responseEventToProviderTraceEvent(
  event: Extract<ResponseEvent, { type: "tool.call" | "tool.result" }>,
): ProviderTraceEvent | null {
  if (typeof event.toolKind !== "string") return null;
  if (event.type === "tool.call") {
    if (typeof event.args === "undefined") return null;
    return {
      type: "tool.call",
      actionCallId: event.actionCallId,
      name: event.name,
      args: event.args,
      toolKind: event.toolKind,
      ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
      ...(typeof event.parentActionCallId === "string"
        ? { parentActionCallId: event.parentActionCallId }
        : {}),
    };
  }
  if (typeof event.result === "undefined") return null;
  return {
    type: "tool.result",
    actionCallId: event.actionCallId,
    name: event.name,
    result: event.result,
    toolKind: event.toolKind,
    ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
    ...(typeof event.parentActionCallId === "string"
      ? { parentActionCallId: event.parentActionCallId }
      : {}),
  };
}

function parseUsageBreakdown(value: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | undefined {
  const record = asRecord(value);
  const inputTokens = record.inputTokens;
  const outputTokens = record.outputTokens;
  const totalTokens = record.totalTokens;
  if (
    typeof inputTokens !== "number" || !Number.isFinite(inputTokens) ||
    typeof outputTokens !== "number" || !Number.isFinite(outputTokens) ||
    typeof totalTokens !== "number" || !Number.isFinite(totalTokens)
  ) {
    return undefined;
  }
  return {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens,
  };
}

function normalizeAppServerToolStatus(status: unknown): string {
  if (typeof status !== "string") return "";
  if (status === "inProgress") return "in_progress";
  return status;
}

function appServerThreadItemToCodexItem(
  item: Record<string, unknown>,
): Record<string, JSONValue> | null {
  const type = typeof item.type === "string" ? item.type : "";
  const id = typeof item.id === "string" ? item.id : "";
  if (!type || !id) return null;
  if (type === "agentMessage") {
    return {
      id,
      type: "agent_message",
      text: typeof item.text === "string" ? item.text : "",
    };
  }
  if (type === "reasoning") {
    return {
      id,
      type: "reasoning",
      summary: (Array.isArray(item.summary) ? item.summary : []) as JSONValue,
      content: (Array.isArray(item.content) ? item.content : []) as JSONValue,
    };
  }
  if (type === "mcpToolCall") {
    return {
      id,
      type: "mcp_tool_call",
      tool: typeof item.tool === "string" ? item.tool : "",
      server: typeof item.server === "string" ? item.server : "",
      status: normalizeAppServerToolStatus(item.status),
      arguments: (item.arguments ?? {}) as JSONValue,
      result: (item.result ?? null) as JSONValue,
      error: (item.error ?? null) as JSONValue,
    };
  }
  if (type === "commandExecution") {
    return {
      id,
      type: "command_execution",
      command: (item.command ?? "") as JSONValue,
      status: normalizeAppServerToolStatus(item.status),
      aggregated_output: typeof item.aggregatedOutput === "string"
        ? item.aggregatedOutput
        : "",
      exit_code: (item.exitCode ?? null) as JSONValue,
    };
  }
  if (type === "fileChange") {
    return {
      id,
      type: "file_change",
      status: normalizeAppServerToolStatus(item.status),
      changes: (Array.isArray(item.changes) ? item.changes : []) as JSONValue,
    };
  }
  return null;
}

function appServerNotificationToCodexEvent(
  method: string,
  params: Record<string, unknown>,
): Record<string, JSONValue> | null {
  if (method === "rawResponseItem/completed") {
    const item = codexRawResponseItemRecord(params.item);
    if (!item) return null;
    return {
      type: "raw.response_item.completed",
      item: safeJsonObjectFromRecord(item),
    };
  }

  if (method === "item/agentMessage/delta") {
    return {
      type: "item.delta",
      item: {
        id: typeof params.itemId === "string" ? params.itemId : "",
        type: "agent_message",
        text: typeof params.delta === "string" ? params.delta : "",
      },
    };
  }

  if (
    method === "item/reasoning/textDelta" ||
    method === "item/reasoning/summaryTextDelta"
  ) {
    return {
      type: "item.delta",
      item: {
        id: typeof params.itemId === "string" ? params.itemId : "reasoning",
        type: "reasoning",
        text: typeof params.delta === "string" ? params.delta : "",
      },
    };
  }

  if (
    method === "item/commandExecution/outputDelta" ||
    method === "item/fileChange/outputDelta"
  ) {
    const itemType = method === "item/commandExecution/outputDelta"
      ? "command_execution"
      : "file_change";
    return {
      type: "item.delta",
      item: {
        id: typeof params.itemId === "string" ? params.itemId : "",
        type: itemType,
        status: "in_progress",
        ...(itemType === "command_execution"
          ? {
            aggregated_output: typeof params.delta === "string"
              ? params.delta
              : "",
          }
          : { changes: [] }),
      },
    };
  }

  if (method === "item/mcpToolCall/progress") {
    logCodexMcpDebug("appServer:item.mcpToolCall.progress", {
      itemId: typeof params.itemId === "string" ? params.itemId : "",
      message: typeof params.message === "string" ? params.message : "",
    });
    return {
      type: "item.delta",
      item: {
        id: typeof params.itemId === "string" ? params.itemId : "",
        type: "mcp_tool_call",
        status: "in_progress",
        result: typeof params.message === "string" ? params.message : "",
      },
    };
  }

  if (method === "item/started" || method === "item/completed") {
    const item = asRecord(params.item);
    const mapped = appServerThreadItemToCodexItem(item);
    if (!mapped) return null;
    if (mapped.type === "mcp_tool_call") {
      logCodexMcpDebug(`appServer:${method}`, {
        itemId: mapped.id ?? "",
        server: mapped.server ?? "",
        tool: mapped.tool ?? "",
        status: mapped.status ?? "",
      });
    }
    return {
      type: method === "item/started" ? "item.started" : "item.completed",
      item: mapped,
    };
  }

  return null;
}

async function defaultAppServerTurnRunner(
  input: AppServerTurnRunnerInput,
): Promise<AppServerTurnRunnerOutput> {
  const codexBin = Deno.env.get(CODEX_BIN_ENV)?.trim() || "codex";
  const dangerousBypass = shouldDangerouslyBypassCodexApprovalsAndSandbox(
    input.params,
  );
  const skipSandboxConfig = shouldSkipCodexSandboxConfig(input.params);
  const spawnArgs = [
    ...codexGlobalConfigArgs(codexConfigArgs({
      cwd: input.cwd,
      deckPath: input.deckPath,
      params: input.params,
      instructions: input.instructions,
    })),
    ...(dangerousBypass
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : skipSandboxConfig
      ? ["--yolo"]
      : []),
    "app-server",
  ];
  logCodexMcpDebug("appServer:spawn", {
    argv: [codexBin, ...sanitizeCodexSpawnArgsForDebug(spawnArgs)],
    codexBin,
    cwd: input.cwd,
    dangerousBypass,
    gambitConfigArgs: spawnArgs.filter((arg) =>
      arg.includes("mcp_servers.gambit")
    ),
    skipSandboxConfig,
  });
  const child = new Deno.Command(codexBin, {
    args: spawnArgs,
    cwd: input.cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const abort = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };
  if (input.signal?.aborted) {
    abort();
  } else if (input.signal) {
    input.signal.addEventListener("abort", abort, { once: true });
  }

  const encoder = new TextEncoder();
  const stdoutReader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();
  const stdinWriter = child.stdin.getWriter();
  let childExitStatus: CommandStatusLike | null = null;
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  const stderrChunks: Array<string> = [];
  const assistantMessages: Array<CodexAssistantMessage> = [];
  const assistantIndexById = new Map<string, number>();
  const rawResponseItems: Array<ResponseItem> = [];
  const rawResponseItemKeys = new Set<string>();
  const turnState: {
    id?: string;
    completed: boolean;
    error?: Error;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  } = { completed: false };
  let nextRequestId = 1;
  let cleanupError: Error | null = null;
  let output: AppServerTurnRunnerOutput | null = null;
  let childClosedError: Error | null = null;

  const appServerClosedError = () => {
    if (childClosedError) {
      return childClosedError;
    }
    const stderr = stderrChunks.join("").trim();
    if (stderr) {
      childClosedError = new Error(`codex app-server failed: ${stderr}`);
      return childClosedError;
    }
    const detail = childExitStatus
      ? childExitStatus.code === 0
        ? "exited successfully"
        : `exited with code ${childExitStatus.code}`
      : "closed unexpectedly";
    childClosedError = new Error(
      `Codex app-server exited before the request completed (${detail}).`,
    );
    return childClosedError;
  };

  let rejectChildClosed: ((error: Error) => void) | null = null;
  const childClosed = new Promise<never>((_, reject) => {
    rejectChildClosed = reject;
  });
  // Some request paths can fail before they start awaiting `childClosed`
  // (for example, if writing to the child stdin fails immediately). Keep the
  // shared shutdown promise locally handled so a later child exit does not
  // surface as an unhandled rejection in those early-failure cases.
  childClosed.catch(() => undefined);
  const childStatus = child.status.then((status) => {
    childExitStatus = status;
    const error = appServerClosedError();
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(error);
    }
    pending.clear();
    rejectChildClosed?.(error);
    return status;
  });

  const writeMessage = async (message: Record<string, unknown>) => {
    logCodexAppServerDebug("message:out", {
      message,
    });
    await stdinWriter.write(encoder.encode(`${JSON.stringify(message)}\n`));
  };

  const request = (method: string, params: Record<string, unknown>) => {
    const id = String(nextRequestId++);
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    const requestPromise = promise.finally(() => {
      pending.delete(id);
    });
    requestPromise.catch(() => undefined);
    return Promise.race([writeMessage({ id, method, params }), childClosed])
      .catch((error) => {
        pending.delete(id);
        throw error;
      })
      .then(() => Promise.race([requestPromise, childClosed]));
  };

  const readLoop = async () => {
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
          logCodexAppServerDebug("message:in:parse_failed", {
            error: error instanceof Error ? error.message : String(error),
            lineLength: trimmed.length,
          });
          continue;
        }
        logCodexAppServerDebug("message:in", {
          message: parsed,
        });
        const method = typeof parsed.method === "string" ? parsed.method : "";
        const params = asRecord(parsed.params);
        if (method) {
          if (Object.prototype.hasOwnProperty.call(parsed, "id")) {
            const requestId = typeof parsed.id === "string" ||
                typeof parsed.id === "number" || parsed.id === null
              ? parsed.id
              : null;
            input.onStreamEvent?.({
              type: "app_server.request",
              requestId: requestId === null ? "null" : String(requestId),
              method,
              params: safeJsonObjectFromRecord(params),
            });
            const response = await appServerRequestResult({ method, params });
            logCodexAppServerDebug("message:host_response", {
              method,
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
          const pseudoEvent = appServerNotificationToCodexEvent(method, params);
          if (pseudoEvent) {
            input.onStreamEvent?.(pseudoEvent);
          }
          if (method === "rawResponseItem/completed") {
            const rawItem = codexRawResponseItemRecord(params.item);
            if (!rawItem) continue;
            const item = safeJsonObjectFromRecord(rawItem) as ResponseItem;
            if (isCodexRawResponseItemRenderable(item)) {
              const key = codexResponseItemKey(item);
              if (!rawResponseItemKeys.has(key)) {
                rawResponseItemKeys.add(key);
                rawResponseItems.push(item);
              }
            }
          } else if (method === "item/completed") {
            const item = asRecord(params.item);
            if (item.type === "agentMessage" && typeof item.id === "string") {
              const entry: CodexAssistantMessage = {
                itemId: item.id,
                text: typeof item.text === "string" ? item.text : "",
              };
              const existing = assistantIndexById.get(item.id);
              if (typeof existing === "number") {
                assistantMessages[existing] = entry;
              } else {
                assistantIndexById.set(item.id, assistantMessages.length);
                assistantMessages.push(entry);
              }
            }
          } else if (method === "thread/tokenUsage/updated") {
            if (
              typeof params.turnId === "string" &&
              (!turnState.id || params.turnId === turnState.id)
            ) {
              turnState.usage = parseUsageBreakdown(
                asRecord(params.tokenUsage).last,
              );
            }
          } else if (method === "turn/started") {
            const turn = asRecord(params.turn);
            if (typeof turn.id === "string") {
              turnState.id = turn.id;
            }
          } else if (method === "turn/completed") {
            const turn = asRecord(params.turn);
            if (typeof turn.id === "string") {
              turnState.id = turn.id;
            }
            if (turn.status === "failed") {
              const error = asRecord(turn.error);
              const message = typeof error.message === "string" && error.message
                ? error.message
                : "Codex app-server turn failed";
              turnState.error = new Error(message);
            } else if (turn.status === "interrupted") {
              turnState.error = new DOMException("Run canceled", "AbortError");
            }
            turnState.completed = true;
          }
          continue;
        }

        if (!Object.prototype.hasOwnProperty.call(parsed, "id")) continue;
        const responseId = String(parsed.id);
        const resolver = pending.get(responseId);
        if (!resolver) continue;
        pending.delete(responseId);
        if (parsed.error) {
          const error = asRecord(parsed.error);
          logCodexAppServerDebug("message:in:error", {
            responseId,
            error,
          });
          const message = typeof error.message === "string" && error.message
            ? error.message
            : "Codex app-server request failed";
          resolver.reject(new Error(message));
          continue;
        }
        logCodexAppServerDebug("message:in:result", {
          responseId,
          result: parsed.result,
        });
        resolver.resolve(parsed.result);
      }
    }
  };

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
        logCodexAppServerDebug("stderr", {
          line: trimmed,
        });
      }
    }
    if (buffered.trim()) {
      logCodexAppServerDebug("stderr", {
        line: buffered.trim(),
      });
    }
  })();

  const stdoutLoop = readLoop();

  try {
    await request("initialize", {
      clientInfo: {
        name: "gambit",
        title: "Gambit",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    await writeMessage({ method: "initialized", params: {} });
    await bootstrapCodexExternalAuth({ request });

    const model = normalizeCodexModel(input.model);
    const threadResult = input.priorThreadId
      ? await request("thread/resume", {
        threadId: input.priorThreadId,
        model: model && model !== "default" ? model : null,
        cwd: input.cwd,
        approvalPolicy: "never",
        sandboxPolicy: appServerThreadSandboxPolicy({
          cwd: input.cwd,
          params: input.params,
        }),
        persistExtendedHistory: false,
      }) as Record<string, unknown>
      : await request("thread/start", {
        model: model && model !== "default" ? model : null,
        cwd: input.cwd,
        approvalPolicy: "never",
        sandboxPolicy: appServerThreadSandboxPolicy({
          cwd: input.cwd,
          params: input.params,
        }),
        ephemeral: false,
        experimentalRawEvents: true,
        persistExtendedHistory: false,
      }) as Record<string, unknown>;

    const thread = asRecord(threadResult.thread);
    const threadId = typeof thread.id === "string"
      ? thread.id
      : input.priorThreadId;
    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id.");
    }

    const turnInput: Array<{ type: "text"; text: string }> = input.prompt
      ? [{ type: "text", text: input.prompt }]
      : [];

    await request("turn/start", {
      threadId,
      input: turnInput,
      cwd: input.cwd,
      approvalPolicy: "never",
      sandboxPolicy: appServerTurnSandboxPolicy({
        cwd: input.cwd,
        params: input.params,
      }),
      model: model && model !== "default" ? model : null,
    });

    while (!turnState.completed) {
      if (input.signal?.aborted) {
        throw new DOMException("Run canceled", "AbortError");
      }
      if (childExitStatus) {
        await Promise.allSettled([stdoutLoop, stderrLoop]);
        if (!turnState.completed && !turnState.error) {
          turnState.error = appServerClosedError();
        }
        break;
      }
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        childStatus.then(() => undefined),
        new Promise((resolve) => {
          pollTimer = setTimeout(resolve, 10);
        }),
      ]);
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer);
      }
    }

    if (turnState.error) throw turnState.error;

    output = {
      threadId,
      assistantMessages,
      rawResponseItems,
      usage: turnState.usage,
    };
  } finally {
    for (const { reject } of pending.values()) {
      reject(new Error("Codex app-server session closed"));
    }
    pending.clear();
    try {
      await stdinWriter.close();
    } catch {
      // ignore
    }
    await Promise.allSettled([stdoutLoop, stderrLoop, childStatus]);
    if (input.signal) {
      input.signal.removeEventListener("abort", abort);
    }
    if (
      input.signal?.aborted ||
      turnState.error instanceof DOMException &&
        turnState.error.name === "AbortError"
    ) {
      cleanupError = new DOMException("Run canceled", "AbortError");
    } else if (!turnState.completed && !turnState.error) {
      cleanupError = appServerClosedError();
    }
  }
  if (cleanupError) {
    throw cleanupError;
  }
  if (!output) {
    throw new Error("Codex app-server turn runner completed without a result.");
  }
  return output;
}

function codexToolResultForItem(
  itemType: string,
  record: Record<string, JSONValue>,
): JSONValue {
  if (itemType === "mcp_tool_call") {
    return {
      server: record.server ?? "",
      status: record.status ?? "",
      result: record.result ?? null,
      error: record.error ?? null,
    };
  }
  if (itemType === "command_execution") {
    return {
      command: record.command ?? "",
      status: record.status ?? "",
      output: record.aggregated_output ?? "",
      exit_code: record.exit_code ?? null,
    };
  }
  if (itemType === "file_change") {
    return {
      status: record.status ?? "",
      changes: record.changes ?? [],
    };
  }
  return record ?? null;
}

function emitCodexToolEvents(input: {
  event: Record<string, JSONValue>;
  emit: (event: ResponseEvent) => void;
  toolNames: Map<string, string>;
  emittedCalls: Set<string>;
  emittedTerminalResults: Set<string>;
  lastResultFingerprintByCallId: Map<string, string>;
  toolOutputIndexByCallId: Map<string, number>;
  nextOutputIndexRef: { value: number };
}): void {
  const payloadType = typeof input.event.type === "string"
    ? input.event.type
    : "";
  if (!payloadType.startsWith("item.")) return;
  const item = input.event.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return;
  const record = item as Record<string, JSONValue>;
  const itemType = typeof record.type === "string" ? record.type : "";
  const callId = typeof record.id === "string"
    ? record.id
    : typeof record.call_id === "string"
    ? record.call_id
    : "";
  if (!callId) return;

  if (itemType === "reasoning" || itemType === "agent_message") return;

  const name = typeof record.tool === "string"
    ? record.tool
    : typeof record.name === "string"
    ? record.name
    : input.toolNames.get(callId) ?? itemType;

  const normalizedArgs = (() => {
    if (itemType === "command_execution") {
      return { command: record.command ?? "" } as JSONValue;
    }
    if (itemType === "file_change") {
      return { changes: record.changes ?? [] } as JSONValue;
    }
    const rawArgs = record.arguments;
    return typeof rawArgs === "string"
      ? parseJsonValue(rawArgs)
      : rawArgs ?? {};
  })();
  const resolvedName = name ?? input.toolNames.get(callId) ?? itemType;
  const outputIndex = (() => {
    const existing = input.toolOutputIndexByCallId.get(callId);
    if (typeof existing === "number") return existing;
    const next = input.nextOutputIndexRef.value;
    input.nextOutputIndexRef.value += 1;
    input.toolOutputIndexByCallId.set(callId, next);
    return next;
  })();
  const argsText = stringifyJsonValue(normalizedArgs);

  if (!input.emittedCalls.has(callId)) {
    input.emittedCalls.add(callId);
    input.toolNames.set(callId, name);
    input.emit({
      type: "tool.call",
      actionCallId: callId,
      name,
      args: normalizedArgs,
      toolKind: "mcp_bridge",
    });
    input.emit({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: {
        type: "function_call",
        id: `${callId}:call`,
        call_id: callId,
        name: resolvedName,
        arguments: argsText,
      },
    });
  }

  if (!resolvedName) return;
  const isTerminal = payloadType === "item.completed" ||
    payloadType === "item.done";
  const result = codexToolResultForItem(itemType, record);
  const resultFingerprint = stringifyJsonValue(result);
  const priorResultFingerprint = input.lastResultFingerprintByCallId.get(
    callId,
  );
  const shouldEmitProgressResult = payloadType !== "item.started" &&
    resultFingerprint !== priorResultFingerprint;
  if (shouldEmitProgressResult) {
    input.lastResultFingerprintByCallId.set(callId, resultFingerprint);
    input.emit({
      type: "tool.result",
      actionCallId: callId,
      name: resolvedName,
      result,
      toolKind: "mcp_bridge",
    });
  }
  if (!isTerminal || input.emittedTerminalResults.has(callId)) return;
  input.emittedTerminalResults.add(callId);
  input.emit({
    type: "response.output_item.done",
    output_index: outputIndex,
    item: {
      type: "function_call_output",
      id: `${callId}:output`,
      call_id: callId,
      output: stringifyJsonValue(result),
    },
  });
}

function extractTextParts(value: JSONValue | undefined): Array<string> {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  const parts: Array<string> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, JSONValue>;
    if (typeof record.text === "string") parts.push(record.text);
  }
  return parts;
}

function extractCodexItemText(record: Record<string, JSONValue>): string {
  return typeof record.text === "string"
    ? record.text
    : joinTextParts(extractTextParts(record.content));
}

type CodexAssistantStreamState = {
  streamedText: string;
  sawAssistantTextStream: boolean;
  assistantOutputIndexByItemId: Map<string, number>;
  emittedTerminalAssistantItemIds: Set<string>;
  rawOutputIndexByItemKey: Map<string, number>;
  emittedTerminalRawItemKeys: Set<string>;
};

function requireCodexAssistantItemId(input: {
  payloadType: string;
  record: Record<string, JSONValue>;
}): string {
  const itemId = typeof input.record.id === "string"
    ? input.record.id.trim()
    : "";
  if (itemId) return itemId;
  throw new Error(
    `Codex ${input.payloadType} agent_message is missing required item.id.`,
  );
}

function resolveCodexAssistantItemIdentity(input: {
  payloadType: string;
  record: Record<string, JSONValue>;
  assistantState: Pick<
    CodexAssistantStreamState,
    "assistantOutputIndexByItemId"
  >;
  nextOutputIndexRef: { value: number };
}): {
  itemId: string;
  outputIndex: number;
} {
  const itemId = requireCodexAssistantItemId({
    payloadType: input.payloadType,
    record: input.record,
  });
  const existing = input.assistantState.assistantOutputIndexByItemId.get(
    itemId,
  );
  if (typeof existing === "number") {
    return {
      itemId,
      outputIndex: existing,
    };
  }
  const next = input.nextOutputIndexRef.value;
  input.nextOutputIndexRef.value += 1;
  input.assistantState.assistantOutputIndexByItemId.set(itemId, next);
  return {
    itemId,
    outputIndex: next,
  };
}

function emitCodexAssistantTextEvents(input: {
  event: Record<string, JSONValue>;
  emit: (event: ResponseEvent) => void;
  emitText?: (text: string) => void;
  assistantState: CodexAssistantStreamState;
  nextOutputIndexRef: { value: number };
}): void {
  const payloadType = typeof input.event.type === "string"
    ? input.event.type
    : "";
  if (!payloadType.startsWith("item.")) return;
  const item = input.event.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return;
  const record = item as Record<string, JSONValue>;
  if (record.type !== "agent_message") return;

  const { itemId, outputIndex } = resolveCodexAssistantItemIdentity({
    payloadType,
    record,
    assistantState: input.assistantState,
    nextOutputIndexRef: input.nextOutputIndexRef,
  });
  const text = extractCodexItemText(record);
  if (!text) return;

  if (payloadType === "item.delta") {
    input.assistantState.sawAssistantTextStream = true;
    input.assistantState.streamedText += text;
    input.emit({
      type: "response.output_text.delta",
      output_index: outputIndex,
      delta: text,
      item_id: itemId,
    });
    input.emitText?.(text);
    return;
  }

  if (payloadType === "item.completed" || payloadType === "item.done") {
    const hadPriorAssistantDelta = input.assistantState.sawAssistantTextStream;
    input.assistantState.sawAssistantTextStream = true;
    input.assistantState.streamedText = text;
    input.emit({
      type: "response.output_text.done",
      output_index: outputIndex,
      text,
      item_id: itemId,
    });
    if (!input.assistantState.emittedTerminalAssistantItemIds.has(itemId)) {
      input.assistantState.emittedTerminalAssistantItemIds.add(itemId);
      input.emit({
        type: "response.output_item.done",
        output_index: outputIndex,
        item: {
          type: "message",
          role: "assistant",
          id: itemId,
          content: [{ type: "output_text", text }],
        },
      });
    }
    if (!hadPriorAssistantDelta) {
      input.emitText?.(text);
    }
  }
}

function emitCodexReasoningEvents(input: {
  event: Record<string, JSONValue>;
  emit: (event: ResponseEvent) => void;
}): void {
  const payloadType = typeof input.event.type === "string"
    ? input.event.type
    : "";
  if (!payloadType.startsWith("item.")) return;
  const item = input.event.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return;
  const record = item as Record<string, JSONValue>;
  if (record.type !== "reasoning") return;

  const itemId = typeof record.id === "string" ? record.id : "reasoning";
  const outputIndex = 0;
  const contentIndex = 0;

  if (payloadType === "item.delta") {
    const deltaText = typeof record.text === "string"
      ? record.text
      : joinTextParts(extractTextParts(record.content));
    if (deltaText) {
      input.emit({
        type: "response.reasoning.delta",
        output_index: outputIndex,
        item_id: itemId,
        content_index: contentIndex,
        delta: deltaText,
      });
    }
  }

  if (payloadType === "item.completed" || payloadType === "item.done") {
    const doneText = typeof record.text === "string"
      ? record.text
      : joinTextParts(extractTextParts(record.content));
    input.emit({
      type: "response.reasoning.done",
      output_index: outputIndex,
      item_id: itemId,
      content_index: contentIndex,
      text: doneText,
    });
    const summaryParts = Array.isArray(record.summary) ? record.summary : [];
    const summaryTexts: Array<string> = [];
    summaryParts.forEach((part, idx) => {
      if (!part || typeof part !== "object") return;
      const partRecord = part as Record<string, JSONValue>;
      const text = typeof partRecord.text === "string" ? partRecord.text : "";
      summaryTexts.push(text);
      input.emit({
        type: "response.reasoning_summary_part.added",
        output_index: outputIndex,
        item_id: itemId,
        summary_index: idx,
        part: {
          type: "summary_text",
          text,
        },
      });
      input.emit({
        type: "response.reasoning_summary_part.done",
        output_index: outputIndex,
        item_id: itemId,
        summary_index: idx,
        part: {
          type: "summary_text",
          text,
        },
      });
      input.emit({
        type: "response.reasoning_summary_text.delta",
        output_index: outputIndex,
        item_id: itemId,
        summary_index: idx,
        delta: text,
      });
    });
    if (summaryTexts.length > 0) {
      input.emit({
        type: "response.reasoning_summary_text.done",
        output_index: outputIndex,
        item_id: itemId,
        summary_index: 0,
        text: summaryTexts.join("\n").trim(),
      });
    }
  }
}

function emitCodexRawResponseItemEvents(input: {
  event: Record<string, JSONValue>;
  emit: (event: ResponseEvent) => void;
  assistantState: Pick<
    CodexAssistantStreamState,
    "rawOutputIndexByItemKey" | "emittedTerminalRawItemKeys"
  >;
  nextOutputIndexRef: { value: number };
}): void {
  if (input.event.type !== "raw.response_item.completed") return;
  const item = asRecord(input.event.item);
  const type = typeof item.type === "string" ? item.type : "";
  if (!type) return;
  const responseItem = safeJsonObjectFromRecord(item) as ResponseItem;
  if (!isCodexRawResponseItemRenderable(responseItem)) return;
  const itemKey = codexResponseItemKey(responseItem);
  if (input.assistantState.emittedTerminalRawItemKeys.has(itemKey)) return;
  const existing = input.assistantState.rawOutputIndexByItemKey.get(itemKey);
  const outputIndex = typeof existing === "number" ? existing : (() => {
    const next = input.nextOutputIndexRef.value;
    input.nextOutputIndexRef.value += 1;
    input.assistantState.rawOutputIndexByItemKey.set(itemKey, next);
    return next;
  })();
  input.emit({
    type: "response.output_item.added",
    output_index: outputIndex,
    item: responseItem,
  });
  input.emit({
    type: "response.output_item.done",
    output_index: outputIndex,
    item: responseItem,
  });
  input.assistantState.emittedTerminalRawItemKeys.add(itemKey);
}

function responseItemsToChatMessages(
  items: Array<ResponseItem>,
  instructions?: string,
): Array<ModelMessage> {
  const messages: Array<ModelMessage> = [];
  if (typeof instructions === "string" && instructions.trim().length > 0) {
    messages.push({ role: "system", content: instructions });
  }
  for (const item of items) {
    if (item.type === "message") {
      const content = joinTextParts(item.content.map((part) => part.text));
      messages.push({ role: item.role, content });
      continue;
    }
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        }],
      });
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        content: item.output,
        tool_call_id: item.call_id,
      });
    }
  }
  return messages;
}

function responseItemsFromAssistantMessage(
  message: ModelMessage,
): Array<ResponseItem> {
  const output: Array<ResponseItem> = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    output.push(
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message.content }],
      } satisfies ResponseMessageItem,
    );
  }
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      output.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
  }
  return output;
}

function responseItemsFromAssistantMessages(
  messages: Array<CodexAssistantMessage>,
): Array<ResponseItem> {
  return messages
    .filter((message) => message.text.length > 0)
    .map((message) =>
      ({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message.text }],
        ...(message.itemId ? { id: message.itemId } : {}),
      }) satisfies ResponseMessageItem
    );
}

function codexResponseOutputLocator(item: ResponseItem): string {
  if (
    item.type === "message" && item.role === "assistant" &&
    typeof item.id === "string" && item.id.trim().length > 0
  ) {
    return `assistant:${item.id}`;
  }
  if (isCodexRawResponseItemRenderable(item)) {
    return `raw:${codexResponseItemKey(item)}`;
  }
  return `synthetic:${codexResponseItemKey(item)}`;
}

function codexResponseOutputIndexes(input: {
  items: Array<ResponseItem>;
  assistantState?: Pick<
    CodexAssistantStreamState,
    "assistantOutputIndexByItemId" | "rawOutputIndexByItemKey"
  >;
}): Map<string, number> {
  const indexes = new Map<string, number>();
  const claimed = new Set<number>();
  const state = input.assistantState;
  if (state) {
    for (const item of input.items) {
      const locator = codexResponseOutputLocator(item);
      if (indexes.has(locator)) continue;
      if (
        item.type === "message" && item.role === "assistant" &&
        typeof item.id === "string"
      ) {
        const index = state.assistantOutputIndexByItemId.get(item.id);
        if (typeof index === "number") {
          indexes.set(locator, index);
          claimed.add(index);
        }
        continue;
      }
      if (isCodexRawResponseItemRenderable(item)) {
        const index = state.rawOutputIndexByItemKey.get(
          codexResponseItemKey(item),
        );
        if (typeof index === "number") {
          indexes.set(locator, index);
          claimed.add(index);
        }
      }
    }
  }
  let nextIndex = claimed.size === 0 ? 0 : Math.max(...claimed) + 1;
  for (const item of input.items) {
    const locator = codexResponseOutputLocator(item);
    if (indexes.has(locator)) continue;
    while (claimed.has(nextIndex)) nextIndex += 1;
    indexes.set(locator, nextIndex);
    claimed.add(nextIndex);
    nextIndex += 1;
  }
  return indexes;
}

function mergeCodexResponseOutput(input: {
  assistantMessages: Array<CodexAssistantMessage>;
  assistantMessage: ModelMessage;
  rawResponseItems?: Array<ResponseItem>;
  assistantState?: Pick<
    CodexAssistantStreamState,
    "assistantOutputIndexByItemId" | "rawOutputIndexByItemKey"
  >;
}): Array<ResponseItem> {
  const assistantOutput = input.assistantMessages.length > 0
    ? responseItemsFromAssistantMessages(input.assistantMessages)
    : responseItemsFromAssistantMessage(input.assistantMessage);
  const rawOutput = (input.rawResponseItems ?? []).filter(
    isCodexRawResponseItemRenderable,
  );
  if (rawOutput.length === 0) return assistantOutput;
  const seen = new Set(assistantOutput.map(codexResponseItemKey));
  const mergedOutput = [
    ...assistantOutput,
    ...rawOutput.filter((item) => {
      const key = codexResponseItemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
  const outputIndexes = codexResponseOutputIndexes({
    items: mergedOutput,
    assistantState: input.assistantState,
  });
  return mergedOutput.sort((left, right) =>
    (outputIndexes.get(codexResponseOutputLocator(left)) ?? 0) -
    (outputIndexes.get(codexResponseOutputLocator(right)) ?? 0)
  );
}

function stringContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  return "";
}

function codexInstructionsForMessages(messages: Array<ModelMessage>): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => stringContent(message.content))
    .filter(Boolean)
    .join("\n\n");
}

function latestUserPrompt(messages: Array<ModelMessage>): string {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const msg = messages[idx];
    if (msg.role !== "user") continue;
    const content = stringContent(msg.content);
    if (content) return content;
  }
  return "";
}

function promptForCodexTurn(input: {
  messages: Array<ModelMessage>;
  priorThreadId?: string;
}): string {
  if (input.priorThreadId) {
    // Thread resume should be incremental: only send the newest user turn.
    for (let idx = input.messages.length - 1; idx >= 0; idx -= 1) {
      const msg = input.messages[idx];
      if (msg.role === "system") continue;
      if (msg.role !== "user") return "";
      return stringContent(msg.content);
    }
    return latestUserPrompt(input.messages);
  }
  const nonSystemMessages = input.messages.filter((message) =>
    message.role !== "system"
  );
  const latestUser = latestUserPrompt(nonSystemMessages);
  if (
    nonSystemMessages.length <= 1 &&
    nonSystemMessages.every((message) => message.role === "user")
  ) {
    return latestUser;
  }
  throw new Error(
    "Codex fresh-thread continuation is unsupported; missing codex.threadId for prior conversation state.",
  );
}

function buildUpdatedState(input: {
  priorState?: SavedState;
  messages: Array<ModelMessage>;
  assistantText: string;
  assistantMessages?: Array<CodexAssistantMessage>;
  threadId?: string;
}): SavedState {
  const priorState = input.priorState;
  const baseMessages = input.messages.map((message) => ({ ...message }));
  if (input.assistantMessages && input.assistantMessages.length > 0) {
    baseMessages.push(
      ...input.assistantMessages.map((message) => ({
        role: "assistant" as const,
        content: message.text,
      })),
    );
  } else {
    baseMessages.push({ role: "assistant", content: input.assistantText });
  }
  const meta = { ...(priorState?.meta ?? {}) };
  if (input.threadId) {
    meta[CODEX_THREAD_META_KEY] = input.threadId;
  }
  return {
    runId: priorState?.runId ?? crypto.randomUUID(),
    messages: baseMessages,
    format: priorState?.format ?? "chat",
    items: priorState?.items,
    messageRefs: priorState?.messageRefs,
    feedback: priorState?.feedback,
    meta,
    notes: priorState?.notes,
    conversationScore: priorState?.conversationScore,
  };
}

function buildCodexStreamHandler(input: {
  emitRaw: (event: Record<string, JSONValue>) => void;
  emitTool: (event: ResponseEvent) => void;
  emitText?: (text: string) => void;
  assistantState: CodexAssistantStreamState;
}): (event: Record<string, JSONValue>) => void {
  const toolNames = new Map<string, string>();
  const emittedCalls = new Set<string>();
  const emittedTerminalResults = new Set<string>();
  const lastResultFingerprintByCallId = new Map<string, string>();
  const toolOutputIndexByCallId = new Map<string, number>();
  const nextOutputIndexRef = { value: 0 };
  return (event) => {
    emitCodexAssistantTextEvents({
      event,
      emit: input.emitTool,
      emitText: input.emitText,
      assistantState: input.assistantState,
      nextOutputIndexRef,
    });
    emitCodexReasoningEvents({
      event,
      emit: input.emitTool,
    });
    emitCodexRawResponseItemEvents({
      event,
      emit: input.emitTool,
      assistantState: input.assistantState,
      nextOutputIndexRef,
    });
    emitCodexToolEvents({
      event,
      emit: input.emitTool,
      toolNames,
      emittedCalls,
      emittedTerminalResults,
      lastResultFingerprintByCallId,
      toolOutputIndexByCallId,
      nextOutputIndexRef,
    });
    input.emitRaw(event);
  };
}

export function createCodexProvider(opts?: {
  runAppServerTurn?: AppServerTurnRunner;
}): ModelProvider {
  const runAppServerTurn = opts?.runAppServerTurn ?? defaultAppServerTurnRunner;
  type LegacyChatInput = {
    model: string;
    messages: Array<ModelMessage>;
    stream?: boolean;
    state?: SavedState;
    deckPath?: string;
    signal?: AbortSignal;
    onStreamText?: (chunk: string) => void;
    onStreamEvent?: (event: Record<string, JSONValue>) => void;
    onTraceEvent?: (event: ProviderTraceEvent) => void;
    params?: Record<string, unknown>;
    tools?: Array<ResponseToolDefinition>;
  };
  type LegacyChatResult = {
    message: ModelMessage;
    finishReason: "stop" | "tool_calls" | "length";
    updatedState?: SavedState;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      reasoningTokens?: number;
    };
  };
  const runCodexTurn = async (
    input: LegacyChatInput,
  ): Promise<
    LegacyChatResult & {
      assistantMessages: Array<CodexAssistantMessage>;
      rawResponseItems: Array<ResponseItem>;
    }
  > => {
    if (input.signal?.aborted) {
      throw new DOMException("Run canceled", "AbortError");
    }
    const assistantState: CodexAssistantStreamState = {
      streamedText: "",
      sawAssistantTextStream: false,
      assistantOutputIndexByItemId: new Map<string, number>(),
      emittedTerminalAssistantItemIds: new Set<string>(),
      rawOutputIndexByItemKey: new Map<string, number>(),
      emittedTerminalRawItemKeys: new Set<string>(),
    };
    const streamHandler = (input.onStreamEvent || input.onTraceEvent ||
        (input.stream && input.onStreamText))
      ? buildCodexStreamHandler({
        emitRaw: (event) => input.onStreamEvent?.(event),
        emitTool: (event) => {
          input.onStreamEvent?.(responseEventToJsonRecord(event));
          if (isProviderTraceEvent(event)) {
            const traceEvent = responseEventToProviderTraceEvent(event);
            if (traceEvent) {
              input.onTraceEvent?.(traceEvent);
            }
          }
        },
        emitText: input.stream
          ? (text) => input.onStreamText?.(text)
          : undefined,
        assistantState,
      })
      : undefined;
    const priorThreadIdRaw = input.state?.meta?.[CODEX_THREAD_META_KEY];
    const priorThreadId = typeof priorThreadIdRaw === "string" &&
        priorThreadIdRaw.trim().length > 0
      ? priorThreadIdRaw.trim()
      : undefined;
    const instructions = codexInstructionsForMessages(input.messages);
    const prompt = promptForCodexTurn({
      messages: input.messages,
      priorThreadId,
    });
    const cwd = codexRunCwd({ deckPath: input.deckPath });
    const preparedMcpRoot = await prepareCodexMcpRootDeck({
      deckPath: input.deckPath,
      tools: input.tools,
    });
    try {
      const result = await runAppServerTurn({
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        state: input.state,
        params: input.params,
        deckPath: preparedMcpRoot.deckPath ?? input.deckPath,
        signal: input.signal,
        onStreamEvent: streamHandler,
        instructions,
        prompt,
        injectItems: [],
        cwd,
        priorThreadId,
      });
      const assistantText = joinTextParts(
        result.assistantMessages.map((message) => message.text),
      );
      if (
        input.stream && input.onStreamText && assistantText &&
        !assistantState.sawAssistantTextStream
      ) {
        input.onStreamText(assistantText);
      }
      const updatedState = buildUpdatedState({
        priorState: input.state,
        messages: input.messages,
        assistantText,
        assistantMessages: result.assistantMessages,
        threadId: result.threadId ?? priorThreadId,
      });

      return {
        message: { role: "assistant", content: assistantText },
        finishReason: "stop" as const,
        updatedState,
        usage: result.usage,
        assistantMessages: result.assistantMessages,
        rawResponseItems: result.rawResponseItems ?? [],
      };
    } finally {
      await preparedMcpRoot.cleanup?.();
    }
  };
  return {
    async responses(input: {
      request: CreateResponseRequest;
      state?: SavedState;
      deckPath?: string;
      signal?: AbortSignal;
      onStreamEvent?: (event: ResponseEvent) => void;
    }): Promise<CreateResponseResponse> {
      const streamHandler = input.onStreamEvent
        ? (() => {
          const assistantState: CodexAssistantStreamState = {
            streamedText: "",
            sawAssistantTextStream: false,
            assistantOutputIndexByItemId: new Map<string, number>(),
            emittedTerminalAssistantItemIds: new Set<string>(),
            rawOutputIndexByItemKey: new Map<string, number>(),
            emittedTerminalRawItemKeys: new Set<string>(),
          };
          return {
            assistantState,
            handle: buildCodexStreamHandler({
              emitRaw: (event) => {
                input.onStreamEvent?.({
                  type: "codex.event",
                  payload: event,
                });
              },
              emitTool: (event) => {
                input.onStreamEvent?.(event);
              },
              assistantState,
            }),
          };
        })()
        : undefined;
      const result = await runCodexTurn({
        model: input.request.model,
        messages: responseItemsToChatMessages(
          input.request.input,
          input.request.instructions,
        ),
        tools: input.request.tools,
        stream: input.request.stream,
        params: input.request.params,
        state: input.state,
        deckPath: input.deckPath,
        signal: input.signal,
        onStreamEvent: streamHandler?.handle,
      });

      const output = mergeCodexResponseOutput({
        assistantMessages: result.assistantMessages,
        assistantMessage: result.message,
        rawResponseItems: result.rawResponseItems,
        assistantState: streamHandler?.assistantState,
      });
      const outputIndexes = codexResponseOutputIndexes({
        items: output,
        assistantState: streamHandler?.assistantState,
      });
      const responseId = `codex-${crypto.randomUUID()}`;
      const createdAt = Math.floor(Date.now() / 1000);
      if (input.request.stream) {
        input.onStreamEvent?.({
          type: "response.created",
          sequence_number: 0,
          response: {
            id: responseId,
            object: "response",
            model: input.request.model,
            created_at: createdAt,
            created: createdAt,
            status: "in_progress",
            output: [],
            error: null,
          },
        });
        if (
          !streamHandler?.assistantState.sawAssistantTextStream
        ) {
          const fallbackMessages = result.assistantMessages.length > 0
            ? result.assistantMessages
            : typeof result.message.content === "string" &&
                result.message.content
            ? [{ itemId: null, text: result.message.content }]
            : [];
          fallbackMessages.forEach((message, index) => {
            if (!message.text) return;
            const fallbackItem = {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: message.text }],
              ...(message.itemId ? { id: message.itemId } : {}),
            } satisfies ResponseMessageItem;
            const outputIndex =
              outputIndexes.get(codexResponseOutputLocator(fallbackItem)) ??
                output.length + index;
            input.onStreamEvent?.({
              type: "response.output_text.delta",
              sequence_number: 1 + (index * 2),
              output_index: outputIndex,
              delta: message.text,
              ...(message.itemId ? { item_id: message.itemId } : {}),
            });
            input.onStreamEvent?.({
              type: "response.output_text.done",
              sequence_number: 2 + (index * 2),
              output_index: outputIndex,
              text: message.text,
              ...(message.itemId ? { item_id: message.itemId } : {}),
            });
          });
        }
        output.forEach((item, index) => {
          const outputIndex =
            outputIndexes.get(codexResponseOutputLocator(item)) ?? index;
          if (
            item.type === "message" &&
            item.role === "assistant" &&
            typeof item.id === "string" &&
            streamHandler?.assistantState.emittedTerminalAssistantItemIds.has(
              item.id,
            )
          ) {
            return;
          }
          if (
            isCodexRawResponseItemRenderable(item) &&
            streamHandler?.assistantState.emittedTerminalRawItemKeys.has(
              codexResponseItemKey(item),
            )
          ) {
            return;
          }
          input.onStreamEvent?.({
            type: "response.output_item.added",
            sequence_number: 3 + (index * 2),
            output_index: outputIndex,
            item,
          });
          input.onStreamEvent?.({
            type: "response.output_item.done",
            sequence_number: 4 + (index * 2),
            output_index: outputIndex,
            item,
          });
        });
      }

      const response: CreateResponseResponse = {
        id: responseId,
        object: "response",
        model: input.request.model,
        created_at: createdAt,
        created: createdAt,
        status: "completed",
        output,
        usage: result.usage,
        error: null,
        updatedState: result.updatedState,
      };
      if (input.request.stream) {
        input.onStreamEvent?.({
          type: "response.completed",
          sequence_number: 1000,
          response,
        });
      }
      return response;
    },
  };
}

export function normalizeCodexModelForTest(model: string): string {
  return normalizeCodexModel(model);
}

export function codexInstructionsForMessagesForTest(
  messages: Array<ModelMessage>,
): string {
  return codexInstructionsForMessages(messages);
}

export function promptForCodexTurnForTest(input: {
  messages: Array<ModelMessage>;
  priorThreadId?: string;
}): string {
  return promptForCodexTurn(input);
}

export function codexConfigArgsForTest(input: {
  cwd: string;
  deckPath?: string;
  params?: Record<string, unknown>;
  instructions?: string;
}): Array<string> {
  return codexConfigArgs(input);
}

export function safeJsonForTest(text: string): Record<string, JSONValue> {
  return safeJsonObject(text);
}

export function sanitizeCodexSpawnArgsForTest(
  args: Array<string>,
): Array<string> {
  return sanitizeCodexSpawnArgsForDebug(args);
}

export function extractCodexConfigValuesForTest(
  args: Array<string>,
  flag: string,
  prefix?: string,
): Array<string> {
  return extractCodexConfigValues(args, flag, prefix);
}
