import { BaseService } from "../base";
import { ParagraphsResponse, SentencesResponse, Transcript, TranscriptList, TranscriptParams, CreateTranscriptOptions, SubtitleFormat, RedactedAudioResponse, ListTranscriptParams, WordSearchResponse, BaseServiceParams, PollingOptions, TranscribeParams, TranscribeOptions, SubmitParams, RedactedAudioFile } from "../..";
import { FileService } from "../files";
export declare class TranscriptService extends BaseService {
    private files;
    constructor(params: BaseServiceParams, files: FileService);
    /**
     * Transcribe an audio file. This will create a transcript and wait until the transcript status is "completed" or "error".
     * @param params - The parameters to transcribe an audio file.
     * @param options - The options to transcribe an audio file.
     * @returns A promise that resolves to the transcript. The transcript status is "completed" or "error".
     */
    transcribe(params: TranscribeParams, options?: TranscribeOptions): Promise<Transcript>;
    /**
     * Submits a transcription job for an audio file. This will not wait until the transcript status is "completed" or "error".
     * @param params - The parameters to start the transcription of an audio file.
     * @returns A promise that resolves to the queued transcript.
     */
    submit(params: SubmitParams): Promise<Transcript>;
    /**
     * Create a transcript.
     * @param params - The parameters to create a transcript.
     * @param options - The options used for creating the new transcript.
     * @returns A promise that resolves to the transcript.
     * @deprecated Use `transcribe` instead to transcribe a audio file that includes polling, or `submit` to transcribe a audio file without polling.
     */
    create(params: TranscriptParams, options?: CreateTranscriptOptions): Promise<Transcript>;
    /**
     * Wait until the transcript ready, either the status is "completed" or "error".
     * @param transcriptId - The ID of the transcript.
     * @param options - The options to wait until the transcript is ready.
     * @returns A promise that resolves to the transcript. The transcript status is "completed" or "error".
     */
    waitUntilReady(transcriptId: string, options?: PollingOptions): Promise<Transcript>;
    /**
     * Retrieve a transcript.
     * @param id - The identifier of the transcript.
     * @returns A promise that resolves to the transcript.
     */
    get(id: string): Promise<Transcript>;
    /**
     * Retrieves a page of transcript listings.
     * @param params - The parameters to filter the transcript list by, or the URL to retrieve the transcript list from.
     */
    list(params?: ListTranscriptParams | string): Promise<TranscriptList>;
    /**
     * Delete a transcript
     * @param id - The identifier of the transcript.
     * @returns A promise that resolves to the transcript.
     */
    delete(id: string): Promise<Transcript>;
    /**
     * Search through the transcript for a specific set of keywords.
     * You can search for individual words, numbers, or phrases containing up to five words or numbers.
     * @param id - The identifier of the transcript.
     * @param words - Keywords to search for.
     * @returns A promise that resolves to the sentences.
     */
    wordSearch(id: string, words: string[]): Promise<WordSearchResponse>;
    /**
     * Retrieve all sentences of a transcript.
     * @param id - The identifier of the transcript.
     * @returns A promise that resolves to the sentences.
     */
    sentences(id: string): Promise<SentencesResponse>;
    /**
     * Retrieve all paragraphs of a transcript.
     * @param id - The identifier of the transcript.
     * @returns A promise that resolves to the paragraphs.
     */
    paragraphs(id: string): Promise<ParagraphsResponse>;
    /**
     * Retrieve subtitles of a transcript.
     * @param id - The identifier of the transcript.
     * @param format - The format of the subtitles.
     * @param chars_per_caption - The maximum number of characters per caption.
     * @returns A promise that resolves to the subtitles text.
     */
    subtitles(id: string, format?: SubtitleFormat, chars_per_caption?: number): Promise<string>;
    /**
     * Retrieve the redacted audio URL of a transcript.
     * @param id - The identifier of the transcript.
     * @returns A promise that resolves to the details of the redacted audio.
     * @deprecated Use `redactedAudio` instead.
     */
    redactions(id: string): Promise<RedactedAudioResponse>;
    /**
     * Retrieve the redacted audio URL of a transcript.
     * @param id - The identifier of the transcript.
     * @returns A promise that resolves to the details of the redacted audio.
     */
    redactedAudio(id: string): Promise<RedactedAudioResponse>;
    /**
     * Retrieve the redacted audio file of a transcript.
     * @param id - The identifier of the transcript.
     * @returns A promise that resolves to the fetch HTTP response of the redacted audio file.
     */
    redactedAudioFile(id: string): Promise<RedactedAudioFile>;
}
