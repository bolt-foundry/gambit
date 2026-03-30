import * as path from "@std/path";
import { assert } from "@std/assert";

export function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "..", "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

export type GraphqlEnvelope<TData> = {
  data?: TData;
  errors?: Array<{ message?: string }>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseJsonRecord(
  response: Response,
): Promise<Record<string, unknown>> {
  const json = await response.json();
  assert(isRecord(json));
  return json;
}

export async function parseGraphqlEnvelope<TData>(
  response: Response,
): Promise<GraphqlEnvelope<TData>> {
  const json = await parseJsonRecord(response);
  return {
    data: json.data as TData | undefined,
    errors: Array.isArray(json.errors)
      ? json.errors.map((entry) =>
        isRecord(entry) && typeof entry.message === "string"
          ? { message: entry.message }
          : {}
      )
      : undefined,
  };
}

export async function gql<TData>(
  port: number,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphqlEnvelope<TData>> {
  const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(response.statusText);
  }
  return await parseGraphqlEnvelope<TData>(response);
}

export async function createWorkspace(port: number): Promise<string> {
  const createWorkspace = await gql<{
    gambitWorkspaceCreate?: { workspace?: { id?: string } };
  }>(
    port,
    `
      mutation {
        gambitWorkspaceCreate {
          workspace { id }
        }
      }
    `,
  );
  const workspaceId =
    createWorkspace.data?.gambitWorkspaceCreate?.workspace?.id ?? "";
  if (workspaceId.length === 0) {
    throw new Error("missing workspaceId");
  }
  return workspaceId;
}

export async function createBuildRun(args: {
  port: number;
  workspaceId: string;
  message: string;
}): Promise<{ runId: string; status?: string }> {
  const response = await gql<{
    workspaceBuildRunCreate?: {
      run?: { id?: string; status?: string };
    };
  }>(
    args.port,
    `
      mutation Build($workspaceId: ID!, $message: String!) {
        workspaceBuildRunCreate(input: {
          workspaceId: $workspaceId
          inputItems: [{ role: "user", content: $message }]
        }) {
          run { id status }
        }
      }
    `,
    {
      workspaceId: args.workspaceId,
      message: args.message,
    },
  );
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    throw new Error(response.errors[0]?.message ?? "GraphQL build failed");
  }
  const runId = response.data?.workspaceBuildRunCreate?.run?.id ?? "";
  if (runId.length === 0) {
    throw new Error("missing build run id");
  }
  return {
    runId,
    status: response.data?.workspaceBuildRunCreate?.run?.status,
  };
}

export async function startScenarioSession(args: {
  port: number;
  workspaceId: string;
  scenarioDeckId?: string;
  sessionId?: string;
  message?: string;
}): Promise<{ sessionId: string; runId: string; status?: string }> {
  const response = await gql<{
    workspaceConversationSessionStart?: {
      session?: {
        sessionId?: string;
        status?: string;
        run?: { id?: string };
      };
    };
  }>(
    args.port,
    `
      mutation StartScenario($input: WorkspaceConversationSessionStartInput!) {
        workspaceConversationSessionStart(input: $input) {
          session {
            sessionId
            status
            ... on WorkspaceScenarioConversationSession {
              run { id }
            }
          }
        }
      }
    `,
    {
      input: {
        workspaceId: args.workspaceId,
        kind: "scenario",
        sessionId: args.sessionId ?? null,
        scenarioDeckId: args.scenarioDeckId ?? null,
        inputItems: typeof args.message === "string"
          ? [{ role: "user", content: args.message }]
          : [],
      },
    },
  );
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    throw new Error(
      response.errors[0]?.message ?? "GraphQL scenario start failed",
    );
  }
  const sessionId =
    response.data?.workspaceConversationSessionStart?.session?.sessionId ?? "";
  if (sessionId.length === 0) {
    throw new Error("missing scenario sessionId");
  }
  return {
    sessionId,
    runId: response.data?.workspaceConversationSessionStart?.session?.run?.id ??
      sessionId,
    status: response.data?.workspaceConversationSessionStart?.session?.status,
  };
}

export async function sendScenarioSession(args: {
  port: number;
  workspaceId: string;
  sessionId: string;
  message: string;
}): Promise<{ sessionId: string; runId: string; status?: string }> {
  const response = await gql<{
    workspaceConversationSessionSend?: {
      session?: {
        sessionId?: string;
        status?: string;
        run?: { id?: string };
      };
    };
  }>(
    args.port,
    `
      mutation SendScenario($input: WorkspaceConversationSessionSendInput!) {
        workspaceConversationSessionSend(input: $input) {
          session {
            sessionId
            status
            ... on WorkspaceScenarioConversationSession {
              run { id }
            }
          }
        }
      }
    `,
    {
      input: {
        workspaceId: args.workspaceId,
        kind: "scenario",
        sessionId: args.sessionId,
        inputItems: [{ role: "user", content: args.message }],
      },
    },
  );
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    throw new Error(
      response.errors[0]?.message ?? "GraphQL scenario send failed",
    );
  }
  const sessionId =
    response.data?.workspaceConversationSessionSend?.session?.sessionId ?? "";
  if (sessionId.length === 0) {
    throw new Error("missing scenario sessionId");
  }
  return {
    sessionId,
    runId: response.data?.workspaceConversationSessionSend?.session?.run?.id ??
      sessionId,
    status: response.data?.workspaceConversationSessionSend?.session?.status,
  };
}

export async function startScenarioConversation(args: {
  port: number;
  workspaceId?: string;
  message: string;
}): Promise<{ workspaceId: string; sessionId: string }> {
  const workspaceId = args.workspaceId ?? await createWorkspace(args.port);
  const started = await startScenarioSession({
    port: args.port,
    workspaceId,
  });
  const sent = await sendScenarioSession({
    port: args.port,
    workspaceId,
    sessionId: started.sessionId,
    message: args.message,
  });
  return { workspaceId, sessionId: sent.sessionId };
}

export async function runSimulator(
  port: number,
  payload: Record<string, unknown>,
): Promise<{ runId?: string; workspaceId?: string }> {
  const explicitWorkspaceId = typeof payload.workspaceId === "string"
    ? payload.workspaceId
    : "";
  const workspaceId = explicitWorkspaceId || await createWorkspace(port);
  if (workspaceId.length === 0) {
    throw new Error("missing workspaceId");
  }

  const message =
    typeof payload.message === "string" && payload.message.length > 0
      ? payload.message
      : typeof payload.input === "string"
      ? payload.input
      : "";
  const started = await startScenarioSession({ port, workspaceId });
  const sent = await sendScenarioSession({
    port,
    workspaceId,
    sessionId: started.sessionId,
    message,
  });
  return {
    workspaceId,
    runId: sent.runId,
  };
}

export async function readDurableStreamEvents(
  port: number,
  streamId: string,
  offset = 0,
) {
  let res = await fetch(
    `http://127.0.0.1:${port}/graphql/streams/${streamId}?offset=${offset}`,
  );
  if (!res.ok && res.status === 404) {
    // Backward compatibility for legacy paths.
    res = await fetch(
      `http://127.0.0.1:${port}/api/durable-streams/stream/${streamId}?offset=${offset}`,
    );
  }
  if (!res.ok) {
    throw new Error(res.statusText);
  }
  const body = await res.json() as {
    events?: Array<{ offset?: number; data?: unknown }>;
  };
  return body.events ?? [];
}

export async function readStreamEvents(port: number, offset = 0) {
  try {
    return await readDurableStreamEvents(port, "gambit-simulator", offset);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes("not found")) {
      throw err;
    }
    return await readDurableStreamEvents(port, "gambit-workspace", offset);
  }
}

export async function readJsonLines(filePath: string): Promise<Array<unknown>> {
  const text = await Deno.readTextFile(filePath);
  return text.split("\n").filter((line) => line.trim().length > 0).map((line) =>
    JSON.parse(line)
  );
}
