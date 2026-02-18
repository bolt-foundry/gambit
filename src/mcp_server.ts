import { TextLineStream } from "@std/streams/text-line-stream";
import {
  loadDeck,
  type ModelProvider,
  toJsonSchema,
} from "@bolt-foundry/gambit-core";
import { createOpenRouterProvider } from "./providers/openrouter.ts";
import { createGoogleProvider } from "./providers/google.ts";
import { createOllamaProvider } from "./providers/ollama.ts";
import type { JSONValue } from "@bolt-foundry/gambit-core";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, JSONValue>;
};

const encoder = new TextEncoder();
const MCP_ALLOW_MODELS_ENV = "GAMBIT_MCP_ALLOW_MODELS";
const MCP_ROOT_DECK_PATH_ENV = "GAMBIT_MCP_ROOT_DECK_PATH";

type ToolCatalog = {
  tools: Array<McpTool>;
  actionToDeck: Map<string, string>;
  externalToolNames: Set<string>;
};

async function resolveToolCatalog(): Promise<ToolCatalog> {
  const rootDeckPath = Deno.env.get(MCP_ROOT_DECK_PATH_ENV)?.trim();
  if (!rootDeckPath) {
    throw new Error(
      `${MCP_ROOT_DECK_PATH_ENV} is required for MCP tool export.`,
    );
  }

  const deck = await loadDeck(rootDeckPath);
  const actionToDeck = new Map<string, string>();
  const externalToolNames = new Set<string>();
  const toolMap = new Map<string, McpTool>();

  for (const action of deck.actionDecks) {
    actionToDeck.set(action.name, action.path);
    toolMap.set(action.name, {
      name: action.name,
      description: action.description ??
        `Run action deck "${action.name}" from the root deck.`,
      inputSchema: {
        type: "object",
        additionalProperties: true,
      },
    });
  }

  for (const externalTool of deck.tools) {
    externalToolNames.add(externalTool.name);
    toolMap.set(externalTool.name, {
      name: externalTool.name,
      description: externalTool.description ??
        `External tool "${externalTool.name}".`,
      inputSchema: externalTool.inputSchema
        ? toJsonSchema(externalTool.inputSchema)
        : { type: "object", additionalProperties: true },
    });
  }

  return {
    tools: Array.from(toolMap.values()),
    actionToDeck,
    externalToolNames,
  };
}

async function writeJsonRpcResponse(response: JsonRpcResponse): Promise<void> {
  const body = encoder.encode(`${JSON.stringify(response)}\n`);
  await Deno.stdout.write(body);
}

function toRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

function toRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function shouldAllowModelBackedDecks(): boolean {
  const raw = Deno.env.get(MCP_ALLOW_MODELS_ENV);
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function createMcpModelProvider(): ModelProvider {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  const googleApiKey = (Deno.env.get("GOOGLE_API_KEY") ??
    Deno.env.get("GEMINI_API_KEY"))?.trim();
  const ollamaBaseURL = Deno.env.get("OLLAMA_BASE_URL") ?? undefined;
  const openRouterBaseURL = Deno.env.get("OPENROUTER_BASE_URL") ?? undefined;
  const googleBaseURL = Deno.env.get("GOOGLE_BASE_URL") ??
    Deno.env.get("GEMINI_BASE_URL") ??
    undefined;

  const openrouter = openRouterApiKey
    ? createOpenRouterProvider({
      apiKey: openRouterApiKey,
      baseURL: openRouterBaseURL,
      enableResponses: true,
    })
    : null;
  const google = googleApiKey
    ? createGoogleProvider({ apiKey: googleApiKey, baseURL: googleBaseURL })
    : null;
  const ollama = createOllamaProvider({
    apiKey: Deno.env.get("OLLAMA_API_KEY")?.trim() || undefined,
    baseURL: ollamaBaseURL,
  });

  return {
    chat: async (input) => {
      const model = input.model ?? "";
      if (model.startsWith("openrouter/")) {
        if (!openrouter) {
          throw new Error("OPENROUTER_API_KEY is required for openrouter/*");
        }
        return await openrouter.chat(input);
      }
      if (model.startsWith("google/")) {
        if (!google) {
          throw new Error("GOOGLE_API_KEY is required for google/*");
        }
        return await google.chat(input);
      }
      if (model.startsWith("ollama/")) {
        return await ollama.chat(input);
      }
      if (openrouter) {
        return await openrouter.chat(input);
      }
      if (google) {
        return await google.chat(input);
      }
      throw new Error(
        "No model provider available for MCP deck execution. Set OPENROUTER_API_KEY or GOOGLE_API_KEY.",
      );
    },
  };
}

async function runActionTool(input: {
  name: string;
  args: Record<string, unknown>;
  actionToDeck: Map<string, string>;
  externalToolNames: Set<string>;
}): Promise<{
  isError: boolean;
  text: string;
}> {
  const { isGambitEndSignal, runDeck } = await import(
    "@bolt-foundry/gambit-core"
  );
  const noModelProvider = {
    chat: () => {
      throw new Error(
        "MCP action deck execution cannot invoke model-backed decks.",
      );
    },
  };
  const modelProvider = shouldAllowModelBackedDecks()
    ? createMcpModelProvider()
    : noModelProvider;
  const deckPath = input.actionToDeck.get(input.name);
  if (!deckPath) {
    if (input.externalToolNames.has(input.name)) {
      return {
        isError: true,
        text: JSON.stringify({
          status: 400,
          message: "unsupported_external_tool",
          tool: input.name,
        }),
      };
    }
    return {
      isError: true,
      text: JSON.stringify({
        status: 404,
        message: `unknown tool "${input.name}"`,
      }),
    };
  }
  if (input.name === "policy_search") {
    const record = asRecord(input.args);
    if (
      typeof record.changeSummary !== "string" &&
      typeof record.query === "string"
    ) {
      record.changeSummary = record.query;
      delete record.query;
      input = { ...input, args: record };
    }
  }
  try {
    const result = await runDeck({
      path: deckPath,
      input: input.args,
      inputProvided: true,
      modelProvider,
      isRoot: false,
    });

    const payload = isGambitEndSignal(result) ? result.payload : result;
    const record = asRecord(payload);
    const status = typeof record.status === "number" ? record.status : 200;
    const isError = status >= 400;
    return {
      isError,
      text: JSON.stringify(payload, null, 2),
    };
  } catch (err) {
    return {
      isError: true,
      text: JSON.stringify({
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const method = typeof request.method === "string" ? request.method : "";
  const params = asRecord(request.params);

  if (!method) {
    if (request.id === undefined) return null;
    return toRpcError(id, -32600, "Invalid Request: missing method");
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "initialize") {
    if (request.id === undefined) return null;
    return toRpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "gambit-action-mcp",
        version: "0.1.0",
      },
    });
  }

  if (method === "ping") {
    if (request.id === undefined) return null;
    return toRpcResult(id, {});
  }

  if (method === "tools/list") {
    if (request.id === undefined) return null;
    try {
      const toolCatalog = await resolveToolCatalog();
      return toRpcResult(id, { tools: toolCatalog.tools });
    } catch (err) {
      return toRpcError(
        id,
        -32000,
        "MCP tool catalog unavailable",
        { message: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  if (method === "tools/call") {
    if (request.id === undefined) return null;
    try {
      const toolCatalog = await resolveToolCatalog();
      const toolName = typeof params.name === "string" ? params.name : "";
      const args = asRecord(params.arguments);
      const toolResult = await runActionTool({
        name: toolName,
        args,
        actionToDeck: toolCatalog.actionToDeck,
        externalToolNames: toolCatalog.externalToolNames,
      });
      return toRpcResult(id, {
        content: [{ type: "text", text: toolResult.text }],
        isError: toolResult.isError,
      });
    } catch (err) {
      return toRpcError(
        id,
        -32000,
        "MCP tool catalog unavailable",
        { message: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  if (method === "resources/list") {
    if (request.id === undefined) return null;
    return toRpcResult(id, { resources: [] });
  }

  if (method === "resources/templates/list") {
    if (request.id === undefined) return null;
    return toRpcResult(id, { resourceTemplates: [] });
  }

  if (request.id === undefined) return null;
  return toRpcError(id, -32601, `Method not found: ${method}`);
}

export async function runMcpServerLoop(): Promise<void> {
  const lineStream = Deno.stdin.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());
  for await (const line of lineStream) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const request = JSON.parse(trimmed) as JsonRpcRequest;
      const response = await handleMcpRequest(request);
      if (response) {
        await writeJsonRpcResponse(response);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const response = toRpcError(null, -32700, "Parse error", { message });
      await writeJsonRpcResponse(response);
    }
  }
}

if (import.meta.main) {
  await runMcpServerLoop();
}
