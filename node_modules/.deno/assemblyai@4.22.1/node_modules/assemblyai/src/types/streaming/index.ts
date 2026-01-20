import { AudioEncoding } from "..";

export type StreamingTranscriberParams = {
  websocketBaseUrl?: string;
  apiKey?: string;
  token?: string;
  sampleRate: number;
  encoding?: AudioEncoding;
  endOfTurnConfidenceThreshold?: number;
  minEndOfTurnSilenceWhenConfident?: number;
  maxTurnSilence?: number;
  vadThreshold?: number;
  formatTurns?: boolean;
  filterProfanity?: boolean;
  keyterms?: string[];
  keytermsPrompt?: string[];
  speechModel?: StreamingSpeechModel;
  languageDetection?: boolean;
  inactivityTimeout?: number;
};

export type StreamingEvents = "open" | "close" | "turn" | "error";

export type StreamingListeners = {
  open?: (event: BeginEvent) => void;
  close?: (code: number, reason: string) => void;
  turn?: (event: TurnEvent) => void;
  error?: (error: Error) => void;
};

export type StreamingSpeechModel =
  | "universal-streaming-english"
  | "universal-streaming-multilingual";

export type StreamingTokenParams = {
  expires_in_seconds: number;
  max_session_duration_seconds?: number;
};

export type StreamingTemporaryTokenResponse = {
  token: string;
};

export type StreamingAudioData = ArrayBufferLike;

export type BeginEvent = {
  type: "Begin";
  id: string;
  expires_at: number;
};

export type TurnEvent = {
  type: "Turn";
  turn_order: number;
  turn_is_formatted: boolean;
  end_of_turn: boolean;
  transcript: string;
  end_of_turn_confidence: number;
  words: StreamingWord[];
  language_code?: string;
  language_confidence?: number;
};

export type StreamingWord = {
  start: number;
  end: number;
  confidence: number;
  text: string;
  word_is_final: boolean;
};

export type TerminationEvent = {
  type: "Termination";
  audio_duration_seconds: number;
  session_duration_seconds: number;
};

export type StreamingTerminateSession = {
  type: "Terminate";
};

export type StreamingUpdateConfiguration = {
  type: "UpdateConfiguration";
  end_of_turn_confidence_threshold?: number;
  min_end_of_turn_silence_when_confident?: number;
  max_turn_silence?: number;
  vad_threshold?: number;
  format_turns?: boolean;
};

export type StreamingForceEndpoint = {
  type: "ForceEndpoint";
};

export type ErrorEvent = {
  error: string;
};

export type StreamingEventMessage =
  | BeginEvent
  | TurnEvent
  | TerminationEvent
  | ErrorEvent;

export type StreamingOperationMessage =
  | StreamingUpdateConfiguration
  | StreamingForceEndpoint
  | StreamingTerminateSession;
