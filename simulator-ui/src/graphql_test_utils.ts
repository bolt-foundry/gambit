type GraphqlPayload = {
  query?: unknown;
  variables?: unknown;
};

export type MockApiRequest = {
  url: string;
  pathname: string;
  search: string;
  method: string;
  body?: Record<string, unknown>;
};

const parseBodyRecord = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const envelopeResponse = async (
  _method: string,
  res: Response,
  fieldName: string,
): Promise<Response> => {
  const payload = {
    status: res.status,
    ok: res.ok,
    body: await res.text(),
    contentType: res.headers.get("content-type"),
  };
  return new Response(JSON.stringify({ data: { [fieldName]: payload } }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};

const parseJsonObject = async (
  res: Response,
): Promise<Record<string, unknown>> => {
  const text = await res.text();
  if (text.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

function toWorkspaceConnection(rawWorkspaces: Array<unknown>) {
  const edges = rawWorkspaces.map((workspace, index) => ({
    node: workspace,
    cursor: `cursor:${index}`,
  }));
  return {
    edges,
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: edges.length > 0 ? edges[0]?.cursor ?? null : null,
      endCursor: edges.length > 0
        ? edges[edges.length - 1]?.cursor ?? null
        : null,
    },
  };
}

const typedResponse = async (
  res: Response,
  fieldName: string,
): Promise<Response> => {
  if (fieldName === "gambitWorkspaces") {
    const payload = await parseJsonObject(res);
    const workspaces = Array.isArray(payload.workspaces)
      ? payload.workspaces
      : [];
    return new Response(
      JSON.stringify({
        data: { [fieldName]: toWorkspaceConnection(workspaces) },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  if (fieldName === "gambitWorkspaceCreate") {
    const payload = await parseJsonObject(res);
    const workspaceId = typeof payload.workspaceId === "string"
      ? payload.workspaceId
      : typeof payload.id === "string"
      ? payload.id
      : "";
    const payloadWorkspaces = Array.isArray(payload.workspaces)
      ? payload.workspaces
      : [];
    const workspaces = workspaceId.length > 0 &&
        !payloadWorkspaces.some((workspace) =>
          workspace && typeof workspace === "object" &&
          !Array.isArray(workspace) &&
          (workspace as { id?: unknown }).id === workspaceId
        )
      ? [...payloadWorkspaces, { id: workspaceId }]
      : payloadWorkspaces;
    return new Response(
      JSON.stringify({
        data: {
          [fieldName]: {
            workspace: { id: workspaceId },
            workspaces: toWorkspaceConnection(workspaces),
          },
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  if (fieldName === "gambitWorkspaceDelete") {
    const payload = await parseJsonObject(res);
    const workspaceId = typeof payload.workspaceId === "string"
      ? payload.workspaceId
      : "";
    const deleted = payload.deleted === true;
    const error = typeof payload.error === "string" ? payload.error : null;
    return new Response(
      JSON.stringify({
        data: {
          [fieldName]: { workspaceId, deleted, error },
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  return envelopeResponse("GET", res, fieldName);
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const asStringOrEmpty = (value: unknown): string =>
  typeof value === "string" ? value : "";

const parseInputObject = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const decodeGraphqlOperation = (
  payload: GraphqlPayload | undefined,
): {
  request: MockApiRequest;
  responseField: string;
} => {
  const query = typeof payload?.query === "string" ? payload.query : "";
  const vars = asRecord(payload?.variables);

  if (query.includes("gambitWorkspaces")) {
    return {
      request: {
        url: "/api/workspaces",
        pathname: "/api/workspaces",
        search: "",
        method: "GET",
      },
      responseField: "gambitWorkspaces",
    };
  }

  if (query.includes("gambitWorkspaceTestRun")) {
    const workspaceId = encodeURIComponent(asStringOrEmpty(vars.workspaceId));
    const runId = encodeURIComponent(asStringOrEmpty(vars.runId));
    const deckPath = asStringOrEmpty(vars.deckPath);
    const search = deckPath ? `?deckPath=${encodeURIComponent(deckPath)}` : "";
    return {
      request: {
        url: `/api/workspaces/${workspaceId}/test/${runId}${search}`,
        pathname: `/api/workspaces/${workspaceId}/test/${runId}`,
        search,
        method: "GET",
      },
      responseField: "gambitWorkspaceTestRun",
    };
  }

  if (query.includes("gambitWorkspaceGradeRun")) {
    const workspaceId = encodeURIComponent(asStringOrEmpty(vars.workspaceId));
    const runId = encodeURIComponent(asStringOrEmpty(vars.runId));
    const deckPath = asStringOrEmpty(vars.deckPath);
    const search = deckPath ? `?deckPath=${encodeURIComponent(deckPath)}` : "";
    return {
      request: {
        url: `/api/workspaces/${workspaceId}/grade/${runId}${search}`,
        pathname: `/api/workspaces/${workspaceId}/grade/${runId}`,
        search,
        method: "GET",
      },
      responseField: "gambitWorkspaceGradeRun",
    };
  }

  if (query.includes("gambitWorkspace(")) {
    const id = encodeURIComponent(asStringOrEmpty(vars.id));
    const deckPath = asStringOrEmpty(vars.deckPath);
    const search = deckPath ? `?deckPath=${encodeURIComponent(deckPath)}` : "";
    return {
      request: {
        url: `/api/workspaces/${id}${search}`,
        pathname: `/api/workspaces/${id}`,
        search,
        method: "GET",
      },
      responseField: "gambitWorkspace",
    };
  }

  if (query.includes("gambitTestState")) {
    const params = new URLSearchParams();
    const workspaceId = asStringOrEmpty(vars.workspaceId);
    const deckPath = asStringOrEmpty(vars.deckPath);
    if (workspaceId) params.set("workspaceId", workspaceId);
    if (deckPath) params.set("deckPath", deckPath);
    const search = params.toString() ? `?${params.toString()}` : "";
    return {
      request: {
        url: `/api/test${search}`,
        pathname: "/api/test",
        search,
        method: "GET",
      },
      responseField: "gambitTestState",
    };
  }

  if (query.includes("gambitWorkspaceCreate")) {
    return {
      request: {
        url: "/api/workspace/new",
        pathname: "/api/workspace/new",
        search: "",
        method: "POST",
      },
      responseField: "gambitWorkspaceCreate",
    };
  }

  if (query.includes("gambitWorkspaceDelete")) {
    return {
      request: {
        url: "/api/workspace/delete",
        pathname: "/api/workspace/delete",
        search: "",
        method: "POST",
        body: { workspaceId: vars.workspaceId },
      },
      responseField: "gambitWorkspaceDelete",
    };
  }

  const objectInput = parseInputObject(vars.input);

  if (query.includes("gambitWorkspaceFeedbackUpsert")) {
    return {
      request: {
        url: "/api/workspace/feedback",
        pathname: "/api/workspace/feedback",
        search: "",
        method: "POST",
        body: objectInput,
      },
      responseField: "gambitWorkspaceFeedbackUpsert",
    };
  }

  if (query.includes("gambitWorkspaceNotesUpsert")) {
    return {
      request: {
        url: "/api/workspace/notes",
        pathname: "/api/workspace/notes",
        search: "",
        method: "POST",
        body: objectInput,
      },
      responseField: "gambitWorkspaceNotesUpsert",
    };
  }

  if (query.includes("gambitBuildMessage")) {
    return {
      request: {
        url: "/api/build/message",
        pathname: "/api/build/message",
        search: "",
        method: "POST",
        body: objectInput,
      },
      responseField: "gambitBuildMessage",
    };
  }

  if (query.includes("gambitBuildStop")) {
    return {
      request: {
        url: "/api/build/stop",
        pathname: "/api/build/stop",
        search: "",
        method: "POST",
        body: { workspaceId: vars.workspaceId },
      },
      responseField: "gambitBuildStop",
    };
  }

  if (query.includes("gambitBuildReset")) {
    return {
      request: {
        url: "/api/build/reset",
        pathname: "/api/build/reset",
        search: "",
        method: "POST",
        body: { workspaceId: vars.workspaceId },
      },
      responseField: "gambitBuildReset",
    };
  }

  if (query.includes("gambitTestRunStart")) {
    return {
      request: {
        url: "/api/test/run",
        pathname: "/api/test/run",
        search: "",
        method: "POST",
        body: objectInput,
      },
      responseField: "gambitTestRunStart",
    };
  }

  if (query.includes("gambitTestMessage")) {
    return {
      request: {
        url: "/api/test/message",
        pathname: "/api/test/message",
        search: "",
        method: "POST",
        body: objectInput,
      },
      responseField: "gambitTestMessage",
    };
  }

  if (query.includes("gambitTestStop")) {
    return {
      request: {
        url: "/api/test/stop",
        pathname: "/api/test/stop",
        search: "",
        method: "POST",
        body: { runId: vars.runId },
      },
      responseField: "gambitTestStop",
    };
  }

  if (query.includes("gambitGradeRun")) {
    return {
      request: {
        url: "/api/calibrate/run",
        pathname: "/api/calibrate/run",
        search: "",
        method: "POST",
        body: objectInput,
      },
      responseField: "gambitGradeRun",
    };
  }

  if (query.includes("gambitGradeFlagToggle")) {
    return {
      request: {
        url: "/api/calibrate/flag",
        pathname: "/api/calibrate/flag",
        search: "",
        method: "POST",
        body: objectInput,
      },
      responseField: "gambitGradeFlagToggle",
    };
  }

  if (query.includes("gambitGradeFlagReasonUpdate")) {
    return {
      request: {
        url: "/api/calibrate/flag/reason",
        pathname: "/api/calibrate/flag/reason",
        search: "",
        method: "POST",
        body: objectInput,
      },
      responseField: "gambitGradeFlagReasonUpdate",
    };
  }

  throw new Error("Unsupported GraphQL operation in test helper");
};

const parseMockRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
): {
  request: MockApiRequest;
  isGraphql: boolean;
  responseField?: string;
} => {
  const rawUrl = String(input);
  const base = new URL(rawUrl, "http://localhost");

  if (base.pathname !== "/graphql") {
    return {
      request: {
        url: `${base.pathname}${base.search}`,
        pathname: base.pathname,
        search: base.search,
        method: (init?.method ?? "GET").toUpperCase(),
        body: parseBodyRecord(init?.body),
      },
      isGraphql: false,
    };
  }

  const payload = parseBodyRecord(init?.body) as GraphqlPayload | undefined;
  const decoded = decodeGraphqlOperation(payload);
  return {
    request: decoded.request,
    isGraphql: true,
    responseField: decoded.responseField,
  };
};

export function createGraphqlAwareFetch(
  responder: (request: MockApiRequest) => Promise<Response> | Response,
  requests?: Array<{ url: string; body?: Record<string, unknown> }>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const parsed = parseMockRequest(input, init);
    requests?.push({ url: parsed.request.url, body: parsed.request.body });
    const response = await responder(parsed.request);
    if (!parsed.isGraphql || !parsed.responseField) return response;
    return await typedResponse(response, parsed.responseField);
  }) as typeof fetch;
}
