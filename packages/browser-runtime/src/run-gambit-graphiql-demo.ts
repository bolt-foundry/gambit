#!/usr/bin/env -S deno run -A
// deno-lint-ignore-file gambit/no-unexplained-as-unknown

import * as path from "@std/path";
import { runTimelineSteps } from "./automation/timeline.ts";
import { runE2e } from "./e2e/utils.ts";
import { bfmonoRoot } from "./paths.ts";

const DEFAULT_GAMBIT_BOT_DECK_RELATIVE = "src/decks/gambit-bot/PROMPT.md";

async function waitForGraphiql(
  target: { evaluate<T>(fn: () => T): Promise<T> },
  wait: (ms: number) => Promise<void>,
  timeoutMs = 30_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await target.evaluate(() => {
      const title = globalThis.document?.title ?? "";
      const bodyText = globalThis.document?.body?.textContent ?? "";
      return title.toLowerCase().includes("graphiql") ||
        bodyText.toLowerCase().includes("graphiql");
    });
    if (ready) return;
    await wait(200);
  }
  throw new Error(`Timed out waiting for GraphiQL after ${timeoutMs}ms.`);
}

type GraphqlResult = {
  data?: Record<string, unknown>;
  errors?: Array<{ message?: string }>;
};

async function runGraphiqlUiQuery(
  ctx: {
    demoTarget: {
      evaluate<Arg, Ret>(
        fn: (arg: Arg) => Ret | Promise<Ret>,
        arg: Arg,
      ): Promise<Ret>;
      evaluate<Ret>(fn: () => Ret | Promise<Ret>): Promise<Ret>;
    };
    page: { keyboard: { press(key: string): Promise<void> } };
    wait: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const query = `query GraphiqlDemoTypedQuery {
  gambitWorkspaces {
    status
    ok
    contentType
  }
}`;

  const setQueryOk = await ctx.demoTarget.evaluate((nextQuery: string) => {
    const root = globalThis as unknown as {
      fetch?: typeof fetch;
      monaco?: {
        editor?: { getModels?: () => Array<{ setValue(value: string): void }> };
      };
      document: Document;
      __graphiqlDemoQueryCount?: number;
    };

    if (typeof root.fetch === "function" && !root.__graphiqlDemoQueryCount) {
      const originalFetch = root.fetch.bind(globalThis);
      root.__graphiqlDemoQueryCount = 0;
      globalThis.fetch =
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          try {
            const url = String(input);
            const body = typeof init?.body === "string" ? init.body : "";
            if (url.includes("/graphql") && body.includes("gambitWorkspaces")) {
              root.__graphiqlDemoQueryCount =
                (root.__graphiqlDemoQueryCount ?? 0) +
                1;
            }
          } catch {
            // ignore instrumentation failures
          }
          return await originalFetch(input, init);
        }) as typeof fetch;
    }

    const models = root.monaco?.editor?.getModels?.() ?? [];
    if (models.length > 0) {
      models[0].setValue(nextQuery);
      return true;
    }

    const textarea = root.document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus();
      textarea.value = nextQuery;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }, query);

  if (!setQueryOk) {
    throw new Error("Could not set GraphiQL editor query.");
  }

  await ctx.wait(300);
  const clickedExecute = await ctx.demoTarget.evaluate(() => {
    const candidates = [
      'button[aria-label*="Execute"]',
      'button[title*="Execute"]',
      'button[aria-label*="Run"]',
    ];
    for (const selector of candidates) {
      const button = globalThis.document.querySelector(selector);
      if (button instanceof HTMLButtonElement) {
        button.click();
        return true;
      }
    }
    return false;
  });
  if (!clickedExecute) {
    await ctx.page.keyboard.press("Control+Enter");
  }

  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const queryCount = await ctx.demoTarget.evaluate(() =>
      (globalThis as unknown as { __graphiqlDemoQueryCount?: number })
        .__graphiqlDemoQueryCount ?? 0
    );
    if (queryCount > 0) return;
    await ctx.wait(200);
  }

  throw new Error("Timed out waiting for GraphiQL query result.");
}

async function runGraphqlDemoChecks(
  target: {
    evaluate<Arg, Ret>(
      fn: (arg: Arg) => Ret | Promise<Ret>,
      arg: Arg,
    ): Promise<Ret>;
  },
): Promise<void> {
  const streamId = `graphiql-demo-${crypto.randomUUID()}`;
  const checks = await target.evaluate(
    async (payload: { streamId: string }) => {
      const postGraphql = async (
        query: string,
        variables?: Record<string, unknown>,
      ): Promise<GraphqlResult> => {
        const response = await fetch("/graphql", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        return await response.json().catch(() => ({})) as GraphqlResult;
      };

      const typed = await postGraphql(
        `query { gambitWorkspaces { status ok contentType } }`,
      );

      await fetch(`/graphql/streams/${encodeURIComponent(payload.streamId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "gambit.demo.event", value: "ok" }),
      });

      const replay = await postGraphql(
        `
      query DemoReplay($streamId: String!, $fromOffset: Int) {
        gambitDurableStreamReplay(streamId: $streamId, fromOffset: $fromOffset) {
          streamId
          fromOffset
          nextOffset
          events {
            offset
            type
            data
          }
        }
      }
      `,
        { streamId: payload.streamId, fromOffset: 0 },
      );

      const proxy = await postGraphql(
        `query { apiGet(path: \"/api/workspaces\") { status } }`,
      );

      const summary = {
        typed,
        replay,
        proxy,
        checks: {
          typedOk: Boolean(
            typed.data?.gambitWorkspaces &&
              !typed.errors?.length,
          ),
          replayOk: Boolean(
            replay.data?.gambitDurableStreamReplay &&
              !replay.errors?.length,
          ),
          proxyRejected: Boolean(proxy.errors?.length),
        },
      };

      const existing = globalThis.document.getElementById(
        "graphiql-demo-proof",
      );
      if (existing) existing.remove();

      const panel = globalThis.document.createElement("pre");
      panel.id = "graphiql-demo-proof";
      panel.textContent = JSON.stringify(summary, null, 2);
      panel.style.position = "fixed";
      panel.style.right = "16px";
      panel.style.bottom = "16px";
      panel.style.maxWidth = "40vw";
      panel.style.maxHeight = "40vh";
      panel.style.overflow = "auto";
      panel.style.background = "rgba(16, 16, 16, 0.92)";
      panel.style.color = "#e7f8f2";
      panel.style.padding = "10px";
      panel.style.borderRadius = "8px";
      panel.style.font =
        "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace";
      panel.style.zIndex = "2147483647";
      panel.style.border = "1px solid rgba(89, 245, 189, 0.5)";
      globalThis.document.body.appendChild(panel);

      return summary;
    },
    { streamId },
  );

  const typedOk = Boolean(checks.checks?.typedOk);
  const replayOk = Boolean(checks.checks?.replayOk);
  const proxyRejected = Boolean(checks.checks?.proxyRejected);
  if (!typedOk || !replayOk || !proxyRejected) {
    throw new Error(
      `GraphiQL demo checks failed: ${JSON.stringify(checks.checks)}`,
    );
  }
}

async function main(): Promise<void> {
  const repoRoot = bfmonoRoot;
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");
  const deckPath = path.resolve(
    gambitPackageRoot,
    DEFAULT_GAMBIT_BOT_DECK_RELATIVE,
  );

  await runE2e(
    "gambit graphiql demo",
    async (ctx) => {
      const { demoTarget, wait } = ctx;
      await waitForGraphiql(demoTarget, wait);

      await runTimelineSteps(ctx, [
        { type: "wait", ms: 500 },
        { type: "screenshot", label: "01-graphiql-entry" },
      ]);

      await runGraphiqlUiQuery(ctx);

      await runTimelineSteps(ctx, [
        { type: "wait", ms: 300 },
        { type: "screenshot", label: "02-graphiql-ui-query-result" },
      ]);

      await runGraphqlDemoChecks(demoTarget);

      await runTimelineSteps(ctx, [
        { type: "wait", ms: 300 },
        { type: "screenshot", label: "03-graphiql-typed-checks" },
      ]);
    },
    {
      slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
        "gambit-graphiql-demo",
      iframeTargetPath: "/graphql",
      server: {
        port: 8000,
        cwd: gambitPackageRoot,
        command: (targetPort: number) => [
          "deno",
          "run",
          "-A",
          "src/cli.ts",
          "serve",
          deckPath,
          "--bundle",
          "--port",
          String(targetPort),
        ],
      },
    },
  );
}

if (import.meta.main) {
  await main();
}
