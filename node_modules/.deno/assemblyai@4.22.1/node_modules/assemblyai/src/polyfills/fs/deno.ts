declare const Deno: {
  open(path: string): Promise<DenoFile>;
};
declare type DenoFile = {
  readable: ReadableStream<Uint8Array>;
};

export const readFile = async (path: string) =>
  (await Deno.open(path)).readable;
