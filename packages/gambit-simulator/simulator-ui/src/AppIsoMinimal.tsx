import React, { Suspense, useEffect, useRef } from "react";
import { useLazyReference, useResult } from "@isograph/react";

function ErrorPanel(props: { error: unknown }) {
  const { error } = props;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const cause = error instanceof Error
    ? (error as { cause?: unknown }).cause
    : undefined;
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 12px 0" }}>Isograph runtime error</h2>
      <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{message}</pre>
      {cause !== undefined && (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
          {JSON.stringify(cause, null, 2)}
        </pre>
      )}
      {stack && (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{stack}</pre>
      )}
    </div>
  );
}

class IsoErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return <ErrorPanel error={this.state.error} />;
    }
    return this.props.children;
  }
}

function IsoMinimalRenderer(props: {
  // deno-lint-ignore no-explicit-any
  entrypoint: any;
  params: Record<string, string>;
  onNavigate?: (path: string) => void;
  shouldFetch?: "IfNecessary" | "No" | "Yes";
}) {
  const redirectInFlightRef = useRef<string | null>(null);
  const fetchOptions = props.shouldFetch
    ? { shouldFetch: props.shouldFetch }
    : undefined;
  const { fragmentReference } = useLazyReference(
    props.entrypoint,
    props.params,
    fetchOptions,
  ) as {
    fragmentReference: unknown;
  };
  const result = useResult(fragmentReference as never) as {
    Body?: React.FC;
    status?: number;
    headers?: Record<string, string>;
  } | null;

  useEffect(() => {
    if (result?.status !== 302) {
      redirectInFlightRef.current = null;
      return;
    }
    const location = result.headers?.Location;
    if (!location || typeof location !== "string") return;
    if (redirectInFlightRef.current === location) return;
    if (location.startsWith("/") && props.onNavigate) {
      const currentPath = (() => {
        if (typeof globalThis.location === "undefined") return null;
        const pathname = globalThis.location.pathname ?? "";
        const search = globalThis.location.search ?? "";
        return `${pathname}${search}`;
      })();
      if (currentPath === location) {
        redirectInFlightRef.current = location;
        return;
      }
      redirectInFlightRef.current = location;
      props.onNavigate(location);
      return;
    }
    if (typeof globalThis.location !== "undefined") {
      redirectInFlightRef.current = location;
      globalThis.location.replace(location);
    }
  }, [props.onNavigate, result?.headers, result?.status]);

  if (result?.status === 302) {
    return null;
  }

  const Body = result?.Body;
  if (!Body) {
    const globals = globalThis as typeof globalThis & {
      __GAMBIT_DEV__?: unknown;
    };
    const shouldLog = globals.__GAMBIT_DEV__ === true ||
      (typeof globalThis.location?.hostname === "string" &&
        globalThis.location.hostname.includes("bflocal"));
    if (shouldLog) {
      const resultRecord = result && typeof result === "object"
        ? result as Record<string, unknown>
        : null;
      const resultKeys = resultRecord ? Object.keys(resultRecord).sort() : [];
      // deno-lint-ignore no-console -- scoped dev diagnostic for entrypoint mismatch debugging
      console.error("[gambit-sim] missing entrypoint body", {
        pathname: globalThis.location?.pathname ?? null,
        params: props.params,
        status: result?.status ?? null,
        headers: result?.headers ?? null,
        hasBody: Boolean(Body),
        resultKeys,
        result,
      });
    }
    return <div>Missing entrypoint body</div>;
  }
  return <Body />;
}

export function AppIsoMinimal(props: {
  // deno-lint-ignore no-explicit-any
  entrypoint: any;
  params?: Record<string, string>;
  onNavigate?: (nextPath: string) => void;
  fallback?: React.ReactNode;
  rendererKey?: string;
  shouldFetch?: "IfNecessary" | "No" | "Yes";
}) {
  const {
    entrypoint,
    params = {},
    onNavigate,
    fallback = null,
    rendererKey,
    shouldFetch,
  } = props;

  return (
    <IsoErrorBoundary>
      <Suspense fallback={fallback}>
        <IsoMinimalRenderer
          key={rendererKey}
          entrypoint={entrypoint}
          params={params}
          onNavigate={onNavigate}
          shouldFetch={shouldFetch}
        />
      </Suspense>
    </IsoErrorBoundary>
  );
}
