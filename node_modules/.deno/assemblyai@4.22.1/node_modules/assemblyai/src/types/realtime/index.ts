import {
  AudioEncoding,
  FinalTranscript,
  PartialTranscript,
  RealtimeTranscript,
  RealtimeTranscriptType,
  SessionInformation,
} from "../asyncapi.generated";

type CreateRealtimeTranscriberParams = {
  /**
   * The WebSocket URL that the RealtimeTranscriber connects to
   */
  realtimeUrl?: string;
  /**
   * The sample rate of the streamed audio
   */
  sampleRate?: number;
  /**
   * Add up to 2500 characters of custom vocabulary
   */
  wordBoost?: string[];
  /**
   * The encoding of the audio data
   */
  encoding?: AudioEncoding;
  /**
   * The duration of the end utterance silence threshold in milliseconds
   */
  endUtteranceSilenceThreshold?: number;
  /**
   * Disable partial transcripts.
   * Set to `true` to not receive partial transcripts. Defaults to `false`.
   * @defaultValue false
   */
  disablePartialTranscripts?: boolean;
  /**
   * Enable extra session information.
   * Set to `true` to receive the `session_information` message before the session ends. Defaults to `false`.
   * @defaultValue true
   * @deprecated This parameter is now ignored and will be removed. Session information will always be sent.
   */
  enableExtraSessionInformation?: boolean;
} & (
  | {
      /**
       * The API key used to authenticate the RealtimeTranscriber
       * Using an API key to authenticate the RealtimeTranscriber is not supported in the browser.
       */
      apiKey?: string;
    }
  | {
      /**
       * The temporary token used to authenticate the RealtimeTranscriber
       */
      token: string;
    }
);

/**
 * @deprecated Use CreateRealtimeTranscriberParams instead
 */
type CreateRealtimeServiceParams = CreateRealtimeTranscriberParams;

type RealtimeTranscriberParams = {
  /**
   * The WebSocket URL that the RealtimeTranscriber connects to
   */
  realtimeUrl?: string;
  /**
   * The sample rate of the streamed audio
   */
  sampleRate?: number;
  /**
   * Add up to 2500 characters of custom vocabulary
   */
  wordBoost?: string[];
  /**
   * The encoding of the audio data
   */
  encoding?: AudioEncoding;
  /**
   * The duration of the end utterance silence threshold in milliseconds
   */
  endUtteranceSilenceThreshold?: number;
  /**
   * Disable partial transcripts.
   * Set to `true` to not receive partial transcripts. Defaults to `false`.
   * @defaultValue false
   */
  disablePartialTranscripts?: boolean;
  /**
   * Enable extra session information.
   * Set to `true` to receive the `session_information` message before the session ends. Defaults to `false`.
   * @defaultValue true
   * @deprecated This parameter is now ignored and will be removed. Session information will always be sent.
   */
  enableExtraSessionInformation?: boolean;
} & (
  | {
      /**
       * The API key used to authenticate the RealtimeTranscriber.
       * Using an API key to authenticate the RealtimeTranscriber is not supported in the browser.
       */
      apiKey: string;
    }
  | {
      /**
       * The temporary token used to authenticate the RealtimeTranscriber
       */
      token: string;
    }
);

/**
 * @deprecated Use RealtimeTranscriberParams instead
 */
type RealtimeServiceParams = RealtimeTranscriberParams;

type RealtimeEvents =
  | "open"
  | "close"
  | "transcript"
  | "transcript.partial"
  | "transcript.final"
  | "session_information"
  | "error";

type SessionBeginsEventData = {
  sessionId: string;
  expiresAt: Date;
};

type RealtimeListeners = {
  open?: (event: SessionBeginsEventData) => void;
  close?: (code: number, reason: string) => void;
  transcript?: (transcript: RealtimeTranscript) => void;
  "transcript.partial"?: (transcript: PartialTranscript) => void;
  "transcript.final"?: (transcript: FinalTranscript) => void;
  session_information?: (info: SessionInformation) => void;
  error?: (error: Error) => void;
};

type RealtimeTokenParams = {
  expires_in: number;
};

export type {
  CreateRealtimeTranscriberParams,
  RealtimeTranscriberParams,
  CreateRealtimeServiceParams,
  RealtimeServiceParams,
  RealtimeEvents,
  RealtimeTranscriptType,
  SessionBeginsEventData,
  RealtimeListeners,
  RealtimeTokenParams,
};
