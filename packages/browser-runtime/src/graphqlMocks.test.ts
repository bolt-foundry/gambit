import { assertEquals, assertRejects } from "@std/assert";
import type { Request as PlaywrightRequest, Route } from "playwright-core";
import {
  createBrowserGraphqlMockRegistry,
  installBrowserGraphqlMocks,
  parseBrowserGraphqlMockRequest,
  resolveBrowserGraphqlMockResponse,
} from "./graphqlMocks.ts";

Deno.test("parseBrowserGraphqlMockRequest extracts operation metadata", () => {
  const parsed = parseBrowserGraphqlMockRequest(
    "http://localhost/graphql",
    "POST",
    JSON.stringify({
      query:
        "query HomepageFaqQuery($slug: String!) { faq(slug: $slug) { id } }",
      variables: { slug: "intro" },
    }),
  );

  assertEquals(parsed.request.operationName, "HomepageFaqQuery");
  assertEquals(parsed.request.variables, { slug: "intro" });
  assertEquals(parsed.request.pathname, "/graphql");
  assertEquals(parsed.apiRequest, undefined);
});

Deno.test("resolveBrowserGraphqlMockResponse supports direct GraphQL handlers", async () => {
  const registry = createBrowserGraphqlMockRegistry([
    {
      operationName: "HomepageFaqQuery",
      handler: () =>
        new Response(
          JSON.stringify({ data: { faq: { id: "faq-1", title: "Intro" } } }),
        ),
    },
  ]);

  const response = await resolveBrowserGraphqlMockResponse(
    {
      url: "/graphql",
      pathname: "/graphql",
      search: "",
      method: "POST",
      query: "query HomepageFaqQuery { faq { id title } }",
      operationName: "HomepageFaqQuery",
      variables: {},
    },
    { registry },
  );

  assertEquals(await response?.json(), {
    data: { faq: { id: "faq-1", title: "Intro" } },
  });
});

Deno.test("resolveBrowserGraphqlMockResponse adapts Gambit operations through apiResponder", async () => {
  const parsed = parseBrowserGraphqlMockRequest(
    "http://localhost/graphql",
    "POST",
    JSON.stringify({
      query: "query { gambitWorkspaces { edges { node { id } } } }",
    }),
  );

  const response = await resolveBrowserGraphqlMockResponse(
    parsed.request,
    {
      apiResponder: (request) => {
        assertEquals(request, {
          url: "/api/workspaces",
          pathname: "/api/workspaces",
          search: "",
          method: "GET",
        });
        return new Response(
          JSON.stringify({ workspaces: [{ id: "workspace-1" }] }),
        );
      },
    },
    {
      apiRequest: parsed.apiRequest,
      apiResponseField: parsed.apiResponseField,
    },
  );

  assertEquals(await response?.json(), {
    data: {
      gambitWorkspaces: {
        edges: [{ node: { id: "workspace-1" }, cursor: "cursor:0" }],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: "cursor:0",
          endCursor: "cursor:0",
        },
      },
    },
  });
});

Deno.test("installBrowserGraphqlMocks fulfills matched requests and continues unhandled ones", async () => {
  let registeredHandler:
    | ((route: Route, request: PlaywrightRequest) => Promise<void>)
    | undefined;
  const target = {
    route(
      _pattern: string,
      handler: (route: Route, request: PlaywrightRequest) => Promise<void>,
    ): Promise<void> {
      registeredHandler = handler;
      return Promise.resolve();
    },
    unroute(): Promise<void> {
      registeredHandler = undefined;
      return Promise.resolve();
    },
  };

  await installBrowserGraphqlMocks(target, {
    handlers: [{
      operationName: "HomepageFaqQuery",
      handler: () =>
        new Response(JSON.stringify({ data: { faq: { id: "faq-1" } } })),
    }],
  });

  if (!registeredHandler) {
    throw new Error("expected route handler to be installed");
  }

  const fulfilled: Array<{ status?: number; body?: string }> = [];
  let continued = 0;
  const makeRoute = (payload: { query: string; operationName?: string }) =>
    ({
      request() {
        return {
          method: () => "POST",
          url: () => "http://localhost/graphql",
          postData: () => JSON.stringify(payload),
        };
      },
      continue: () => {
        continued += 1;
        return Promise.resolve();
      },
      fulfill: (value: { status?: number; body?: string }) => {
        fulfilled.push(value);
        return Promise.resolve();
      },
    }) as unknown as Route;

  await registeredHandler(
    makeRoute({
      query: "query HomepageFaqQuery { faq { id } }",
      operationName: "HomepageFaqQuery",
    }),
    {} as PlaywrightRequest,
  );
  await registeredHandler(
    makeRoute({
      query: "query UnknownOperation { node { id } }",
      operationName: "UnknownOperation",
    }),
    {} as PlaywrightRequest,
  );

  assertEquals(fulfilled.length, 1);
  assertEquals(fulfilled[0]?.status, 200);
  assertEquals(
    fulfilled[0]?.body,
    JSON.stringify({
      data: { faq: { id: "faq-1" } },
    }),
  );
  assertEquals(continued, 1);
});

Deno.test("installBrowserGraphqlMocks can fail fast on unhandled operations", async () => {
  let registeredHandler:
    | ((route: Route, request: PlaywrightRequest) => Promise<void>)
    | undefined;
  const target = {
    route(
      _pattern: string,
      handler: (route: Route, request: PlaywrightRequest) => Promise<void>,
    ): Promise<void> {
      registeredHandler = handler;
      return Promise.resolve();
    },
    unroute(): Promise<void> {
      registeredHandler = undefined;
      return Promise.resolve();
    },
  };

  await installBrowserGraphqlMocks(target, {
    handlers: [],
    onUnhandled: "error",
  });

  if (!registeredHandler) {
    throw new Error("expected route handler to be installed");
  }

  await assertRejects(
    () =>
      registeredHandler!(
        ({
          request() {
            return {
              method: () => "POST",
              url: () => "http://localhost/graphql",
              postData: () =>
                JSON.stringify({
                  query: "query UnhandledOperation { node { id } }",
                  operationName: "UnhandledOperation",
                }),
            };
          },
          continue: () => Promise.resolve(),
          fulfill: () => Promise.resolve(),
        }) as unknown as Route,
        {} as PlaywrightRequest,
      ),
    Error,
    "Unhandled GraphQL mock request",
  );
});
