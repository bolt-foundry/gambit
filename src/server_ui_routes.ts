type HandleUiRoutesDeps = {
  url: URL;
  workspaceRouteBase: string;
  activeWorkspaceId: string | null;
  activeWorkspaceOnboarding: boolean;
  resolvedDeckPath: string;
  deckLabel?: string;
  getWorkspaceIdFromQuery: (url: URL) => string | undefined;
  activateWorkspaceDeck: (workspaceId?: string) => Promise<void>;
  schemaPromise: Promise<unknown>;
  deckLoadPromise: Promise<unknown>;
  canServeReactBundle: () => Promise<boolean>;
  simulatorReactHtml: (
    deckPath: string,
    deckLabel?: string,
    opts?: {
      workspaceId?: string | null;
      onboarding?: boolean;
      currentPath?: string;
    },
  ) => Promise<string>;
  toDeckLabel: (deckPath: string) => string;
  readReactBundle: () => Promise<Uint8Array | null>;
  shouldAdvertiseSourceMap: () => boolean;
  readReactBundleSourceMap: () => Promise<Uint8Array | null>;
};

export const handleUiRoutes = async (
  deps: HandleUiRoutesDeps,
): Promise<Response | null> => {
  const {
    url,
    workspaceRouteBase,
    activeWorkspaceId,
    activeWorkspaceOnboarding,
    resolvedDeckPath,
    deckLabel,
    getWorkspaceIdFromQuery,
    activateWorkspaceDeck,
    schemaPromise,
    deckLoadPromise,
    canServeReactBundle,
    simulatorReactHtml,
    toDeckLabel,
    readReactBundle,
    shouldAdvertiseSourceMap,
    readReactBundleSourceMap,
  } = deps;

  if (
    url.pathname === "/" ||
    url.pathname === "/isograph" ||
    url.pathname.startsWith("/isograph/") ||
    url.pathname === workspaceRouteBase ||
    url.pathname.startsWith(`${workspaceRouteBase}/`) ||
    url.pathname.startsWith("/simulate") ||
    url.pathname.startsWith("/debug") ||
    url.pathname.startsWith("/build") ||
    url.pathname.startsWith("/test") ||
    url.pathname.startsWith("/grade") ||
    url.pathname.startsWith("/verify") ||
    url.pathname.startsWith("/editor") ||
    url.pathname.startsWith("/docs")
  ) {
    const hasBundle = await canServeReactBundle();
    if (!hasBundle) {
      return new Response(
        "Simulator UI bundle missing. Run `deno task bundle:sim` (or start with `--bundle`).",
        { status: 500 },
      );
    }
    await deckLoadPromise.catch(() => null);
    const resolvedLabel = deckLabel ?? toDeckLabel(resolvedDeckPath);
    return new Response(
      await simulatorReactHtml(resolvedDeckPath, resolvedLabel, {
        workspaceId: activeWorkspaceId ?? null,
        onboarding: activeWorkspaceOnboarding,
        currentPath: url.pathname,
      }),
      {
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }

  if (url.pathname === "/schema") {
    const sessionId = getWorkspaceIdFromQuery(url);
    if (sessionId) {
      await activateWorkspaceDeck(sessionId);
    }
    const descRaw = await schemaPromise;
    const desc = descRaw && typeof descRaw === "object"
      ? descRaw as Record<string, unknown>
      : {};
    const deck = await deckLoadPromise.catch(() => null) as {
      startMode?: unknown;
      modelParams?: Record<string, unknown>;
    } | null;
    const modelParams = deck && typeof deck === "object"
      ? deck.modelParams
      : undefined;
    const startMode = deck &&
        (deck.startMode === "assistant" || deck.startMode === "user")
      ? deck.startMode
      : "assistant";
    return new Response(
      JSON.stringify({
        deck: resolvedDeckPath,
        startMode,
        modelParams,
        ...desc,
      }),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  if (url.pathname === "/ui/bundle.js") {
    const data = await readReactBundle();
    if (!data) {
      return new Response(
        "Bundle missing. Run `deno task bundle:sim` (or start with `--bundle`).",
        { status: 404 },
      );
    }
    try {
      const headers = new Headers({
        "content-type": "application/javascript; charset=utf-8",
      });
      if (shouldAdvertiseSourceMap()) {
        headers.set("SourceMap", "/ui/bundle.js.map");
      }
      // this predates the lint rule
      return new Response(data as unknown as BodyInit, { headers });
    } catch (err) {
      return new Response(
        `Failed to read bundle: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { status: 500 },
      );
    }
  }

  if (url.pathname === "/ui/bundle.js.map") {
    const data = await readReactBundleSourceMap();
    if (!data) {
      return new Response(
        "Source map missing. Run `deno task bundle:sim:sourcemap` (or start with `--bundle --sourcemap`).",
        { status: 404 },
      );
    }
    try {
      // this predates the lint rule
      return new Response(data as unknown as BodyInit, {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    } catch (err) {
      return new Response(
        `Failed to read source map: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { status: 500 },
      );
    }
  }

  return null;
};
