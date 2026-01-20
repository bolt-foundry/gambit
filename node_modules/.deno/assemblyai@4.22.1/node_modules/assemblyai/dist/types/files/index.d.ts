/// <reference types="node" />
type FileUploadParams = string | FileUploadData;
type FileUploadData = NodeJS.ReadableStream | ReadableStream | Blob | BufferSource | ArrayBufferView | ArrayBufferLike | Uint8Array;
export type { FileUploadParams, FileUploadData };
