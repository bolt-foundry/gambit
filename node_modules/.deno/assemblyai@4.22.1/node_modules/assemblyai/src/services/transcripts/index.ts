import { BaseService } from "../base";
import {
  ParagraphsResponse,
  SentencesResponse,
  Transcript,
  TranscriptList,
  TranscriptParams,
  CreateTranscriptOptions,
  SubtitleFormat,
  RedactedAudioResponse,
  ListTranscriptParams,
  WordSearchResponse,
  BaseServiceParams,
  PollingOptions,
  TranscribeParams,
  TranscribeOptions,
  SubmitParams,
  RedactedAudioFile,
} from "../..";
import { FileService } from "../files";
import { getPath } from "../../utils/path";

export class TranscriptService extends BaseService {
  constructor(
    params: BaseServiceParams,
    private files: FileService,
  ) {
    super(params);
  }

  /**
   * Transcribe an audio file. This will create a transcript and wait until the transcript status is "completed" or "error".
   * @param params - The parameters to transcribe an audio file.
   * @param options - The options to transcribe an audio file.
   * @returns A promise that resolves to the transcript. The transcript status is "completed" or "error".
   */
  async transcribe(
    params: TranscribeParams,
    options?: TranscribeOptions,
  ): Promise<Transcript> {
    const transcript = await this.submit(params);
    return await this.waitUntilReady(transcript.id, options);
  }

  /**
   * Submits a transcription job for an audio file. This will not wait until the transcript status is "completed" or "error".
   * @param params - The parameters to start the transcription of an audio file.
   * @returns A promise that resolves to the queued transcript.
   */
  async submit(params: SubmitParams): Promise<Transcript> {
    let audioUrl;
    let transcriptParams: TranscriptParams | undefined = undefined;
    if ("audio" in params) {
      const { audio, ...audioTranscriptParams } = params;
      if (typeof audio === "string") {
        const path = getPath(audio);
        if (path !== null) {
          // audio is local path, upload local file
          audioUrl = await this.files.upload(path);
        } else {
          if (audio.startsWith("data:")) {
            audioUrl = await this.files.upload(audio);
          } else {
            // audio is not a local path, and not a data-URI, assume it's a normal URL
            audioUrl = audio;
          }
        }
      } else {
        // audio is of uploadable type
        audioUrl = await this.files.upload(audio);
      }
      transcriptParams = { ...audioTranscriptParams, audio_url: audioUrl };
    } else {
      transcriptParams = params;
    }

    const data = await this.fetchJson<Transcript>("/v2/transcript", {
      method: "POST",
      body: JSON.stringify(transcriptParams),
    });
    return data;
  }

  /**
   * Create a transcript.
   * @param params - The parameters to create a transcript.
   * @param options - The options used for creating the new transcript.
   * @returns A promise that resolves to the transcript.
   * @deprecated Use `transcribe` instead to transcribe a audio file that includes polling, or `submit` to transcribe a audio file without polling.
   */
  async create(
    params: TranscriptParams,
    options?: CreateTranscriptOptions,
  ): Promise<Transcript> {
    const path = getPath(params.audio_url);
    if (path !== null) {
      const uploadUrl = await this.files.upload(path);
      params.audio_url = uploadUrl;
    }

    const data = await this.fetchJson<Transcript>("/v2/transcript", {
      method: "POST",
      body: JSON.stringify(params),
    });

    if (options?.poll ?? true) {
      return await this.waitUntilReady(data.id, options);
    }

    return data;
  }

  /**
   * Wait until the transcript ready, either the status is "completed" or "error".
   * @param transcriptId - The ID of the transcript.
   * @param options - The options to wait until the transcript is ready.
   * @returns A promise that resolves to the transcript. The transcript status is "completed" or "error".
   */
  async waitUntilReady(
    transcriptId: string,
    options?: PollingOptions,
  ): Promise<Transcript> {
    const pollingInterval = options?.pollingInterval ?? 3_000;
    const pollingTimeout = options?.pollingTimeout ?? -1;
    const startTime = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const transcript = await this.get(transcriptId);
      if (transcript.status === "completed" || transcript.status === "error") {
        return transcript;
      } else if (
        pollingTimeout > 0 &&
        Date.now() - startTime > pollingTimeout
      ) {
        throw new Error("Polling timeout");
      } else {
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
      }
    }
  }

  /**
   * Retrieve a transcript.
   * @param id - The identifier of the transcript.
   * @returns A promise that resolves to the transcript.
   */
  get(id: string): Promise<Transcript> {
    return this.fetchJson<Transcript>(`/v2/transcript/${id}`);
  }

  /**
   * Retrieves a page of transcript listings.
   * @param params - The parameters to filter the transcript list by, or the URL to retrieve the transcript list from.
   */
  async list(params?: ListTranscriptParams | string): Promise<TranscriptList> {
    let url = "/v2/transcript";
    if (typeof params === "string") {
      url = params;
    } else if (params) {
      url = `${url}?${new URLSearchParams(
        Object.keys(params).map((key) => [
          key,
          params[key as keyof ListTranscriptParams]?.toString() || "",
        ]),
      )}`;
    }
    const data = await this.fetchJson<TranscriptList>(url);
    for (const transcriptListItem of data.transcripts) {
      transcriptListItem.created = new Date(transcriptListItem.created);
      if (transcriptListItem.completed) {
        transcriptListItem.completed = new Date(transcriptListItem.completed);
      }
    }

    return data;
  }

  /**
   * Delete a transcript
   * @param id - The identifier of the transcript.
   * @returns A promise that resolves to the transcript.
   */
  delete(id: string): Promise<Transcript> {
    return this.fetchJson(`/v2/transcript/${id}`, { method: "DELETE" });
  }

  /**
   * Search through the transcript for a specific set of keywords.
   * You can search for individual words, numbers, or phrases containing up to five words or numbers.
   * @param id - The identifier of the transcript.
   * @param words - Keywords to search for.
   * @returns A promise that resolves to the sentences.
   */
  wordSearch(id: string, words: string[]): Promise<WordSearchResponse> {
    const params = new URLSearchParams({ words: words.join(",") });
    return this.fetchJson<WordSearchResponse>(
      `/v2/transcript/${id}/word-search?${params.toString()}`,
    );
  }

  /**
   * Retrieve all sentences of a transcript.
   * @param id - The identifier of the transcript.
   * @returns A promise that resolves to the sentences.
   */
  sentences(id: string): Promise<SentencesResponse> {
    return this.fetchJson<SentencesResponse>(`/v2/transcript/${id}/sentences`);
  }

  /**
   * Retrieve all paragraphs of a transcript.
   * @param id - The identifier of the transcript.
   * @returns A promise that resolves to the paragraphs.
   */
  paragraphs(id: string): Promise<ParagraphsResponse> {
    return this.fetchJson<ParagraphsResponse>(
      `/v2/transcript/${id}/paragraphs`,
    );
  }

  /**
   * Retrieve subtitles of a transcript.
   * @param id - The identifier of the transcript.
   * @param format - The format of the subtitles.
   * @param chars_per_caption - The maximum number of characters per caption.
   * @returns A promise that resolves to the subtitles text.
   */
  async subtitles(
    id: string,
    format: SubtitleFormat = "srt",
    chars_per_caption?: number,
  ): Promise<string> {
    let url = `/v2/transcript/${id}/${format}`;
    if (chars_per_caption) {
      const params = new URLSearchParams();
      params.set("chars_per_caption", chars_per_caption.toString());
      url += `?${params.toString()}`;
    }
    const response = await this.fetch(url);
    return await response.text();
  }

  /**
   * Retrieve the redacted audio URL of a transcript.
   * @param id - The identifier of the transcript.
   * @returns A promise that resolves to the details of the redacted audio.
   * @deprecated Use `redactedAudio` instead.
   */
  redactions(id: string): Promise<RedactedAudioResponse> {
    return this.redactedAudio(id);
  }

  /**
   * Retrieve the redacted audio URL of a transcript.
   * @param id - The identifier of the transcript.
   * @returns A promise that resolves to the details of the redacted audio.
   */
  redactedAudio(id: string): Promise<RedactedAudioResponse> {
    return this.fetchJson<RedactedAudioResponse>(
      `/v2/transcript/${id}/redacted-audio`,
    );
  }

  /**
   * Retrieve the redacted audio file of a transcript.
   * @param id - The identifier of the transcript.
   * @returns A promise that resolves to the fetch HTTP response of the redacted audio file.
   */
  async redactedAudioFile(id: string): Promise<RedactedAudioFile> {
    const { redacted_audio_url, status } = await this.redactedAudio(id);
    if (status !== "redacted_audio_ready") {
      throw new Error(`Redacted audio status is ${status}`);
    }
    const response = await fetch(redacted_audio_url);
    if (!response.ok) {
      throw new Error(`Failed to fetch redacted audio: ${response.statusText}`);
    }
    return {
      arrayBuffer: response.arrayBuffer.bind(response),
      blob: response.blob.bind(response),
      body: response.body,
      bodyUsed: response.bodyUsed,
    };
  }
}
