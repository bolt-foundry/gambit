import { createReadStream } from "fs";
import { Readable } from "stream";

export const readFile = async (path: string) =>
  Readable.toWeb(
    createReadStream(path),
  ) as unknown as ReadableStream<Uint8Array>;
