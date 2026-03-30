export function isRedirect(
  result: unknown,
): result is { status: 302; headers: { Location: string } } {
  return (
    result !== null &&
    typeof result === "object" &&
    "status" in result &&
    result.status === 302 &&
    "headers" in result &&
    typeof (result as Record<string, unknown>).headers === "object" &&
    (result as Record<string, unknown>).headers !== null &&
    "Location" in
      ((result as Record<string, unknown>).headers as Record<
        string,
        unknown
      >) &&
    typeof ((result as Record<string, unknown>).headers as Record<
        string,
        unknown
      >).Location === "string"
  );
}

export function createServerRedirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
    },
  });
}

export function getRedirectFromEntrypoint(
  entrypoint: unknown,
): { location: string } | null {
  try {
    const entrypointObj = entrypoint as Record<string, unknown>;
    const readerWithRefetchQueries = entrypointObj?.readerWithRefetchQueries as
      | Record<string, unknown>
      | undefined;
    const readerArtifact = readerWithRefetchQueries?.readerArtifact as
      | Record<string, unknown>
      | undefined;
    const resolver = readerArtifact?.resolver as
      | ((data: unknown, props: unknown) => unknown)
      | undefined;

    if (!resolver) return null;

    const result = resolver(
      { data: {}, parameters: {}, startUpdate: () => {} },
      {},
    );
    if (isRedirect(result)) {
      return { location: result.headers.Location };
    }
    return null;
  } catch {
    return null;
  }
}
