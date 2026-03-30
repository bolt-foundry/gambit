import {
  createContext,
  type ReactNode,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  isographAppRoutes,
  matchRouteWithParams,
  normalizePathname,
  stripQueryFromPath,
} from "./routing.ts";

export type RouterContextType = {
  currentPath: string;
  currentRoutePath: string;
  navigate: (path: string) => void;
  origin: string;
  queryParams: Record<string, string>;
  routeParams: Record<string, string>;
};

const RouterContext = createContext<RouterContextType | null>(null);

export function RouterProvider({
  children,
  initialPath,
}: {
  children: ReactNode;
  initialPath?: string;
}) {
  const hasDom = typeof window !== "undefined" &&
    typeof globalThis.document !== "undefined" &&
    typeof globalThis.location !== "undefined";
  const [currentPath, setCurrentPath] = useState(() => {
    if (!hasDom) return initialPath ?? "/";
    const { pathname, search, hash } = globalThis.location;
    const normalizedPath = normalizePathname(pathname);
    const normalizedWithSearch = `${normalizedPath}${search ?? ""}`;
    if (pathname !== normalizedPath) {
      globalThis.history.replaceState(
        {},
        "",
        `${normalizedWithSearch}${hash ?? ""}`,
      );
    }
    return normalizedWithSearch;
  });

  const origin = useMemo(() => {
    if (
      hasDom &&
      typeof globalThis.location.origin === "string" &&
      globalThis.location.origin.length > 0
    ) {
      return globalThis.location.origin;
    }
    return "http://localhost";
  }, [hasDom]);

  const { routeParams, queryParams } = useMemo(() => {
    for (const routePattern of isographAppRoutes.keys()) {
      const match = matchRouteWithParams(currentPath, routePattern);
      if (match.match) {
        return { routeParams: match.params, queryParams: match.queryParams };
      }
    }
    return { routeParams: {}, queryParams: {} };
  }, [currentPath]);

  const navigate = useCallback((path: string) => {
    if (hasDom) {
      globalThis.history.pushState({}, "", path);
    }
    startTransition(() => {
      setCurrentPath(path);
    });
  }, [hasDom]);

  // deno-lint-ignore gambit/no-useeffect-setstate gambit/no-useeffect-setstate
  useEffect(() => {
    if (!hasDom) return;
    const handlePopState = () => {
      const { pathname, search, hash } = globalThis.location;
      const normalizedPath = normalizePathname(pathname);
      const normalizedWithSearch = `${normalizedPath}${search ?? ""}`;
      if (pathname !== normalizedPath) {
        globalThis.history.replaceState(
          {},
          "",
          `${normalizedWithSearch}${hash ?? ""}`,
        );
      }
      startTransition(() => {
        setCurrentPath(normalizedWithSearch);
      });
    };

    globalThis.addEventListener("popstate", handlePopState);
    return () => globalThis.removeEventListener("popstate", handlePopState);
  }, [hasDom]);

  const contextValue: RouterContextType = useMemo(() => {
    const currentRoutePath = normalizePathname(stripQueryFromPath(currentPath));
    return {
      currentPath,
      currentRoutePath,
      navigate,
      origin,
      routeParams,
      queryParams,
    };
  }, [currentPath, navigate, origin, routeParams, queryParams]);

  return (
    <RouterContext.Provider value={contextValue}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter(): RouterContextType {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error("useRouter must be used within a RouterProvider");
  }
  return context;
}

export { RouterContext as RouterContextInternal };
export { matchRouteWithParams, stripQueryFromPath };
