export const readFile = async function (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  path: string,
): Promise<ReadableStream<Uint8Array>> {
  throw new Error(
    "Interacting with the file system is not supported in this environment.",
  );
};
