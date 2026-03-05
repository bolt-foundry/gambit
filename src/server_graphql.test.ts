import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import { modImportPath } from "./server_test_utils.ts";

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
            scenarioRunId: scenarioSessionId,
            batchSize: 1,
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
  "/graphql scenario conversation sessions preserve assistant-first transcript order",
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
        const transcript = await gql<{
          workspace?: {
            conversationSession?: {
              __typename?: string;
              transcript?: {
                edges?: Array<{
                  node?: {
                    __typename?: string;
                    role?: string;
                    content?: string;
                  };
                }>;
              };
            } | null;
          } | null;
        }>(
          `
            query ScenarioTranscript($workspaceId: ID!, $sessionId: ID!) {
              workspace(id: $workspaceId) {
                conversationSession(sessionId: $sessionId) {
                  __typename
                  ... on WorkspaceScenarioConversationSession {
                    transcript(first: 50) {
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
          `,
          { workspaceId, sessionId: scenarioSessionId },
        );
        messages = (
          transcript.data?.workspace?.conversationSession?.transcript?.edges ??
            []
        ).flatMap((edge) => {
          const node = edge?.node;
          if (node?.__typename !== "OutputMessage") return [];
          return [{ role: node.role ?? "", content: node.content ?? "" }];
        });
        if (
          messages.length >= 3 &&
          messages[2]?.content === "Fine. What do you need?"
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const readyAssistantIndex = messages.findIndex((message) =>
        message.role === "assistant" && message.content === "Ready."
      );
      const userPromptIndex = messages.findIndex((message) =>
        message.role === "user" && message.content === "how are you"
      );
      const replyAssistantIndex = messages.findIndex((message) =>
        message.role === "assistant" &&
        message.content === "Fine. What do you need?"
      );
      assert(readyAssistantIndex >= 0);
      assert(userPromptIndex >= 0);
      assert(replyAssistantIndex >= 0);
      assert(readyAssistantIndex < userPromptIndex);
      assert(userPromptIndex < replyAssistantIndex);
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
    const graderDeckPath = path.join(dir, "graders", "default", "PROMPT.md");
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

[[graders]]
id = "default-grader"
path = "./graders/default/PROMPT.md"
label = "Default grader"
+++
Verify test.
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
                  requested
                  active
                  completed
                  failed
                  requests(first: 50) {
                    edges {
                      node {
                        id
                        status
                        runId
                        error
                      }
                    }
                  }
                  metrics {
                    sampleSize
                    verdict
                    verdictReason
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
              graderId: "default-grader",
              batchSize: 2,
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
            requested?: number;
            active?: number;
            completed?: number;
            failed?: number;
            requests?: {
              edges?: Array<{
                node?: {
                  id?: string;
                  status?: string;
                  runId?: string | null;
                  error?: string | null;
                };
              }>;
            };
            metrics?: {
              sampleSize?: number;
              verdict?: string;
              verdictReason?: string;
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
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch?.requested,
        2,
      );
      const requestNodes =
        verifyBody.data?.workspaceVerifyBatchRunCreate?.batch?.requests?.edges
          ?.map((edge) => edge?.node)
          .filter((node): node is { id?: string; status?: string } =>
            Boolean(node)
          ) ?? [];
      assertEquals(requestNodes.length, 2);
      const statuses = requestNodes.map((request) => request.status ?? "");
      assert(
        statuses.every((status) =>
          status === "COMPLETED" || status === "ERROR"
        ),
      );
      const latestBatchId =
        verifyBody.data?.workspaceVerifyBatchRunCreate?.workspace?.verification
          ?.batches?.edges?.[0]?.node?.id ?? "";
      assertEquals(latestBatchId, batchId);
      const metrics = verifyBody.data?.workspaceVerifyBatchRunCreate?.batch
        ?.metrics;
      if (metrics) {
        assertEquals(typeof metrics.sampleSize, "number");
        assertEquals(typeof metrics.verdict, "string");
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
