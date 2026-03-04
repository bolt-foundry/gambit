// Temporary compile shim during GraphQL cutover.
// TODO: remove this file and migrate callsites to direct GraphQL/Isograph APIs.

export async function graphqlFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return await fetch(path, init);
}
