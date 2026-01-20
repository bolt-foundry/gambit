import { BaseService } from "../base";
import { FileUploadParams } from "../..";
export declare class FileService extends BaseService {
    /**
     * Upload a local file to AssemblyAI.
     * @param input - The local file path to upload, or a stream or buffer of the file to upload.
     * @returns A promise that resolves to the uploaded file URL.
     */
    upload(input: FileUploadParams): Promise<string>;
}
