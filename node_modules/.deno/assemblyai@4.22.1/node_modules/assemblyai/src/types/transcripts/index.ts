import { FileUploadParams } from "../files";
import { TranscriptParams } from "../openapi.generated";

/**
 * Options for polling.
 */
export type PollingOptions = {
  /**
   * The amount of time to wait between polling requests.
   * @defaultValue 3000 or every 3 seconds
   */
  pollingInterval?: number;
  /**
   * The maximum amount of time to wait for the transcript to be ready.
   * @defaultValue -1 which means wait forever
   */
  pollingTimeout?: number;
};

/**
 * @deprecated Use `TranscriptService.transcribe` with `TranscribeOptions`.
 */
export type CreateTranscriptOptions = {
  /**
   * Whether to poll the transcript until it is ready.
   * @defaultValue true
   */
  poll?: boolean;
} & PollingOptions;

/**
 * The audio to transcribe. This can be a public URL, a local file path, a readable file stream, or a file buffer.
 */
export type AudioToTranscribe = FileUploadParams;

/**
 * The parameters to transcribe an audio file.
 */
export type TranscribeParams =
  | ({
      /**
       * The audio to transcribe. This can be a public URL, a local file path, a readable file stream, or a file buffer.
       */
      audio: AudioToTranscribe;
    } & Omit<TranscriptParams, "audio_url">)
  | TranscriptParams;

/**
 * The parameters to start the transcription of an audio file.
 */
export type SubmitParams = TranscribeParams;

/**
 * The options to transcribe an audio file, including polling options.
 */
export type TranscribeOptions = PollingOptions;

/**
 * The PII redacted audio file, transmitted over the network.
 */
export type RedactedAudioFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  blob: () => Promise<Blob>;
  body: ReadableStream<Uint8Array> | null;
  bodyUsed: boolean;
};
