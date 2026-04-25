import type { BrowserContext, Page, Route } from "playwright-core";

type GraphqlPayload = {
  query?: unknown;
  operationName?: unknown;
  variables?: unknown;
};

export type MockApiRequest = {
  url: string;
  pathname: string;
  search: string;
  method: string;
  body?: Record<string, unknown>;
};

export type BrowserGraphqlMockRequest = {
  url: string;
  pathname: string;
  search: string;
  method: string;
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
};

export type BrowserGraphqlMockHandler = (
  request: BrowserGraphqlMockRequest,
) => Response | Promise<Response>;

export type BrowserGraphqlMockRule = {
  operationName?: string;
  queryIncludes?: string;
  handler: BrowserGraphqlMockHandler;
};

export type BrowserGraphqlMockRegistry = {
  handlers: ReadonlyArray<BrowserGraphqlMockRule>;
  handle(
    request: BrowserGraphqlMockRequest,
  ): Promise<Response | undefined>;
};

export type BrowserGraphqlMockOptions = {
  registry?: BrowserGraphqlMockRegistry;
  handlers?: ReadonlyArray<BrowserGraphqlMockRule>;
  apiResponder?: (
    request: MockApiRequest,
  ) => Promise<Response> | Response;
  onUnhandled?: "continue" | "error";
};

type PlaywrightRouteTarget =
  | Pick<BrowserContext, "route" | "unroute">
  | Pick<Page, "route" | "unroute">;

type ParsedGraphqlRequest = {
  request: BrowserGraphqlMockRequest;
  apiRequest?: MockApiRequest;
  apiResponseField?: string;
};

const GRAPHQL_ROUTE_PATTERN = "**/graphql*";

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

const envelopeResponse = async (
  res: Response,
  fieldName: string,
): Promise<Response> => {
  const payload = {
    status: res.status,
    ok: res.ok,
    body: await res.text(),
    contentType: res.headers.get("content-type"),
  };
  return jsonResponse({ data: { [fieldName]: payload } });
};

const typedResponse = async (
  res: Response,
  fieldName: string,
): Promise<Response> => {
  if (fieldName === "gambitWorkspaces") {
    const payload = await parseJsonObject(res);
    const workspaces = Array.isArray(payload.workspaces)
      ? payload.workspaces
      : [];
    return jsonResponse({
      data: { [fieldName]: toWorkspaceConnection(workspaces) },
    });
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
    return jsonResponse({
      data: {
        [fieldName]: {
          workspace: { id: workspaceId },
          workspaces: toWorkspaceConnection(workspaces),
        },
      },
    });
  }

  if (fieldName === "gambitWorkspaceDelete") {
    const payload = await parseJsonObject(res);
    const workspaceId = typeof payload.workspaceId === "string"
      ? payload.workspaceId
      : "";
    const deleted = payload.deleted === true;
    const error = typeof payload.error === "string" ? payload.error : null;
    return jsonResponse({
      data: { [fieldName]: { workspaceId, deleted, error } },
    });
  }

  return await envelopeResponse(res, fieldName);
};

function extractOperationName(
  payload: GraphqlPayload | undefined,
): string | undefined {
  const explicit = typeof payload?.operationName === "string"
    ? payload.operationName.trim()
    : "";
  if (explicit.length > 0) return explicit;
  const query = typeof payload?.query === "string" ? payload.query : "";
  const match = query.match(
    /\b(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)\b/,
  );
  return match?.[1];
}

export function jsonResponse(
  body: unknown,
  init?: ResponseInit,
): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function createBrowserGraphqlMockRegistry(
  handlers: ReadonlyArray<BrowserGraphqlMockRule>,
): BrowserGraphqlMockRegistry {
  return {
    handlers,
    async handle(request) {
      for (const rule of handlers) {
        if (
          rule.operationName &&
          request.operationName !== rule.operationName
        ) {
          continue;
        }
        if (
          rule.queryIncludes &&
          !request.query.includes(rule.queryIncludes)
        ) {
          continue;
        }
        return await rule.handler(request);
      }
      return undefined;
    },
  };
}

export function decodeGraphqlOperation(
  payload: GraphqlPayload | undefined,
): {
  request: MockApiRequest;
  responseField: string;
} {
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
}

export function parseBrowserGraphqlMockRequest(
  rawUrl: string,
  method = "POST",
  rawBody?: string | null,
): ParsedGraphqlRequest {
  const base = new URL(rawUrl, "http://localhost");
  if (base.pathname !== "/graphql") {
    throw new Error(`Expected /graphql request, received ${base.pathname}`);
  }
  const payload = parseBodyRecord(rawBody) as GraphqlPayload | undefined;
  const request: BrowserGraphqlMockRequest = {
    url: `${base.pathname}${base.search}`,
    pathname: base.pathname,
    search: base.search,
    method: method.toUpperCase(),
    query: typeof payload?.query === "string" ? payload.query : "",
    operationName: extractOperationName(payload),
    variables: asRecord(payload?.variables),
  };
  try {
    const decoded = decodeGraphqlOperation(payload);
    return {
      request,
      apiRequest: decoded.request,
      apiResponseField: decoded.responseField,
    };
  } catch {
    return { request };
  }
}

export async function resolveBrowserGraphqlMockResponse(
  request: BrowserGraphqlMockRequest,
  options: BrowserGraphqlMockOptions,
  decoded?: { apiRequest?: MockApiRequest; apiResponseField?: string },
): Promise<Response | undefined> {
  const registry = options.registry ??
    (options.handlers
      ? createBrowserGraphqlMockRegistry(options.handlers)
      : undefined);
  const directResponse = registry ? await registry.handle(request) : undefined;
  if (directResponse) return directResponse;
  if (
    !options.apiResponder || !decoded?.apiRequest || !decoded.apiResponseField
  ) {
    return undefined;
  }
  const apiResponse = await options.apiResponder(decoded.apiRequest);
  return await typedResponse(apiResponse, decoded.apiResponseField);
}

async function fulfillRoute(route: Route, response: Response): Promise<void> {
  const headers = Object.fromEntries(response.headers.entries());
  const body = await response.text();
  await route.fulfill({
    status: response.status,
    headers,
    body,
  });
}

export async function installBrowserGraphqlMocks(
  target: PlaywrightRouteTarget,
  options: BrowserGraphqlMockOptions,
): Promise<() => Promise<void>> {
  const handler = async (route: Route): Promise<void> => {
    const playwrightRequest = route.request();
    const method = playwrightRequest.method().toUpperCase();
    if (method !== "POST") {
      await route.continue();
      return;
    }

    const url = playwrightRequest.url();
    const parsedUrl = new URL(url, "http://localhost");
    if (parsedUrl.pathname !== "/graphql") {
      await route.continue();
      return;
    }

    const parsed = parseBrowserGraphqlMockRequest(
      url,
      method,
      playwrightRequest.postData(),
    );
    const response = await resolveBrowserGraphqlMockResponse(
      parsed.request,
      options,
      {
        apiRequest: parsed.apiRequest,
        apiResponseField: parsed.apiResponseField,
      },
    );
    if (response) {
      await fulfillRoute(route, response);
      return;
    }
    if (options.onUnhandled === "error") {
      throw new Error(
        `Unhandled GraphQL mock request: ${
          parsed.request.operationName ?? parsed.request.query
        }`,
      );
    }
    await route.continue();
  };

  await target.route(GRAPHQL_ROUTE_PATTERN, handler);
  return async () => {
    await target.unroute(GRAPHQL_ROUTE_PATTERN, handler);
  };
}

export function createGraphqlAwareFetch(
  responder: (request: MockApiRequest) => Promise<Response> | Response,
  requests?: Array<{ url: string; body?: Record<string, unknown> }>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = String(input);
    const base = new URL(rawUrl, "http://localhost");

    if (base.pathname !== "/graphql") {
      const request = {
        url: `${base.pathname}${base.search}`,
        pathname: base.pathname,
        search: base.search,
        method: (init?.method ?? "GET").toUpperCase(),
        body: parseBodyRecord(init?.body),
      };
      requests?.push({ url: request.url, body: request.body });
      return await responder(request);
    }

    const parsed = parseBrowserGraphqlMockRequest(
      rawUrl,
      init?.method ?? "POST",
      typeof init?.body === "string" ? init.body : null,
    );
    if (!parsed.apiRequest || !parsed.apiResponseField) {
      throw new Error("Unsupported GraphQL operation in test helper");
    }
    requests?.push({
      url: parsed.apiRequest.url,
      body: parsed.apiRequest.body,
    });
    const response = await responder(parsed.apiRequest);
    return await typedResponse(response, parsed.apiResponseField);
  }) as typeof fetch;
}
