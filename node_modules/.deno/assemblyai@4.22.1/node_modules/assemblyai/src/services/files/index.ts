import { readFile } from "#fs";
import { BaseService } from "../base";
import { UploadedFile, FileUploadParams, FileUploadData } from "../..";

export class FileService extends BaseService {
  /**
   * Upload a local file to AssemblyAI.
   * @param input - The local file path to upload, or a stream or buffer of the file to upload.
   * @returns A promise that resolves to the uploaded file URL.
   */
  async upload(input: FileUploadParams): Promise<string> {
    let fileData: FileUploadData;
    if (typeof input === "string") {
      if (input.startsWith("data:")) {
        fileData = dataUrlToBlob(input);
      } else {
        fileData = await readFile(input);
      }
    } else fileData = input;

    const data = await this.fetchJson<UploadedFile>("/v2/upload", {
      method: "POST",
      body: fileData as BodyInit,
      headers: {
        "Content-Type": "application/octet-stream",
      },
      duplex: "half",
    } as RequestInit);
    return data.upload_url;
  }
}

function dataUrlToBlob(dataUrl: string) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}
