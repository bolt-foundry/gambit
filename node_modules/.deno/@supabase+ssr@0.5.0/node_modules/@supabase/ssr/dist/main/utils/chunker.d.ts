interface Chunk {
    name: string;
    value: string;
}
export declare const MAX_CHUNK_SIZE = 3180;
export declare function isChunkLike(cookieName: string, key: string): boolean;
/**
 * create chunks from a string and return an array of object
 */
export declare function createChunks(key: string, value: string, chunkSize?: number): Chunk[];
export declare function combineChunks(key: string, retrieveChunk: (name: string) => Promise<string | null | undefined> | string | null | undefined): Promise<string | null>;
export declare function deleteChunks(key: string, retrieveChunk: (name: string) => Promise<string | null | undefined> | string | null | undefined, removeChunk: (name: string) => Promise<void> | void): Promise<void>;
export {};
