export const { WritableStream } =
  typeof window !== "undefined"
    ? window
    : typeof global !== "undefined"
      ? global
      : globalThis;
