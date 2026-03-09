import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { DatabaseSync } from "node:sqlite";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider, SavedState } from "@bolt-foundry/gambit-core";
import { modImportPath, readJsonLines } from "./server_test_utils.ts";

type GraphqlEnvelope<TData> = {
  data?: TData;
  errors?: Array<{ message?: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function tcpPortOf(addr: Deno.Addr): number {
  assert(addr.transport === "tcp");
  return addr.port;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for predicate");
}

async function parseJsonRecord(
  response: Response,
): Promise<Record<string, unknown>> {
  const json = await response.json();
  assert(isRecord(json));
  return json;
}

async function parseGraphqlEnvelope<TData>(
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

const leakTolerantTest = (name: string, fn: () => Promise<void> | void) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

leakTolerantTest("/graphql serves GraphiQL via Yoga", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "graphql-graphiql.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider: ModelProvider = {
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  try {
    const port = tcpPortOf(server.addr);
    const res = await fetch(`http://127.0.0.1:${port}/graphql`, {
      headers: { accept: "text/html" },
    });
    assertEquals(res.status, 200);
    const contentType = res.headers.get("content-type") ?? "";
    assert(contentType.includes("text/html"));
    const body = await res.text();
    assert(body.toLowerCase().includes("graphiql"));
  } finally {
    await server.shutdown();
    await server.finished;
  }
});

leakTolerantTest(
  "/graphql exposes typed gambit fields and removes proxy fields",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-typed.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);

      const typedRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
          query {
            gambitWorkspaces(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        `,
        }),
      });
      assertEquals(typedRes.status, 200);
      const typedBody = await parseGraphqlEnvelope<{
        gambitWorkspaces?: {
          edges?: Array<{ node?: { id?: string } }>;
        };
      }>(
        typedRes,
      );
      assertEquals(Array.isArray(typedBody.errors), false);
      assertEquals(
        Array.isArray(typedBody.data?.gambitWorkspaces?.edges),
        true,
      );

      const unknownFieldRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `query { apiGet(path: \"/deprecated\") { status } }`,
        }),
      });
      assertEquals(unknownFieldRes.status, 200);
      const unknownFieldBody = await parseGraphqlEnvelope<unknown>(
        unknownFieldRes,
      );
      assertEquals(Array.isArray(unknownFieldBody.errors), true);
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql workspace conversation sessions lifecycle supports build/scenario/grader/verify kinds",
  async () => {
    const dir = await Deno.makeTempDir();
    const deckPath = path.join(dir, "graphql-conversation-sessions.deck.md");
    const scenarioDeckPath = path.join(
      dir,
      "scenarios",
      "default",
      "PROMPT.md",
    );
    const graderDeckPath = path.join(dir, "graders", "default", "PROMPT.md");
    await Deno.mkdir(path.dirname(scenarioDeckPath), { recursive: true });
    await Deno.mkdir(path.dirname(graderDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `+++
[contextSchema]
schema = "gambit://schemas/contexts/conversation.zod.ts"

[responseSchema]
schema = "gambit://schemas/responses/assistant_message.zod.ts"

[modelParams]
model = ["dummy-model"]

[[scenarios]]
id = "default-scenario"
path = "./scenarios/default/PROMPT.md"
label = "Default scenario"

[[graders]]
id = "default-grader"
path = "./graders/default/PROMPT.md"
label = "Default grader"
+++
Conversation session test root deck.
`,
    );
    await Deno.writeTextFile(
      scenarioDeckPath,
      `+++
label = "Default scenario"
contextSchema = "gambit://schemas/contexts/conversation.zod.ts"
responseSchema = "gambit://schemas/responses/assistant_message.zod.ts"

[modelParams]
model = ["dummy-model"]
+++
Scenario assistant.
`,
    );
    await Deno.writeTextFile(
      graderDeckPath,
      `+++
label = "Default grader"
contextSchema = "gambit://schemas/graders/contexts/conversation.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"

[modelParams]
model = ["dummy-model"]
+++
Return JSON score/reason.
`,
    );

    const provider: ModelProvider = {
      chat(input) {
        const lastUser = [...input.messages].reverse().find((message) =>
          message?.role === "user"
        );
        const prompt = typeof lastUser?.content === "string"
          ? lastUser.content
          : JSON.stringify(lastUser?.content ?? "");
        return Promise.resolve({
          message: prompt.includes("grade")
            ? {
              role: "assistant",
              content: JSON.stringify({ score: 1, reason: "ok" }),
            }
            : { role: "assistant", content: `assistant:${prompt}` },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);
      const gql = async <TData>(query: string, variables?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        assertEquals(response.status, 200);
        return await parseGraphqlEnvelope<TData>(response);
      };

      const createWorkspace = await gql<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(
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
      assert(workspaceId.length > 0);

      const scenarioStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            __typename?: string;
            sessionId?: string;
            status?: string;
          };
        };
      }>(
        `
          mutation StartScenario($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                __typename
                sessionId
                status
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            scenarioDeckId: "default-scenario",
          },
        },
      );
      const scenarioSessionId =
        scenarioStart.data?.workspaceConversationSessionStart?.session
          ?.sessionId ?? "";
      assert(scenarioSessionId.length > 0);
      assertEquals(
        scenarioStart.data?.workspaceConversationSessionStart?.session
          ?.__typename,
        "WorkspaceScenarioConversationSession",
      );

      const scenarioSend = await gql<{
        workspaceConversationSessionSend?: {
          session?: {
            sessionId?: string;
            status?: string;
            run?: {
              id?: string;
              openResponses?: {
                edges?: Array<{
                  node?: {
                    outputItems?: {
                      edges?: Array<{
                        node?: {
                          __typename?: string;
                          role?: string;
                          content?: string;
                        };
                      }>;
                    };
                  };
                }>;
              };
            };
          };
        };
      }>(
        `
          mutation SendScenario($input: WorkspaceConversationSessionSendInput!) {
            workspaceConversationSessionSend(input: $input) {
              session {
                sessionId
                status
                ... on WorkspaceScenarioConversationSession {
                  run {
                    openResponses(first: 1) {
                      edges {
                        node {
                          outputItems(first: 50) {
                            edges {
                              node {
                                __typename
                                ... on OutputMessage {
                                  role
                                  content
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            sessionId: scenarioSessionId,
            inputItems: [{ role: "user", content: "scenario message" }],
          },
        },
      );
      assertEquals(
        scenarioSend.data?.workspaceConversationSessionSend?.session?.sessionId,
        scenarioSessionId,
      );
      const emptyScenarioSend = await gql<{
        workspaceConversationSessionSend?: {
          session?: { sessionId?: string; status?: string };
        };
      }>(
        `
          mutation SendScenarioEmpty($input: WorkspaceConversationSessionSendInput!) {
            workspaceConversationSessionSend(input: $input) {
              session {
                sessionId
                status
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            sessionId: scenarioSessionId,
            inputItems: [{ role: "user", content: "   " }],
          },
        },
      );
      assertEquals(
        emptyScenarioSend.data?.workspaceConversationSessionSend?.session
          ?.sessionId,
        scenarioSessionId,
      );

      const createEmptyBuildWorkspace = await gql<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(
        `
          mutation {
            gambitWorkspaceCreate {
              workspace { id }
            }
          }
        `,
      );
      const emptyBuildWorkspaceId =
        createEmptyBuildWorkspace.data?.gambitWorkspaceCreate?.workspace?.id ??
          "";
      assert(emptyBuildWorkspaceId.length > 0);

      const emptyBuildStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            __typename?: string;
            sessionId?: string;
            status?: string;
          };
        };
      }>(
        `
          mutation StartEmptyBuild($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                __typename
                sessionId
                status
              }
            }
          }
        `,
        {
          input: {
            workspaceId: emptyBuildWorkspaceId,
            kind: "build",
          },
        },
      );
      const emptyBuildSessionId =
        emptyBuildStart.data?.workspaceConversationSessionStart?.session
          ?.sessionId ?? "";
      assert(emptyBuildSessionId.length > 0);
      assertEquals(
        emptyBuildStart.data?.workspaceConversationSessionStart?.session
          ?.__typename,
        "WorkspaceBuildConversationSession",
      );
      assertEquals(
        emptyBuildStart.data?.workspaceConversationSessionStart?.session
          ?.status,
        "RUNNING",
      );

      const buildStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            __typename?: string;
            sessionId?: string;
            status?: string;
          };
        };
      }>(
        `
          mutation StartBuild($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                __typename
                sessionId
                status
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "build",
            inputItems: [{ role: "user", content: "build message" }],
          },
        },
      );
      const buildSessionId =
        buildStart.data?.workspaceConversationSessionStart?.session
          ?.sessionId ??
          "";
      assert(buildSessionId.length > 0);
      assertEquals(
        buildStart.data?.workspaceConversationSessionStart?.session?.__typename,
        "WorkspaceBuildConversationSession",
      );

      const querySessions = await gql<{
        workspace?: {
          conversationSessions?: {
            edges?: Array<{
              node?: {
                sessionId?: string;
                __typename?: string;
              };
            }>;
          };
          conversationSession?: {
            sessionId?: string;
            __typename?: string;
          };
        } | null;
      }>(
        `
          query Sessions($workspaceId: ID!, $buildSessionId: ID!) {
            workspace(id: $workspaceId) {
              conversationSessions(first: 25) {
                edges {
                  node {
                    __typename
                    sessionId
                  }
                }
              }
              conversationSession(sessionId: $buildSessionId) {
                __typename
                sessionId
              }
            }
          }
        `,
        { workspaceId, buildSessionId },
      );
      const sessionTypeNames =
        (querySessions.data?.workspace?.conversationSessions
          ?.edges ?? [])
          .map((edge) => edge?.node?.__typename ?? null)
          .filter((typename): typename is string =>
            typeof typename === "string"
          );
      assertEquals(
        sessionTypeNames.includes("WorkspaceScenarioConversationSession"),
        true,
      );
      assertEquals(
        sessionTypeNames.includes("WorkspaceBuildConversationSession"),
        true,
      );
      assertEquals(
        querySessions.data?.workspace?.conversationSession?.sessionId,
        buildSessionId,
      );
      assertEquals(
        querySessions.data?.workspace?.conversationSession?.__typename,
        "WorkspaceBuildConversationSession",
      );

      const graderStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: { sessionId?: string; __typename?: string };
        };
      }>(
        `
          mutation StartGrader($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                __typename
                sessionId
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "grader",
            graderId: "default-grader",
            scenarioRunId: scenarioSessionId,
          },
        },
      );
      assertEquals(
        graderStart.data?.workspaceConversationSessionStart?.session
          ?.__typename,
        "WorkspaceGraderConversationSession",
      );

      const verifyStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: { sessionId?: string; __typename?: string };
        };
      }>(
        `
          mutation StartVerify($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                __typename
                sessionId
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "verify",
            graderId: "default-grader",
            scenarioDeckId: "root",
            scenarioRuns: 1,
            graderRepeatsPerScenario: 1,
            concurrency: 1,
          },
        },
      );
      assertEquals(
        verifyStart.data?.workspaceConversationSessionStart?.session
          ?.__typename,
        "WorkspaceVerifyConversationSession",
      );

      const scenarioStop = await gql<{
        workspaceConversationSessionStop?: {
          session?: { sessionId?: string; status?: string };
        };
      }>(
        `
          mutation StopScenario($input: WorkspaceConversationSessionStopInput!) {
            workspaceConversationSessionStop(input: $input) {
              session {
                sessionId
                status
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            sessionId: scenarioSessionId,
          },
        },
      );
      assertEquals(
        scenarioStop.data?.workspaceConversationSessionStop?.session?.sessionId,
        scenarioSessionId,
      );
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql openResponse.outputItems resolves persisted canonical events for build and scenario runs",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const deckPath = path.join(
      dir,
      "graphql-openresponse-output-items.deck.ts",
    );
    const scenarioDeckPath = path.join(dir, "scenarios", "default.deck.ts");
    await Deno.mkdir(path.dirname(scenarioDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      contextSchema: z.string().optional(),
      responseSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{
        id: "default-scenario",
        path: "./scenarios/default.deck.ts",
        label: "Default scenario",
        maxTurns: 1,
      }],
    });
    `,
    );
    await Deno.writeTextFile(
      scenarioDeckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      contextSchema: z.string().optional(),
      responseSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });

    try {
      const port = tcpPortOf(server.addr);
      const gql = async <TData>(query: string, variables?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        assertEquals(response.status, 200);
        return await parseGraphqlEnvelope<TData>(response);
      };

      const created = await gql<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(
        `
          mutation {
            gambitWorkspaceCreate {
              workspace { id }
            }
          }
        `,
      );
      const workspaceId = created.data?.gambitWorkspaceCreate?.workspace?.id ??
        "";
      assert(workspaceId.length > 0);

      const scenarioStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            sessionId?: string;
            run?: { id?: string };
          };
        };
      }>(
        `
          mutation StartScenario($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                sessionId
                ... on WorkspaceScenarioConversationSession {
                  run { id }
                }
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            scenarioDeckId: "default-scenario",
          },
        },
      );
      const scenarioRunId =
        scenarioStart.data?.workspaceConversationSessionStart?.session?.run
          ?.id ?? "";
      assert(scenarioRunId.length > 0);
      const buildStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            run?: { id?: string };
          };
        };
      }>(
        `
          mutation StartBuild($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                ... on WorkspaceBuildConversationSession {
                  run { id }
                }
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "build",
            inputItems: [{ role: "user", content: "seed build state" }],
          },
        },
      );
      const buildRunId =
        buildStart.data?.workspaceConversationSessionStart?.session?.run?.id ??
          "";
      assert(buildRunId.length > 0);
      const buildRunsSnapshot = await gql<{
        workspace?: {
          buildRuns?: {
            edges?: Array<{ node?: { id?: string } }>;
          };
        } | null;
      }>(
        `
          query BuildRunSnapshot($workspaceId: ID!) {
            workspace(id: $workspaceId) {
              buildRuns(first: 1) {
                edges {
                  node { id }
                }
              }
            }
          }
        `,
        { workspaceId },
      );
      const canonicalBuildRunId = buildRunsSnapshot.data?.workspace?.buildRuns
        ?.edges?.[0]?.node?.id ?? buildRunId;
      assert(canonicalBuildRunId.length > 0);

      const eventsPath = path.join(sessionsDir, workspaceId, "events.jsonl");
      const createdAt = new Date().toISOString();
      await Deno.writeTextFile(
        eventsPath,
        [
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: canonicalBuildRunId,
            sequence: 0,
            event_type: "input.item",
            payload: {
              type: "input.item",
              role: "user",
              content: [{ type: "input_text", text: "build user canonical" }],
            },
            idempotency_key: `${canonicalBuildRunId}:seed:build:input`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          }),
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: canonicalBuildRunId,
            sequence: 1,
            event_type: "response.output_item.done",
            payload: {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "build canonical" }],
              },
            },
            idempotency_key: `${canonicalBuildRunId}:seed:build:0`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          }),
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: canonicalBuildRunId,
            sequence: 2,
            event_type: "response.reasoning.done",
            payload: {
              type: "response.reasoning.done",
              output_index: 1,
              item_id: "build-reasoning-done-1",
              content_index: 0,
              text: "build deep reasoning",
            },
            idempotency_key: `${canonicalBuildRunId}:seed:build:reasoning`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          }),
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: canonicalBuildRunId,
            sequence: 3,
            event_type: "response.output_item.done",
            payload: {
              type: "response.output_item.done",
              output_index: 2,
              item: {
                type: "function_call",
                call_id: "build-call-1",
                name: "lookup",
                arguments: '{"query":"a"}',
              },
            },
            idempotency_key: `${canonicalBuildRunId}:seed:build:1`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          }),
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: canonicalBuildRunId,
            sequence: 4,
            event_type: "response.output_item.done",
            payload: {
              type: "response.output_item.done",
              output_index: 3,
              item: {
                type: "function_call_output",
                call_id: "build-call-1",
                output: "lookup-result",
              },
            },
            idempotency_key: `${canonicalBuildRunId}:seed:build:2`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          }),
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: canonicalBuildRunId,
            sequence: 5,
            event_type: "response.reasoning_summary_part.added",
            payload: {
              type: "response.reasoning_summary_part.added",
              output_index: 4,
              item_id: "build-reasoning-1",
              summary_index: 0,
              part: { type: "summary_text", text: "build reasoning" },
            },
            idempotency_key: `${canonicalBuildRunId}:seed:build:3`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          }),
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: scenarioRunId,
            sequence: 0,
            event_type: "input.item",
            payload: {
              type: "input.item",
              role: "user",
              content: [{
                type: "input_text",
                text: "scenario user canonical",
              }],
            },
            idempotency_key: `${scenarioRunId}:seed:scenario:input`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          }),
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: scenarioRunId,
            sequence: 1,
            event_type: "response.output_item.done",
            payload: {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "scenario canonical" }],
              },
            },
            idempotency_key: `${scenarioRunId}:seed:scenario:0`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          }),
        ].join("\n") + "\n",
        { append: true },
      );

      const queried = await gql<{
        workspace?: {
          buildRuns?: {
            edges?: Array<{
              node?: {
                id?: string;
                openResponses?: {
                  edges?: Array<{
                    node?: {
                      outputItems?: {
                        edges?: Array<{
                          node?: {
                            __typename?: string;
                            role?: string;
                            content?: string;
                            asOutputMessage?: {
                              role?: string;
                              content?: string;
                            };
                          };
                        }>;
                      };
                    };
                  }>;
                };
              };
            }>;
          };
          scenarioRuns?: {
            edges?: Array<{
              node?: {
                id?: string;
                openResponses?: {
                  edges?: Array<{
                    node?: {
                      outputItems?: {
                        edges?: Array<{
                          node?: {
                            __typename?: string;
                            asOutputMessage?: {
                              role?: string;
                              content?: string;
                            };
                          };
                        }>;
                      };
                    };
                  }>;
                };
              };
            }>;
          };
        } | null;
      }>(
        `
          query OutputItems($workspaceId: ID!) {
            workspace(id: $workspaceId) {
              buildRuns(first: 1) {
                edges {
                  node {
                    id
                    openResponses(first: 1) {
                      edges {
                        node {
                          outputItems(first: 10) {
                            edges {
                              node {
                                __typename
                                ... on OutputMessage {
                                  role
                                  content
                                }
                                ... on OutputToolCall {
                                  toolCallId
                                  toolName
                                  status
                                  resultText
                                }
                                ... on OutputReasoning {
                                  id
                                  summary
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
              scenarioRuns(first: 10) {
                edges {
                  node {
                    id
                    openResponses(first: 1) {
                      edges {
                        node {
                          outputItems(first: 10) {
                            edges {
                              node {
                                __typename
                                ... on OutputMessage {
                                  role
                                  content
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        { workspaceId },
      );

      const buildOutputEdges = queried.data?.workspace?.buildRuns?.edges?.[0]
        ?.node?.openResponses?.edges?.[0]?.node?.outputItems?.edges ?? [];
      const buildMessages = buildOutputEdges.flatMap((edge) => {
        const node = asRecord(edge?.node);
        if (!node) return [];
        const role = typeof node.role === "string" ? node.role : "";
        const content = typeof node.content === "string" ? node.content : "";
        if (!role || !content) return [];
        return [{ role, content }];
      });
      const buildMessageContents = buildMessages.map((entry) => entry.content);
      assert(buildMessageContents.includes("build user canonical"));
      assert(buildMessageContents.includes("build canonical"));
      assert(!buildMessageContents.includes("seed build state"));
      assertEquals(buildMessages[0], {
        role: "user",
        content: "build user canonical",
      });
      const buildToolCall = buildOutputEdges.find((edge) =>
        asRecord(edge?.node)?.__typename === "OutputToolCall"
      );
      assertEquals(
        asRecord(buildToolCall?.node)?.resultText,
        "lookup-result",
      );
      const buildReasoningSummary = buildOutputEdges
        .filter((edge) =>
          asRecord(edge?.node)?.__typename === "OutputReasoning"
        )
        .map((edge) => asRecord(edge?.node)?.summary)
        .filter((entry): entry is string => typeof entry === "string");
      assert(buildReasoningSummary.includes("build deep reasoning"));
      assert(buildReasoningSummary.includes("build reasoning"));

      const scenarioEdge = queried.data?.workspace?.scenarioRuns?.edges?.find((
        edge,
      ) => edge?.node?.id === scenarioRunId);
      const scenarioOutputEdges = scenarioEdge?.node?.openResponses?.edges?.[0]
        ?.node?.outputItems?.edges ?? [];
      const scenarioMessages = scenarioOutputEdges.flatMap((edge) => {
        const node = asRecord(edge?.node);
        if (!node) return [];
        const role = typeof node.role === "string" ? node.role : "";
        const content = typeof node.content === "string" ? node.content : "";
        if (!role || !content) return [];
        return [{ role, content }];
      });
      const scenarioMessageContents = scenarioMessages.map((entry) =>
        entry.content
      );
      assert(scenarioMessageContents.includes("scenario user canonical"));
      assert(scenarioMessageContents.includes("scenario canonical"));
      assertEquals(scenarioMessages[0], {
        role: "user",
        content: "scenario user canonical",
      });
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql build sessions keep canonical openResponses isolated from scenario runs",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-build-authority.deck.ts");
    const scenarioDeckPath = path.join(dir, "scenarios", "default.deck.ts");
    await Deno.mkdir(path.dirname(scenarioDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{
        id: "default-scenario",
        path: "./scenarios/default.deck.ts",
        label: "Default scenario",
        maxTurns: 2,
      }],
    });
    `,
    );
    await Deno.writeTextFile(
      scenarioDeckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat(input) {
        const runId = input.state?.runId ?? "unknown-run";
        const updatedState: SavedState = {
          runId,
          messages: [
            ...(input.state?.messages ?? []),
            { role: "assistant", content: `assistant reply for ${runId}` },
          ],
          traces: input.state?.traces ?? [],
          meta: input.state?.meta,
        };
        input.onStreamEvent?.({
          type: "response.created",
          response: {
            id: `resp-${runId}`,
            object: "response",
            output: [],
            status: "in_progress",
          },
        });
        input.onStreamEvent?.({
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            role: "assistant",
            content: [{
              type: "output_text",
              text: `assistant reply for ${runId}`,
            }],
          },
        });
        input.onStreamEvent?.({
          type: "response.completed",
          response: {
            id: `resp-${runId}`,
            object: "response",
            output: [],
            status: "completed",
          },
        });
        return Promise.resolve({
          message: {
            role: "assistant",
            content: `assistant reply for ${runId}`,
          },
          finishReason: "stop",
          updatedState,
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });

    try {
      const port = tcpPortOf(server.addr);
      const gql = async <TData>(query: string, variables?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        assertEquals(response.status, 200);
        return await parseGraphqlEnvelope<TData>(response);
      };

      const created = await gql<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(
        `
          mutation {
            gambitWorkspaceCreate {
              workspace { id }
            }
          }
        `,
      );
      const workspaceId = created.data?.gambitWorkspaceCreate?.workspace?.id ??
        "";
      assert(workspaceId.length > 0);

      const scenarioStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            sessionId?: string;
            status?: string;
            run?: { id?: string };
          };
        };
      }>(
        `
          mutation StartScenario($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                sessionId
                ... on WorkspaceScenarioConversationSession {
                  status
                  run { id }
                }
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            scenarioDeckId: "default-scenario",
          },
        },
      );
      const scenarioSessionId =
        scenarioStart.data?.workspaceConversationSessionStart?.session
          ?.sessionId ?? "";
      const scenarioRunId =
        scenarioStart.data?.workspaceConversationSessionStart?.session?.run
          ?.id ?? "";
      assert(scenarioSessionId.length > 0);
      assert(scenarioRunId.length > 0);

      await waitFor(async () => {
        const statusBody = await gql<{
          workspace?: {
            conversationSession?: { status?: string };
          } | null;
        }>(
          `
            query ScenarioStatus($workspaceId: ID!, $sessionId: ID!) {
              workspace(id: $workspaceId) {
                conversationSession(sessionId: $sessionId) {
                  ... on WorkspaceScenarioConversationSession {
                    status
                  }
                }
              }
            }
          `,
          { workspaceId, sessionId: scenarioSessionId },
        );
        const status = statusBody.data?.workspace?.conversationSession?.status;
        return status !== "running";
      }, 5_000);

      await gql<{
        workspaceConversationSessionSend?: {
          session?: { sessionId?: string };
        };
      }>(
        `
          mutation SendScenario($input: WorkspaceConversationSessionSendInput!) {
            workspaceConversationSessionSend(input: $input) {
              session {
                sessionId
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            sessionId: scenarioSessionId,
            inputItems: [{ role: "user", content: "scenario seed" }],
          },
        },
      );

      const buildStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            sessionId?: string;
            status?: string;
            run?: { id?: string };
          };
        };
      }>(
        `
          mutation StartBuild($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                sessionId
                ... on WorkspaceBuildConversationSession {
                  status
                  run { id }
                }
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "build",
            inputItems: [{ role: "user", content: "build seed" }],
          },
        },
      );
      const buildSessionId = buildStart.data?.workspaceConversationSessionStart
        ?.session?.sessionId ?? "";
      const buildRunId =
        buildStart.data?.workspaceConversationSessionStart?.session?.run?.id ??
          "";
      assert(buildSessionId.length > 0);
      assert(buildRunId.length > 0);

      await waitFor(async () => {
        const statusBody = await gql<{
          workspace?: {
            conversationSession?: { status?: string };
          } | null;
        }>(
          `
            query BuildStatus($workspaceId: ID!, $sessionId: ID!) {
              workspace(id: $workspaceId) {
                conversationSession(sessionId: $sessionId) {
                  ... on WorkspaceBuildConversationSession {
                    status
                  }
                }
              }
            }
          `,
          { workspaceId, sessionId: buildSessionId },
        );
        const status = statusBody.data?.workspace?.conversationSession?.status;
        return status !== "running";
      }, 5_000);

      const readOpenResponses = async () =>
        await gql<{
          workspace?: {
            buildRuns?: {
              edges?: Array<{
                node?: {
                  id?: string;
                  openResponses?: {
                    edges?: Array<{
                      node?: {
                        events?: {
                          edges?: Array<{ node?: { type?: string } }>;
                        };
                        outputItems?: {
                          edges?: Array<{
                            node?: {
                              __typename?: string;
                              role?: string;
                              content?: string;
                            };
                          }>;
                        };
                      };
                    }>;
                  };
                };
              }>;
            };
            scenarioRuns?: {
              edges?: Array<{
                node?: {
                  id?: string;
                  openResponses?: {
                    edges?: Array<{
                      node?: {
                        outputItems?: {
                          edges?: Array<{
                            node?: {
                              __typename?: string;
                              role?: string;
                              content?: string;
                            };
                          }>;
                        };
                      };
                    }>;
                  };
                };
              }>;
            };
          } | null;
        }>(
          `
            query BuildScenarioOpenResponses($workspaceId: ID!) {
              workspace(id: $workspaceId) {
                buildRuns(first: 1) {
                  edges {
                    node {
                      id
                      openResponses(first: 1) {
                        edges {
                          node {
                            events(first: 20) {
                              edges {
                                node {
                                  type
                                }
                              }
                            }
                            outputItems(first: 20) {
                              edges {
                                node {
                                  __typename
                                  ... on OutputMessage {
                                    role
                                    content
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
                scenarioRuns(first: 10) {
                  edges {
                    node {
                      id
                      openResponses(first: 1) {
                        edges {
                          node {
                            outputItems(first: 20) {
                              edges {
                                node {
                                  __typename
                                  ... on OutputMessage {
                                    role
                                    content
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          { workspaceId },
        );

      await waitFor(async () => {
        const queried = await readOpenResponses();
        const buildEdge = queried.data?.workspace?.buildRuns?.edges?.[0];
        const buildEventTypes =
          buildEdge?.node?.openResponses?.edges?.[0]?.node?.events?.edges
            ?.map((edge) => edge?.node?.type ?? "")
            .filter((type) => type.length > 0) ?? [];
        const buildMessages =
          buildEdge?.node?.openResponses?.edges?.[0]?.node?.outputItems?.edges
            ?.map((edge) => edge?.node)
            .filter((node) => node?.__typename === "OutputMessage")
            .map((node) => ({
              role: node?.role ?? "",
              content: node?.content ?? "",
            })) ?? [];
        return buildEventTypes.includes("input.item") &&
          buildEventTypes.some((type) => type.startsWith("response.")) &&
          buildMessages.some((msg) =>
            msg.role === "user" && msg.content === "build seed"
          ) &&
          buildMessages.some((msg) =>
            msg.role === "assistant" &&
            msg.content.includes(`assistant reply for ${buildRunId}`)
          );
      }, 5_000);

      const queried = await readOpenResponses();
      const buildEdge = queried.data?.workspace?.buildRuns?.edges?.[0];
      assertEquals(buildEdge?.node?.id, buildRunId);
      const buildEventTypes =
        buildEdge?.node?.openResponses?.edges?.[0]?.node?.events?.edges
          ?.map((edge) => edge?.node?.type ?? "")
          .filter((type) => type.length > 0) ?? [];
      assert(buildEventTypes.includes("input.item"));
      assert(buildEventTypes.some((type) => type.startsWith("response.")));
      const buildMessages =
        buildEdge?.node?.openResponses?.edges?.[0]?.node?.outputItems?.edges
          ?.map((edge) => edge?.node)
          .filter((node) => node?.__typename === "OutputMessage")
          .map((node) => ({
            role: node?.role ?? "",
            content: node?.content ?? "",
          })) ?? [];
      assert(
        buildMessages.some((msg) =>
          msg.role === "user" && msg.content === "build seed"
        ),
      );
      assert(
        buildMessages.some((msg) =>
          msg.role === "assistant" &&
          msg.content.includes(`assistant reply for ${buildRunId}`)
        ),
      );

      const scenarioEdge = queried.data?.workspace?.scenarioRuns?.edges?.find(
        (edge) => edge?.node?.id === scenarioRunId,
      );
      const scenarioMessages =
        scenarioEdge?.node?.openResponses?.edges?.[0]?.node?.outputItems?.edges
          ?.map((edge) => edge?.node)
          .filter((node) => node?.__typename === "OutputMessage")
          .map((node) => ({
            role: node?.role ?? "",
            content: node?.content ?? "",
          })) ?? [];
      assert(scenarioMessages.length > 0);
      assert(
        !scenarioMessages.some((msg) =>
          msg.content.includes(`assistant reply for ${buildRunId}`)
        ),
      );
      assert(!scenarioMessages.some((msg) => msg.content === "build seed"));
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql openResponse.events replays persisted typed run-event records",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-openresponse-events.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });

    try {
      const port = tcpPortOf(server.addr);
      const gql = async <TData>(query: string, variables?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        assertEquals(response.status, 200);
        return await parseGraphqlEnvelope<TData>(response);
      };

      const created = await gql<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(
        `
          mutation {
            gambitWorkspaceCreate {
              workspace { id }
            }
          }
        `,
      );
      const workspaceId = created.data?.gambitWorkspaceCreate?.workspace?.id ??
        "";
      assert(workspaceId.length > 0);

      const started = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            __typename?: string;
            sessionId?: string;
            run?: { id?: string };
          };
        };
      }>(
        `
          mutation StartBuild($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                __typename
                sessionId
                ... on WorkspaceBuildConversationSession {
                  run { id }
                }
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "build",
            inputItems: [{ role: "user", content: "hello" }],
          },
        },
      );
      const runId = started.data?.workspaceConversationSessionStart?.session
        ?.run?.id ?? "";
      assert(runId.length > 0);
      const sessionId =
        started.data?.workspaceConversationSessionStart?.session?.sessionId ??
          "";
      assert(sessionId.length > 0);

      const statusDeadline = Date.now() + 5_000;
      let terminal = false;
      while (!terminal && Date.now() < statusDeadline) {
        const statusBody = await gql<{
          workspace?: {
            conversationSession?: {
              __typename?: string;
              status?: string;
            };
          } | null;
        }>(
          `
            query BuildStatus($workspaceId: ID!, $sessionId: ID!) {
              workspace(id: $workspaceId) {
                conversationSession(sessionId: $sessionId) {
                  __typename
                  ... on WorkspaceBuildConversationSession {
                    status
                  }
                }
              }
            }
          `,
          { workspaceId, sessionId },
        );
        const status =
          statusBody.data?.workspace?.conversationSession?.status ?? "IDLE";
        terminal = status !== "RUNNING";
        if (!terminal) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }

      const eventsPath = path.join(sessionsDir, workspaceId, "events.jsonl");
      const existing = await readJsonLines(eventsPath) as Array<
        Record<string, unknown>
      >;
      assert(existing.length >= 0);
      await waitFor(async () => {
        const records = await readJsonLines(eventsPath) as Array<
          Record<string, unknown>
        >;
        return records.some((record) =>
          record.run_id === runId && record.event_type === "input.item"
        );
      }, 5_000);
      const createdAt = new Date().toISOString();
      const injected = [
        {
          type: "gambit.openresponses.run_event",
          workspace_id: workspaceId,
          run_id: runId,
          sequence: 100,
          event_type: "response.reasoning_summary_text.delta",
          payload: {
            type: "response.reasoning_summary_text.delta",
            delta: "thinking",
          },
          idempotency_key: `${runId}:seed:100`,
          created_at: createdAt,
          _gambit: {
            kind: "openresponses.run_event.v0",
            domain: "session",
          },
        },
        {
          type: "gambit.openresponses.run_event",
          workspace_id: workspaceId,
          run_id: runId,
          sequence: 101,
          event_type: "response.output_item.done",
          payload: {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "function_call",
              call_id: "call-1",
              name: "lookup",
              arguments: "{}",
            },
          },
          idempotency_key: `${runId}:seed:101`,
          created_at: createdAt,
          _gambit: {
            kind: "openresponses.run_event.v0",
            domain: "session",
          },
        },
      ];
      await Deno.writeTextFile(
        eventsPath,
        injected.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
        { append: true },
      );

      const queried = await gql<{
        workspace?: {
          conversationSession?: {
            __typename?: string;
            run?: {
              id?: string;
              openResponses?: {
                edges?: Array<{
                  node?: {
                    events?: {
                      edges?: Array<{
                        node?: {
                          type?: string;
                          data?: Record<string, unknown>;
                        };
                      }>;
                    };
                  };
                }>;
              };
            };
          };
        } | null;
      }>(
        `
          query OpenResponseEvents($workspaceId: ID!, $sessionId: ID!) {
            workspace(id: $workspaceId) {
              conversationSession(sessionId: $sessionId) {
                __typename
                ... on WorkspaceBuildConversationSession {
                  run {
                    id
                    openResponses(first: 1) {
                      edges {
                        node {
                          events(first: 20) {
                            edges {
                              node {
                                type
                                data
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        {
          workspaceId,
          sessionId,
        },
      );
      const eventNodes = queried.data?.workspace?.conversationSession?.run
        ?.openResponses?.edges?.[0]?.node?.events?.edges?.map((edge) =>
          edge?.node
        ).filter((
          node,
        ): node is { type?: string; data?: Record<string, unknown> } =>
          !!node
        ) ?? [];
      assertEquals(
        eventNodes.map((node) => node.type),
        [
          "input.item",
          "response.reasoning_summary_text.delta",
          "response.output_item.done",
        ],
      );
      assertEquals(eventNodes[0]?.data?.type, "input.item");
      assertEquals(
        eventNodes[1]?.data?.type,
        "response.reasoning_summary_text.delta",
      );
      assertEquals(eventNodes[2]?.data?.type, "response.output_item.done");
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql workspaceOpenResponseEventsLive replays and streams canonical run events",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-openresponse-live.deck.ts");
    const scenarioDeckPath = path.join(dir, "scenarios", "default.deck.ts");
    await Deno.mkdir(path.dirname(scenarioDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      contextSchema: z.string().optional(),
      responseSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{
        id: "default-scenario",
        path: "./scenarios/default.deck.ts",
        label: "Default scenario",
        maxTurns: 2,
      }],
    });
    `,
    );
    await Deno.writeTextFile(
      scenarioDeckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      contextSchema: z.string().optional(),
      responseSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });

    try {
      const port = tcpPortOf(server.addr);
      const gql = async <TData>(query: string, variables?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        assertEquals(response.status, 200);
        return await parseGraphqlEnvelope<TData>(response);
      };

      const created = await gql<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(
        `
          mutation {
            gambitWorkspaceCreate {
              workspace { id }
            }
          }
        `,
      );
      const workspaceId = created.data?.gambitWorkspaceCreate?.workspace?.id ??
        "";
      assert(workspaceId.length > 0);
      const scenarioStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            sessionId?: string;
            run?: { id?: string };
          };
        };
      }>(
        `
          mutation StartScenario($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                sessionId
                ... on WorkspaceScenarioConversationSession {
                  run { id }
                }
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            scenarioDeckId: "default-scenario",
          },
        },
      );
      const scenarioSessionId =
        scenarioStart.data?.workspaceConversationSessionStart?.session
          ?.sessionId ?? "";
      assert(scenarioSessionId.length > 0);
      const runId = scenarioStart.data?.workspaceConversationSessionStart
        ?.session?.run?.id ?? "";
      assert(runId.length > 0);

      const eventsPath = path.join(sessionsDir, workspaceId, "events.jsonl");
      const createdAt = new Date().toISOString();
      await Deno.writeTextFile(
        eventsPath,
        `${
          JSON.stringify({
            type: "gambit.openresponses.run_event",
            workspace_id: workspaceId,
            run_id: runId,
            sequence: 0,
            event_type: "response.output_item.done",
            payload: {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "live replay seed" }],
              },
            },
            idempotency_key: `${runId}:seed:live:0`,
            created_at: createdAt,
            _gambit: {
              kind: "openresponses.run_event.v0",
              domain: "session",
            },
          })
        }\n`,
        { append: true },
      );

      const sessionId = `workspace-openresponse-live-${crypto.randomUUID()}`;
      const subscribeRes = await fetch(
        `http://127.0.0.1:${port}/graphql/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "subscribe",
            sessionId,
            subscriptionId: "sub-openresponse-live",
            operationName: "OpenResponseLive",
            variables: { workspaceId, runId, fromSequence: 0 },
            query: `
              subscription OpenResponseLive(
                $workspaceId: ID!
                $runId: ID!
                $fromSequence: Int
              ) {
                workspaceOpenResponseEventsLive(
                  workspaceId: $workspaceId
                  runId: $runId
                  fromSequence: $fromSequence
                ) {
                  sourceSequence
                  occurredAt
                  event {
                    type
                    data
                  }
                }
              }
            `,
          }),
        },
      );
      if (subscribeRes.status !== 202) {
        throw new Error(
          `Expected subscribe status 202, got ${subscribeRes.status}: ${await subscribeRes
            .text()}`,
        );
      }
      await subscribeRes.body?.cancel();

      await gql<{
        workspaceConversationSessionSend?: {
          session?: { sessionId?: string };
        };
      }>(
        `
          mutation SendScenario($input: WorkspaceConversationSessionSendInput!) {
            workspaceConversationSessionSend(input: $input) {
              session {
                sessionId
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            sessionId: scenarioSessionId,
            inputItems: [{ role: "user", content: "trigger live event" }],
          },
        },
      );

      const sessionStreamId = `graphql-subscriptions:${sessionId}`;
      const deadline = Date.now() + 5_000;
      let nextEvents: Array<Record<string, unknown>> = [];
      while (Date.now() < deadline) {
        const replayRes = await gql<{
          gambitDurableStreamReplay?: {
            events?: Array<{ data?: Record<string, unknown> }>;
          };
        }>(
          `
            query SessionReplay($streamId: ID!) {
              gambitDurableStreamReplay(streamId: $streamId, fromOffset: 0) {
                events {
                  data
                }
              }
            }
          `,
          { streamId: sessionStreamId },
        );
        const events = replayRes.data?.gambitDurableStreamReplay?.events ?? [];
        nextEvents = events
          .map((event) => asRecord(event.data))
          .filter((event): event is Record<string, unknown> => !!event)
          .filter((event) => event.type === "next");
        if (nextEvents.length >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert(nextEvents.length >= 1);
      const payloads = nextEvents.map((event) => asRecord(event.payload))
        .filter((payload): payload is Record<string, unknown> => !!payload)
        .map((payload) => asRecord(payload.workspaceOpenResponseEventsLive))
        .filter((payload): payload is Record<string, unknown> => !!payload);
      const sequenceValues = payloads.map((payload) => payload.sourceSequence)
        .filter((value): value is number => typeof value === "number");
      assert(sequenceValues.includes(0));
      const eventTypes = payloads.map((payload) => asRecord(payload.event))
        .filter((event): event is Record<string, unknown> => !!event)
        .map((event) => event.type)
        .filter((value): value is string => typeof value === "string");
      assert(eventTypes.some((eventType) => eventType.startsWith("response.")));

      const closeRes = await fetch(`http://127.0.0.1:${port}/graphql/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", sessionId }),
      });
      assertEquals(closeRes.status, 200);
      await closeRes.body?.cancel();
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql scenario conversation sessions expose canonical output items",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-scenario-order.deck.ts");
    const scenarioDeckPath = path.join(
      dir,
      "scenarios",
      "assistant-first",
      "PROMPT.deck.ts",
    );
    await Deno.mkdir(path.dirname(scenarioDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `
      import { defineDeck } from "${modHref}";
      import { z } from "zod";

      export default defineDeck({
        inputSchema: z.string().optional(),
        outputSchema: z.string().optional(),
        modelParams: { model: "dummy-model" },
        testDecks: [{
          id: "assistant-first",
          path: "./scenarios/assistant-first/PROMPT.deck.ts",
          label: "Assistant First",
          maxTurns: 1,
        }],
      });
`,
    );
    await Deno.writeTextFile(
      scenarioDeckPath,
      `
      import { defineDeck } from "${modHref}";
      import { z } from "zod";

      export default defineDeck({
        startMode: "assistant",
        inputSchema: z.string().optional(),
        outputSchema: z.string().optional(),
        modelParams: { model: "dummy-model" },
      });
`,
    );

    const provider: ModelProvider = {
      chat(input) {
        const lastUser = [...input.messages].reverse().find((message) =>
          message?.role === "user"
        );
        const prompt = typeof lastUser?.content === "string"
          ? lastUser.content
          : "";
        return Promise.resolve({
          message: {
            role: "assistant",
            content: prompt === "how are you"
              ? "Fine. What do you need?"
              : "Ready.",
          },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);
      const gql = async <TData>(
        query: string,
        variables?: Record<string, unknown>,
      ): Promise<GraphqlEnvelope<TData>> => {
        const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        assertEquals(response.status, 200);
        return await parseGraphqlEnvelope<TData>(response);
      };

      const createWorkspace = await gql<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(
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
      assert(workspaceId.length > 0);

      const scenarioStart = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            sessionId?: string;
            status?: string;
          };
        };
      }>(
        `
          mutation StartScenario($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                sessionId
                status
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            scenarioDeckId: "assistant-first",
          },
        },
      );
      const scenarioSessionId =
        scenarioStart.data?.workspaceConversationSessionStart?.session
          ?.sessionId ?? "";
      assert(scenarioSessionId.length > 0);

      await gql<{
        workspaceConversationSessionSend?: {
          session?: { sessionId?: string };
        };
      }>(
        `
          mutation SendScenario($input: WorkspaceConversationSessionSendInput!) {
            workspaceConversationSessionSend(input: $input) {
              session {
                sessionId
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            sessionId: scenarioSessionId,
            inputItems: [{ role: "user", content: "how are you" }],
          },
        },
      );

      let messages: Array<{ role: string; content: string }> = [];
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await gql<{
          workspace?: {
            conversationSession?: {
              __typename?: string;
              run?: {
                openResponses?: {
                  edges?: Array<{
                    node?: {
                      outputItems?: {
                        edges?: Array<{
                          node?: {
                            __typename?: string;
                            role?: string;
                            content?: string;
                          };
                        }>;
                      };
                    };
                  }>;
                };
              };
            } | null;
          } | null;
        }>(
          `
            query ScenarioOutputItems($workspaceId: ID!, $sessionId: ID!) {
              workspace(id: $workspaceId) {
                conversationSession(sessionId: $sessionId) {
                  __typename
                  ... on WorkspaceScenarioConversationSession {
                    run {
                      ... on WorkspaceScenarioRun {
                        openResponses(first: 10) {
                          edges {
                            node {
                              outputItems(first: 50) {
                                edges {
                                  node {
                                    __typename
                                    ... on OutputMessage {
                                      role
                                      content
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          { workspaceId, sessionId: scenarioSessionId },
        );
        messages = (
          response.data?.workspace?.conversationSession?.run?.openResponses
            ?.edges ??
            []
        ).flatMap((edge) => {
          const outputEdges = edge?.node?.outputItems?.edges ?? [];
          return outputEdges.flatMap((outputEdge) => {
            const node = outputEdge?.node;
            if (node?.__typename !== "OutputMessage") return [];
            return [{ role: node.role ?? "", content: node.content ?? "" }];
          });
        });
        if (messages.some((message) => message.content === "how are you")) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const userPromptIndex = messages.findIndex((message) =>
        message.role === "user" && message.content === "how are you"
      );
      assert(userPromptIndex >= 0);
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql scenario runs persist chat-only transcripts into openresponses projection",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-scenario-openresponses.deck.ts");
    const scenarioDeckPath = path.join(
      dir,
      "scenarios",
      "assistant-first.deck.ts",
    );
    await Deno.mkdir(path.dirname(scenarioDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `
      import { defineDeck } from "${modHref}";
      import { z } from "zod";

      export default defineDeck({
        inputSchema: z.string().optional(),
        outputSchema: z.string().optional(),
        modelParams: { model: "dummy-model" },
        testDecks: [{
          id: "assistant-first",
          path: "./scenarios/assistant-first.deck.ts",
          label: "Assistant first",
          maxTurns: 1,
        }],
      });
`,
    );
    await Deno.writeTextFile(
      scenarioDeckPath,
      `
      import { defineDeck } from "${modHref}";
      import { z } from "zod";

      export default defineDeck({
        startMode: "assistant",
        inputSchema: z.string().optional(),
        outputSchema: z.string().optional(),
        modelParams: { model: "dummy-model" },
      });
`,
    );

    const provider: ModelProvider = {
      chat(input) {
        const lastUser = [...input.messages].reverse().find((message) =>
          message?.role === "user"
        );
        const prompt = typeof lastUser?.content === "string"
          ? lastUser.content
          : "";
        return Promise.resolve({
          message: {
            role: "assistant",
            content: prompt === "how are you"
              ? "Fine. What do you need?"
              : "Ready.",
          },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });

    try {
      const port = tcpPortOf(server.addr);
      const gql = async <TData>(
        query: string,
        variables?: Record<string, unknown>,
      ): Promise<GraphqlEnvelope<TData>> => {
        const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        assertEquals(response.status, 200);
        return await parseGraphqlEnvelope<TData>(response);
      };

      const createWorkspace = await gql<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(
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
      assert(workspaceId.length > 0);

      const start = await gql<{
        workspaceConversationSessionStart?: {
          session?: {
            sessionId?: string;
            status?: string;
          };
        };
      }>(
        `
          mutation StartScenario($input: WorkspaceConversationSessionStartInput!) {
            workspaceConversationSessionStart(input: $input) {
              session {
                sessionId
                status
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            scenarioDeckId: "assistant-first",
          },
        },
      );
      const scenarioRunId =
        start.data?.workspaceConversationSessionStart?.session?.sessionId ?? "";
      assert(scenarioRunId.length > 0);

      const statePath = path.join(sessionsDir, workspaceId, "state.json");
      const sqlitePath = path.join(
        sessionsDir,
        workspaceId,
        "workspace.sqlite",
      );
      const readOutputRows = () => {
        const db = new DatabaseSync(sqlitePath);
        try {
          return db.prepare(`
            SELECT role, content
            FROM openresponses_output_items_v0
            WHERE workspace_id = ? AND run_id = ?
            ORDER BY sequence ASC, output_index ASC, item_key ASC
          `).all(workspaceId, scenarioRunId) as Array<{
            role: string | null;
            content: string | null;
          }>;
        } finally {
          db.close();
        }
      };
      const readRunEventCount = () => {
        const db = new DatabaseSync(sqlitePath);
        try {
          const row = db.prepare(`
            SELECT COUNT(*) AS count
            FROM openresponses_run_events_v0
            WHERE workspace_id = ? AND run_id = ?
          `).get(workspaceId, scenarioRunId) as { count?: number };
          return row.count ?? 0;
        } finally {
          db.close();
        }
      };

      await waitFor(async () => {
        const state = JSON.parse(await Deno.readTextFile(statePath)) as {
          meta?: { scenarioRunId?: string };
          messages?: Array<{ role?: string; content?: unknown }>;
        };
        const assistantMessages = (state.messages ?? []).filter((message) =>
          message.role === "assistant"
        );
        return state.meta?.scenarioRunId === scenarioRunId &&
          assistantMessages.some((message) => message.content === "Ready.");
      }, 5_000);

      await waitFor(() => {
        try {
          return readOutputRows().some((row) =>
            row.role === "assistant" && row.content === "Ready."
          );
        } catch {
          return false;
        }
      }, 5_000);

      await gql<{
        workspaceConversationSessionSend?: {
          session?: { sessionId?: string };
        };
      }>(
        `
          mutation SendScenario($input: WorkspaceConversationSessionSendInput!) {
            workspaceConversationSessionSend(input: $input) {
              session {
                sessionId
              }
            }
          }
        `,
        {
          input: {
            workspaceId,
            kind: "scenario",
            sessionId: scenarioRunId,
            inputItems: [{ role: "user", content: "how are you" }],
          },
        },
      );

      await waitFor(async () => {
        const state = JSON.parse(await Deno.readTextFile(statePath)) as {
          messages?: Array<{ role?: string; content?: unknown }>;
        };
        const messages = state.messages ?? [];
        return messages.some((message) =>
          message.role === "user" && message.content === "how are you"
        ) &&
          messages.some((message) =>
            message.role === "assistant" &&
            message.content === "Fine. What do you need?"
          );
      }, 5_000);

      await waitFor(() => {
        try {
          const rows = readOutputRows();
          const contents = rows.map((row) => row.content ?? "");
          return contents.includes("Ready.") &&
            contents.includes("how are you") &&
            contents.includes("Fine. What do you need?");
        } catch {
          return false;
        }
      }, 5_000);

      const outputRows = readOutputRows();
      assert(
        outputRows.some((row) =>
          row.role === "assistant" && row.content === "Ready."
        ),
      );
      assert(
        outputRows.some((row) =>
          row.role === "user" && row.content === "how are you"
        ),
      );
      assert(
        outputRows.some((row) =>
          row.role === "assistant" &&
          row.content === "Fine. What do you need?"
        ),
      );
      assert(readRunEventCount() > 0);

      const queried = await gql<{
        workspace?: {
          scenarioRuns?: {
            edges?: Array<{
              node?: {
                id?: string;
                openResponses?: {
                  edges?: Array<{
                    node?: {
                      outputItems?: {
                        edges?: Array<{
                          node?: {
                            __typename?: string;
                            role?: string;
                            content?: string;
                          };
                        }>;
                      };
                    };
                  }>;
                };
              };
            }>;
          };
        } | null;
      }>(
        `
          query ScenarioRuns($workspaceId: ID!) {
            workspace(id: $workspaceId) {
              scenarioRuns(first: 10) {
                edges {
                  node {
                    id
                    openResponses(first: 1) {
                      edges {
                        node {
                          outputItems(first: 50) {
                            edges {
                              node {
                                __typename
                                ... on OutputMessage {
                                  role
                                  content
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        { workspaceId },
      );

      const scenarioEdge = queried.data?.workspace?.scenarioRuns?.edges?.find(
        (edge) => edge?.node?.id === scenarioRunId,
      );
      const scenarioMessages =
        scenarioEdge?.node?.openResponses?.edges?.[0]?.node?.outputItems?.edges
          ?.map((edge) => edge?.node)
          .filter((node) => node?.__typename === "OutputMessage")
          .map((node) => ({
            role: node?.role ?? "",
            content: node?.content ?? "",
          })) ?? [];
      assert(
        scenarioMessages.some((message) =>
          message.role === "assistant" && message.content === "Ready."
        ),
      );
      assert(
        scenarioMessages.some((message) =>
          message.role === "user" && message.content === "how are you"
        ),
      );
      assert(
        scenarioMessages.some((message) =>
          message.role === "assistant" &&
          message.content === "Fine. What do you need?"
        ),
      );
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql verify tab mutation creates typed batch payload",
  async () => {
    const dir = await Deno.makeTempDir();
    const deckPath = path.join(dir, "graphql-verify-tab.deck.md");
    const scenarioDeckPath = path.join(
      dir,
      "scenarios",
      "default",
      "PROMPT.md",
    );
    const graderDeckPath = path.join(dir, "graders", "default", "PROMPT.md");
    await Deno.mkdir(path.dirname(scenarioDeckPath), { recursive: true });
    await Deno.mkdir(path.dirname(graderDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `+++
[contextSchema]
schema = "gambit://schemas/contexts/conversation.zod.ts"

[responseSchema]
schema = "gambit://schemas/responses/assistant_message.zod.ts"

[modelParams]
model = ["dummy-model"]

[[scenarios]]
id = "default-scenario"
path = "./scenarios/default/PROMPT.md"
label = "Default scenario"
maxTurns = 1

[[graders]]
id = "default-grader"
path = "./graders/default/PROMPT.md"
label = "Default grader"
+++
Verify test.
`,
    );
    await Deno.writeTextFile(
      scenarioDeckPath,
      `+++
[modelParams]
model = ["dummy-model"]
+++
Respond with a short user prompt.
`,
    );
    await Deno.writeTextFile(
      graderDeckPath,
      `+++
label = "Default grader"
contextSchema = "gambit://schemas/graders/contexts/conversation.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"

[modelParams]
model = ["dummy-model"]
+++
Return score and reason.
`,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: {
            role: "assistant",
            content: JSON.stringify({ score: 1, reason: "Looks good." }),
          },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);
      const createWorkspaceRes = await fetch(
        `http://127.0.0.1:${port}/graphql`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
            mutation WorkspaceCreate {
              gambitWorkspaceCreate {
                workspace { id }
              }
            }
          `,
          }),
        },
      );
      const createWorkspaceBody = await parseGraphqlEnvelope<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(createWorkspaceRes);
      const workspaceId = createWorkspaceBody.data?.gambitWorkspaceCreate
        ?.workspace?.id ?? "";
      assert(workspaceId.length > 0);

      const verifyRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
            mutation VerifyBatch($input: WorkspaceVerifyBatchRunCreateInput!) {
              workspaceVerifyBatchRunCreate(input: $input) {
                batch {
                  id
                  status
                  scenarioDeckId
                  scenarioRuns
                  graderRepeatsPerScenario
                  scenarioRunsCompleted
                  scenarioRunsFailed
                  requested
                  active
                  completed
                  failed
                  requests(first: 200) {
                    edges {
                      node {
                        id
                        scenarioRunId
                        status
                        runId
                        error
                      }
                    }
                  }
                  metrics {
                    scenarioRunCountRequested
                    scenarioRunCountCompleted
                    gradeSampleCountRequested
                    gradeSampleCountCompleted
                    executionFailureCount
                    gradingFailureCount
                    passRate
                  }
                }
                workspace {
                  id
                  verification {
                    batches(first: 10) {
                      edges {
                        node {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            input: {
              workspaceId,
              scenarioDeckId: "default-scenario",
              graderId: "default-grader",
              scenarioRuns: 2,
              graderRepeatsPerScenario: 2,
              concurrency: 1,
            },
          },
        }),
      });
      const verifyBody = await parseGraphqlEnvelope<{
        workspaceVerifyBatchRunCreate?: {
          batch?: {
            id?: string;
            status?: string;
            scenarioDeckId?: string | null;
            scenarioRuns?: number;
            graderRepeatsPerScenario?: number;
            scenarioRunsCompleted?: number;
            scenarioRunsFailed?: number;
            requested?: number;
            active?: number;
            completed?: number;
            failed?: number;
            requests?: {
              edges?: Array<{
                node?: {
                  id?: string;
                  scenarioRunId?: string | null;
                  status?: string;
                  runId?: string | null;
                  error?: string | null;
                };
              }>;
            };
            metrics?: {
              scenarioRunCountRequested?: number;
              scenarioRunCountCompleted?: number;
              gradeSampleCountRequested?: number;
              gradeSampleCountCompleted?: number;
              executionFailureCount?: number;
              gradingFailureCount?: number;
              passRate?: number | null;
            } | null;
          };
          workspace?: {
            verification?: {
              batches?: {
                edges?: Array<{ node?: { id?: string } }>;
              };
            };
          };
        };
      }>(verifyRes);
      assertEquals(Array.isArray(verifyBody.errors), false);
      const batchId =
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch?.id ??
          "";
      assert(batchId.length > 0);
      assertEquals(
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch?.scenarioDeckId,
        "default-scenario",
      );
      assertEquals(
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch?.requested,
        4,
      );
      assertEquals(
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch?.scenarioRuns,
        2,
      );
      assertEquals(
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch
          ?.graderRepeatsPerScenario,
        2,
      );
      const scenarioRunsCompleted =
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch
          ?.scenarioRunsCompleted ?? 0;
      const scenarioRunsFailed =
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch
          ?.scenarioRunsFailed ?? 0;
      assertEquals(scenarioRunsCompleted + scenarioRunsFailed, 2);
      assertEquals(scenarioRunsFailed, 0);
      const requestNodes =
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch?.requests?.edges
          ?.map((edge) => edge?.node)
          .filter((node): node is {
            id?: string;
            error?: string | null;
            status?: string;
          } => Boolean(node)) ?? [];
      assertEquals(requestNodes.length, 4);
      const statuses = requestNodes.map((request) => request.status ?? "");
      assert(
        statuses.every((status) =>
          status === "COMPLETED" || status === "ERROR"
        ),
      );
      assert(
        requestNodes.every((request) =>
          (request.error ?? "").trim() !==
            "Scenario run ended with status running"
        ),
      );
      const latestBatchId =
        verifyBody.data?.workspaceVerifyBatchRunCreate?.workspace?.verification
          ?.batches?.edges?.[0]?.node?.id ?? "";
      assertEquals(latestBatchId, batchId);
      const metrics = verifyBody.data?.workspaceVerifyBatchRunCreate?.batch
        ?.metrics;
      if (metrics) {
        assertEquals(typeof metrics.scenarioRunCountRequested, "number");
        assertEquals(typeof metrics.gradeSampleCountRequested, "number");
        assertEquals(typeof metrics.executionFailureCount, "number");
      }
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql workspaceVerifyLive clamps stale fromOffset and still streams new events",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-workspace-verify-live.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);

      const createWorkspace = async (): Promise<string> => {
        const res = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
            mutation WorkspaceCreate {
              gambitWorkspaceCreate {
                workspace { id }
              }
            }
          `,
          }),
        });
        const body = await parseGraphqlEnvelope<{
          gambitWorkspaceCreate?: { workspace?: { id?: string } };
        }>(res);
        const id = body.data?.gambitWorkspaceCreate?.workspace?.id ?? "";
        assert(id.length > 0);
        return id;
      };

      const workspaceId = await createWorkspace();
      const sessionId = `workspace-verify-live-${crypto.randomUUID()}`;
      const staleFromOffset = 1_000_000;

      const subscribeRes = await fetch(
        `http://127.0.0.1:${port}/graphql/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "subscribe",
            sessionId,
            subscriptionId: "sub-verify-live",
            operationName: "VerifyLive",
            variables: { workspaceId, fromOffset: staleFromOffset },
            query: `
            subscription VerifyLive($workspaceId: ID!, $fromOffset: Int) {
              workspaceVerifyLive(workspaceId: $workspaceId, fromOffset: $fromOffset) {
                sourceOffset
                occurredAt
                node {
                  id
                }
              }
            }
          `,
          }),
        },
      );
      if (subscribeRes.status !== 202) {
        throw new Error(
          `Expected subscribe status 202, got ${subscribeRes.status}: ${await subscribeRes
            .text()}`,
        );
      }
      await subscribeRes.body?.cancel();

      const appendRes = await fetch(
        `http://127.0.0.1:${port}/graphql/streams/gambit-workspace`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([
            {
              type: "gambit.verify.batch",
              workspaceId,
              batch: {
                id: "verify-batch-1",
                status: "running",
              },
            },
          ]),
        },
      );
      assertEquals(appendRes.status, 204);
      await appendRes.body?.cancel();

      const sessionStreamId = `graphql-subscriptions:${sessionId}`;
      const deadline = Date.now() + 5_000;
      let nextEvents: Array<Record<string, unknown>> = [];
      while (Date.now() < deadline && nextEvents.length === 0) {
        const replayRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
            query SessionReplay($streamId: ID!) {
              gambitDurableStreamReplay(streamId: $streamId, fromOffset: 0) {
                events {
                  data
                }
              }
            }
          `,
            variables: { streamId: sessionStreamId },
          }),
        });
        const replayBody = await parseGraphqlEnvelope<{
          gambitDurableStreamReplay?: {
            events?: Array<{ data?: Record<string, unknown> }>;
          };
        }>(replayRes);
        const events = replayBody.data?.gambitDurableStreamReplay?.events ?? [];
        nextEvents = events
          .map((event) => asRecord(event.data))
          .filter((event): event is Record<string, unknown> => !!event)
          .filter((event) => event.type === "next");
        if (nextEvents.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assertEquals(nextEvents.length, 1);
      const firstPayload = asRecord(nextEvents[0]?.payload);
      const verifyLive = firstPayload
        ? asRecord(firstPayload.workspaceVerifyLive)
        : null;
      assert(verifyLive);
      assertEquals(typeof verifyLive.sourceOffset, "number");
      assertEquals(typeof verifyLive.occurredAt, "string");
      const node = asRecord(verifyLive.node);
      assert(node);
      assertEquals(node.id, workspaceId);

      const closeRes = await fetch(`http://127.0.0.1:${port}/graphql/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", sessionId }),
      });
      assertEquals(closeRes.status, 200);
      await closeRes.body?.cancel();
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql durable replay query matches stream append ordering",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-stream-replay.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);
      const streamId = "graphql-replay-test";

      const appendRes = await fetch(
        `http://127.0.0.1:${port}/graphql/streams/${streamId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([
            { type: "gambit.test.a", value: "a" },
            { type: "gambit.test.b", value: "b" },
          ]),
        },
      );
      assertEquals(appendRes.status, 204);

      const replayRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
          query Replay($streamId: ID!, $fromOffset: Int) {
            gambitDurableStreamReplay(streamId: $streamId, fromOffset: $fromOffset) {
              streamId
              fromOffset
              nextOffset
              events {
                offset
                type
              }
            }
          }
        `,
          variables: { streamId, fromOffset: 0 },
        }),
      });
      assertEquals(replayRes.status, 200);
      const replayBody = await parseGraphqlEnvelope<{
        gambitDurableStreamReplay?: {
          nextOffset?: number;
          events?: Array<{ offset?: number; type?: string }>;
        };
      }>(replayRes);
      assertEquals(Array.isArray(replayBody.errors), false);
      assertEquals(replayBody.data?.gambitDurableStreamReplay?.nextOffset, 2);
      assertEquals(
        replayBody.data?.gambitDurableStreamReplay?.events?.map((event) => ({
          offset: event.offset,
          type: event.type,
        })),
        [
          { offset: 0, type: "gambit.test.a" },
          { offset: 1, type: "gambit.test.b" },
        ],
      );
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest("/graphql/stream resumes after Last-Event-ID", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "graphql-stream-last-event-id.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider: ModelProvider = {
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  try {
    const port = tcpPortOf(server.addr);
    const sessionId = `resume-${crypto.randomUUID()}`;
    const sessionStreamId = `graphql-subscriptions:${sessionId}`;

    const appendRes = await fetch(
      `http://127.0.0.1:${port}/graphql/streams/${sessionStreamId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { type: "next", payload: { value: "a" } },
          { type: "next", payload: { value: "b" } },
          { type: "next", payload: { value: "c" } },
        ]),
      },
    );
    assertEquals(appendRes.status, 204);
    await appendRes.body?.cancel();

    const sseRes = await fetch(
      `http://127.0.0.1:${port}/graphql/stream?sessionId=${sessionId}`,
      {
        headers: {
          "last-event-id": "1",
        },
      },
    );
    assertEquals(sseRes.status, 200);

    const reader = sseRes.body?.getReader();
    assert(reader);

    const decoder = new TextDecoder();
    let buffer = "";
    let firstReplayEventId: number | null = null;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && firstReplayEventId === null) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0 && firstReplayEventId === null) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const idLine = frame.split("\n").find((line) =>
          line.startsWith("id: ")
        );
        if (idLine) {
          firstReplayEventId = Number(idLine.slice(4).trim());
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    await reader.cancel();

    assertEquals(firstReplayEventId, 2);
  } finally {
    await server.shutdown();
    await server.finished;
  }
});

leakTolerantTest(
  "/graphql workspace.files exposes metadata connection list",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-workspace-files.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);

      const workspaceRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
          mutation WorkspaceCreate {
            gambitWorkspaceCreate {
              workspace {
                id
              }
            }
          }
        `,
        }),
      });
      assertEquals(workspaceRes.status, 200);
      const workspaceEnvelope = await parseGraphqlEnvelope<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(workspaceRes);
      assertEquals(Array.isArray(workspaceEnvelope.errors), false);
      const workspaceId =
        workspaceEnvelope.data?.gambitWorkspaceCreate?.workspace
          ?.id ?? "";
      assert(workspaceId.length > 0);

      const listRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
          query WorkspaceFilesList($id: ID!) {
            workspace(id: $id) {
              id
              files(first: 1) {
                edges {
                  node {
                    id
                    path
                  }
                }
              }
              allFiles: files(first: 200) {
                edges {
                  node {
                    path
                  }
                }
              }
            }
          }
        `,
          variables: {
            id: workspaceId,
          },
        }),
      });
      assertEquals(listRes.status, 200);
      const listBody = await parseGraphqlEnvelope<{
        workspace?: {
          id?: string;
          files?: {
            edges?: Array<{ node?: { id?: string; path?: string } }>;
          };
          allFiles?: {
            edges?: Array<{ node?: { path?: string } }>;
          };
        };
      }>(listRes);
      assertEquals(Array.isArray(listBody.errors), false);
      assertEquals(listBody.data?.workspace?.id, workspaceId);
      const selectedId =
        listBody.data?.workspace?.files?.edges?.[0]?.node?.id ??
          "";
      assert(selectedId.length > 0);
      const selectedPath =
        listBody.data?.workspace?.files?.edges?.[0]?.node?.path ?? "";
      assert(selectedPath.length > 0);
      const allPaths = (listBody.data?.workspace?.allFiles?.edges ?? [])
        .map((edge) => edge?.node?.path ?? "")
        .filter((pathValue) => pathValue.length > 0);
      assertEquals(
        allPaths.some((pathValue) =>
          pathValue === ".gambit" || pathValue.startsWith(".gambit/")
        ),
        false,
      );

      const selectedRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
          query WorkspaceFilesSelected($id: ID!, $selectedId: ID!) {
            workspace(id: $id) {
              selected: files(first: 1, id: $selectedId) {
                edges {
                  node {
                    path
                    size
                    modifiedAt
                  }
                }
              }
            }
          }
        `,
          variables: { id: workspaceId, selectedId: selectedId },
        }),
      });
      assertEquals(selectedRes.status, 200);
      const selectedBody = await parseGraphqlEnvelope<{
        workspace?: {
          selected?: {
            edges?: Array<{
              node?: {
                path?: string;
                size?: number | null;
                modifiedAt?: string | null;
              };
            }>;
          };
        };
      }>(selectedRes);
      assertEquals(Array.isArray(selectedBody.errors), false);
      assertEquals(
        selectedBody.data?.workspace?.selected?.edges?.[0]?.node?.path,
        selectedPath,
      );
      assert(
        selectedBody.data?.workspace?.selected?.edges?.[0]?.node?.size !==
          undefined,
      );
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql workspaceBuildLive projects workspaceGraphRefresh with workspace scoping",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-workspace-live.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);

      const createWorkspace = async (): Promise<string> => {
        const res = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
            mutation WorkspaceCreate {
              gambitWorkspaceCreate {
                workspace { id }
              }
            }
          `,
          }),
        });
        const body = await parseGraphqlEnvelope<{
          gambitWorkspaceCreate?: { workspace?: { id?: string } };
        }>(res);
        const id = body.data?.gambitWorkspaceCreate?.workspace?.id ?? "";
        assert(id.length > 0);
        return id;
      };

      const targetWorkspaceId = await createWorkspace();
      const otherWorkspaceId = await createWorkspace();

      const replayOffsetRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
          query InitialOffset {
            gambitDurableStreamReplay(streamId: "gambit-workspace", fromOffset: 0) {
              nextOffset
            }
          }
        `,
        }),
      });
      const replayOffsetBody = await parseGraphqlEnvelope<{
        gambitDurableStreamReplay?: { nextOffset?: number };
      }>(replayOffsetRes);
      const fromOffset = replayOffsetBody.data?.gambitDurableStreamReplay
        ?.nextOffset ?? 0;

      const sessionId = `workspace-live-${crypto.randomUUID()}`;
      const subscribeRes = await fetch(
        `http://127.0.0.1:${port}/graphql/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "subscribe",
            sessionId,
            subscriptionId: "sub-1",
            operationName: "BuildLive",
            variables: { workspaceId: targetWorkspaceId, fromOffset },
            query: `
          subscription BuildLive($workspaceId: ID!, $fromOffset: Int) {
            workspaceBuildLive(workspaceId: $workspaceId, fromOffset: $fromOffset) {
              sourceOffset
              occurredAt
              node {
                id
              }
            }
          }
        `,
          }),
        },
      );
      if (subscribeRes.status !== 202) {
        throw new Error(
          `Expected subscribe status 202, got ${subscribeRes.status}: ${await subscribeRes
            .text()}`,
        );
      }
      await subscribeRes.body?.cancel();

      const appendRes = await fetch(
        `http://127.0.0.1:${port}/graphql/streams/gambit-workspace`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([
            { type: "gambit.ignore.me", workspaceId: targetWorkspaceId },
            { type: "workspaceGraphRefresh", workspaceId: otherWorkspaceId },
            {
              type: "workspaceGraphRefresh",
              workspaceId: targetWorkspaceId,
              reason: "fs-change",
              paths: ["PROMPT.md"],
              kinds: ["modify"],
            },
          ]),
        },
      );
      assertEquals(appendRes.status, 204);
      await appendRes.body?.cancel();

      const sessionStreamId = `graphql-subscriptions:${sessionId}`;
      const deadline = Date.now() + 5_000;
      let nextEvents: Array<Record<string, unknown>> = [];
      while (Date.now() < deadline && nextEvents.length === 0) {
        const replayRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
            query SessionReplay($streamId: ID!) {
              gambitDurableStreamReplay(streamId: $streamId, fromOffset: 0) {
                events {
                  data
                }
              }
            }
          `,
            variables: { streamId: sessionStreamId },
          }),
        });
        const replayBody = await parseGraphqlEnvelope<{
          gambitDurableStreamReplay?: {
            events?: Array<{ data?: Record<string, unknown> }>;
          };
        }>(replayRes);
        const events = replayBody.data?.gambitDurableStreamReplay?.events ?? [];
        nextEvents = events
          .map((event) => asRecord(event.data))
          .filter((event): event is Record<string, unknown> => !!event)
          .filter((event) => event.type === "next");
        if (nextEvents.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assertEquals(nextEvents.length, 1);

      const firstPayload = asRecord(nextEvents[0]?.payload);
      const buildLive = firstPayload
        ? asRecord(firstPayload.workspaceBuildLive)
        : null;
      assert(buildLive);
      assertEquals(typeof buildLive.sourceOffset, "number");
      assertEquals(typeof buildLive.occurredAt, "string");
      const node = asRecord(buildLive.node);
      assert(node);
      assertEquals(node.id, targetWorkspaceId);

      const closeRes = await fetch(`http://127.0.0.1:${port}/graphql/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", sessionId }),
      });
      assertEquals(closeRes.status, 200);
      await closeRes.body?.cancel();
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql workspaceTestLive clamps stale fromOffset and still streams new events",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "graphql-workspace-test-live.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);

      const createWorkspace = async (): Promise<string> => {
        const res = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
            mutation WorkspaceCreate {
              gambitWorkspaceCreate {
                workspace { id }
              }
            }
          `,
          }),
        });
        const body = await parseGraphqlEnvelope<{
          gambitWorkspaceCreate?: { workspace?: { id?: string } };
        }>(res);
        const id = body.data?.gambitWorkspaceCreate?.workspace?.id ?? "";
        assert(id.length > 0);
        return id;
      };

      const workspaceId = await createWorkspace();
      const sessionId = `workspace-test-live-${crypto.randomUUID()}`;
      const staleFromOffset = 1_000_000;

      const subscribeRes = await fetch(
        `http://127.0.0.1:${port}/graphql/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "subscribe",
            sessionId,
            subscriptionId: "sub-test-live",
            operationName: "TestLive",
            variables: { workspaceId, fromOffset: staleFromOffset },
            query: `
            subscription TestLive($workspaceId: ID!, $fromOffset: Int) {
              workspaceTestLive(workspaceId: $workspaceId, fromOffset: $fromOffset) {
                sourceOffset
                occurredAt
                node {
                  id
                }
              }
            }
          `,
          }),
        },
      );
      if (subscribeRes.status !== 202) {
        throw new Error(
          `Expected subscribe status 202, got ${subscribeRes.status}: ${await subscribeRes
            .text()}`,
        );
      }
      await subscribeRes.body?.cancel();

      const appendRes = await fetch(
        `http://127.0.0.1:${port}/graphql/streams/gambit-workspace`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([
            {
              type: "testBotStatus",
              run: {
                id: "test-run-1",
                workspaceId,
                status: "running",
                messages: [],
              },
            },
          ]),
        },
      );
      assertEquals(appendRes.status, 204);
      await appendRes.body?.cancel();

      const sessionStreamId = `graphql-subscriptions:${sessionId}`;
      const deadline = Date.now() + 5_000;
      let nextEvents: Array<Record<string, unknown>> = [];
      while (Date.now() < deadline && nextEvents.length === 0) {
        const replayRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
            query SessionReplay($streamId: ID!) {
              gambitDurableStreamReplay(streamId: $streamId, fromOffset: 0) {
                events {
                  data
                }
              }
            }
          `,
            variables: { streamId: sessionStreamId },
          }),
        });
        const replayBody = await parseGraphqlEnvelope<{
          gambitDurableStreamReplay?: {
            events?: Array<{ data?: Record<string, unknown> }>;
          };
        }>(replayRes);
        const events = replayBody.data?.gambitDurableStreamReplay?.events ?? [];
        nextEvents = events
          .map((event) => asRecord(event.data))
          .filter((event): event is Record<string, unknown> => !!event)
          .filter((event) => event.type === "next");
        if (nextEvents.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assertEquals(nextEvents.length, 1);
      const firstPayload = asRecord(nextEvents[0]?.payload);
      const testLive = firstPayload
        ? asRecord(firstPayload.workspaceTestLive)
        : null;
      assert(testLive);
      const node = asRecord(testLive.node);
      assert(node);
      assertEquals(node.id, workspaceId);

      const closeRes = await fetch(`http://127.0.0.1:${port}/graphql/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", sessionId }),
      });
      assertEquals(closeRes.status, 200);
      await closeRes.body?.cancel();
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "/graphql grade tab mutations and reads persist runs and flags",
  async () => {
    const dir = await Deno.makeTempDir();
    const deckPath = path.join(dir, "graphql-grade.deck.md");
    const graderDeckPath = path.join(dir, "graders", "default", "PROMPT.md");
    await Deno.mkdir(path.dirname(graderDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `+++
label = "GraphQL Grade Root"

[modelParams]
model = ["dummy-model"]

[[graders]]
id = "default-grader"
path = "./graders/default/PROMPT.md"
label = "Default grader"
+++
`,
    );
    await Deno.writeTextFile(
      graderDeckPath,
      `+++
label = "Default grader"
contextSchema = "gambit://schemas/graders/contexts/conversation.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"

[modelParams]
model = ["dummy-model"]
+++
Return score and reason.
`,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: {
            role: "assistant",
            content: JSON.stringify({ score: 1, reason: "Looks good." }),
          },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });

    try {
      const port = tcpPortOf(server.addr);
      const createWorkspaceRes = await fetch(
        `http://127.0.0.1:${port}/graphql`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
            mutation WorkspaceCreate {
              gambitWorkspaceCreate {
                workspace { id }
              }
            }
          `,
          }),
        },
      );
      const createWorkspaceBody = await parseGraphqlEnvelope<{
        gambitWorkspaceCreate?: { workspace?: { id?: string } };
      }>(createWorkspaceRes);
      const workspaceId = createWorkspaceBody.data?.gambitWorkspaceCreate
        ?.workspace?.id ?? "";
      assert(workspaceId.length > 0);

      const runRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
            mutation GradeRun($input: WorkspaceGradeRunCreateInput!) {
              workspaceGradeRunCreate(input: $input) {
                run {
                  id
                  status
                  error
                }
                workspace {
                  id
                  gradeTab {
                    runs { id }
                  }
                }
              }
            }
          `,
          variables: {
            input: {
              workspaceId,
              graderId: "default-grader",
            },
          },
        }),
      });
      const runBody = await parseGraphqlEnvelope<{
        workspaceGradeRunCreate?: {
          run?: { id?: string; status?: string; error?: string | null };
          workspace?: {
            id?: string;
            gradeTab?: { runs?: Array<{ id?: string }> };
          };
        };
      }>(runRes);
      assertEquals(Array.isArray(runBody.errors), false);
      const runId = runBody.data?.workspaceGradeRunCreate?.run?.id ?? "";
      assert(runId.length > 0);
      assertEquals(
        typeof runBody.data?.workspaceGradeRunCreate?.run?.status,
        "string",
      );

      const runRefId = `gradingRun:${runId}`;

      const toggleRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
            mutation GradeFlagToggle($input: WorkspaceGradeFlagToggleInput!) {
              workspaceGradeFlagToggle(input: $input) {
                flags {
                  refId
                  runId
                }
              }
            }
          `,
          variables: {
            input: {
              workspaceId,
              refId: runRefId,
              runId,
            },
          },
        }),
      });
      const toggleBody = await parseGraphqlEnvelope<{
        workspaceGradeFlagToggle?: {
          flags?: Array<{ refId?: string; runId?: string | null }>;
        };
      }>(toggleRes);
      assertEquals(Array.isArray(toggleBody.errors), false);
      const toggledRefIds = toggleBody.data?.workspaceGradeFlagToggle?.flags
        ?.map((flag) => flag.refId)
        .filter((value): value is string => typeof value === "string") ?? [];
      assert(toggledRefIds.includes(runRefId));

      const reasonRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
            mutation GradeFlagReason($input: WorkspaceGradeFlagReasonUpdateInput!) {
              workspaceGradeFlagReasonUpdate(input: $input) {
                flags {
                  refId
                  reason
                }
              }
            }
          `,
          variables: {
            input: {
              workspaceId,
              refId: runRefId,
              reason: "Needs manual review.",
            },
          },
        }),
      });
      const reasonBody = await parseGraphqlEnvelope<{
        workspaceGradeFlagReasonUpdate?: {
          flags?: Array<{ refId?: string; reason?: string | null }>;
        };
      }>(reasonRes);
      assertEquals(Array.isArray(reasonBody.errors), false);
      const reasonEntry = reasonBody.data?.workspaceGradeFlagReasonUpdate?.flags
        ?.find((entry) => entry.refId === runRefId);
      assertEquals(reasonEntry?.reason, "Needs manual review.");
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);
