declare const Bun: {
  file(path: string): BunFile;
};
declare type BunFile = {
  stream(): ReadableStream<Uint8Array>;
};

export const readFile = async (path: string) => Bun.file(path).stream();
