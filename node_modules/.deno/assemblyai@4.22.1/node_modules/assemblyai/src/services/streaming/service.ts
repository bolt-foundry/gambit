import { WritableStream } from "#streams";
import {
  PolyfillWebSocket,
  factory as polyfillWebSocketFactory,
} from "#websocket";
import { ErrorEvent, MessageEvent, CloseEvent } from "ws";
import { conditions } from "#conditions";
import {
  StreamingEvents,
  StreamingListeners,
  StreamingTranscriberParams,
  AudioData,
  BeginEvent,
  StreamingEventMessage,
  TurnEvent,
} from "../..";
import { StreamingError, StreamingErrorMessages } from "../../utils/errors";
import { StreamingErrorTypeCodes } from "../../utils/errors/streaming";

const defaultStreamingUrl = "wss://streaming.assemblyai.com/v3/ws";
const terminateSessionMessage = `{"type":"Terminate"}`;

type BufferLike =
  | string
  | Buffer
  | DataView
  | number
  | ArrayBufferView
  | Uint8Array
  | ArrayBuffer
  | SharedArrayBuffer
  | ReadonlyArray<unknown>
  | ReadonlyArray<number>
  | { valueOf(): ArrayBuffer }
  | { valueOf(): SharedArrayBuffer }
  | { valueOf(): Uint8Array }
  | { valueOf(): ReadonlyArray<number> }
  | { valueOf(): string }
  | { [Symbol.toPrimitive](hint: string): string };

export class StreamingTranscriber {
  private apiKey?: string;
  private token?: string;
  private params: StreamingTranscriberParams;

  private socket?: PolyfillWebSocket;
  private listeners: StreamingListeners = {};
  private sessionTerminatedResolve?: () => void;

  constructor(params: StreamingTranscriberParams) {
    this.params = {
      ...params,
      websocketBaseUrl: params.websocketBaseUrl || defaultStreamingUrl,
    };

    if ("token" in params && params.token) this.token = params.token;
    if ("apiKey" in params && params.apiKey) this.apiKey = params.apiKey;

    if (!(this.token || this.apiKey)) {
      throw new Error("API key or temporary token is required.");
    }
  }

  private connectionUrl(): URL {
    const url = new URL(this.params.websocketBaseUrl ?? "");

    if (url.protocol !== "wss:") {
      throw new Error("Invalid protocol, must be wss");
    }

    const searchParams = new URLSearchParams();

    if (this.token) {
      searchParams.set("token", this.token);
    }

    searchParams.set("sample_rate", this.params.sampleRate.toString());

    if (this.params.endOfTurnConfidenceThreshold) {
      searchParams.set(
        "end_of_turn_confidence_threshold",
        this.params.endOfTurnConfidenceThreshold.toString(),
      );
    }

    if (this.params.minEndOfTurnSilenceWhenConfident) {
      searchParams.set(
        "min_end_of_turn_silence_when_confident",
        this.params.minEndOfTurnSilenceWhenConfident.toString(),
      );
    }

    if (this.params.maxTurnSilence) {
      searchParams.set(
        "max_turn_silence",
        this.params.maxTurnSilence.toString(),
      );
    }

    if (this.params.vadThreshold !== undefined) {
      searchParams.set("vad_threshold", this.params.vadThreshold.toString());
    }

    if (this.params.formatTurns) {
      searchParams.set("format_turns", this.params.formatTurns.toString());
    }

    if (this.params.encoding) {
      searchParams.set("encoding", this.params.encoding.toString());
    }

    if (this.params.keytermsPrompt) {
      searchParams.set(
        "keyterms_prompt",
        JSON.stringify(this.params.keytermsPrompt),
      );
    } else if (this.params.keyterms) {
      console.warn(
        "[Deprecation Warning] `keyterms` is deprecated and will be removed in a future release. Please use `keytermsPrompt` instead.",
      );
      searchParams.set("keyterms_prompt", JSON.stringify(this.params.keyterms));
    }

    if (this.params.filterProfanity) {
      searchParams.set(
        "filter_profanity",
        this.params.filterProfanity.toString(),
      );
    }

    if (this.params.speechModel) {
      searchParams.set("speech_model", this.params.speechModel.toString());
    }

    if (this.params.languageDetection !== undefined) {
      searchParams.set(
        "language_detection",
        this.params.languageDetection.toString(),
      );
    }

    if (this.params.inactivityTimeout !== undefined) {
      searchParams.set(
        "inactivity_timeout",
        this.params.inactivityTimeout.toString(),
      );
    }

    url.search = searchParams.toString();

    return url;
  }

  on(event: "open", listener: (event: BeginEvent) => void): void;
  on(event: "turn", listener: (event: TurnEvent) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number, reason: string) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: StreamingEvents, listener: (...args: any[]) => void) {
    this.listeners[event] = listener;
  }

  connect() {
    return new Promise<BeginEvent>((resolve) => {
      if (this.socket) {
        throw new Error("Already connected");
      }

      const url = this.connectionUrl();

      if (this.token) {
        this.socket = polyfillWebSocketFactory(url.toString());
      } else {
        if (conditions.browser) {
          console.warn(
            `API key authentication is not supported for the StreamingTranscriber in browser environment. Use temporary token authentication instead.
Learn more at https://github.com/AssemblyAI/assemblyai-node-sdk/blob/main/docs/compat.md#browser-compatibility.`,
          );
        }

        this.socket = polyfillWebSocketFactory(url.toString(), {
          headers: { Authorization: this.apiKey },
        });
      }

      this.socket.binaryType = "arraybuffer";

      this.socket.onopen = () => {};

      this.socket.onclose = ({ code, reason }: CloseEvent) => {
        if (!reason) {
          if (code in StreamingErrorMessages) {
            reason = StreamingErrorMessages[code as StreamingErrorTypeCodes];
          }
        }
        this.listeners.close?.(code, reason);
      };

      this.socket.onerror = (event: ErrorEvent) => {
        if (event.error) this.listeners.error?.(event.error as Error);
        else this.listeners.error?.(new Error(event.message));
      };

      this.socket.onmessage = ({ data }: MessageEvent) => {
        const message = JSON.parse(data.toString()) as StreamingEventMessage;

        if ("error" in message) {
          this.listeners.error?.(new StreamingError(message.error));
          return;
        }

        switch (message.type) {
          case "Begin": {
            resolve(message);
            this.listeners.open?.(message);
            break;
          }
          case "Turn": {
            this.listeners.turn?.(message);
            break;
          }
          case "Termination": {
            this.sessionTerminatedResolve?.();
            break;
          }
        }
      };
    });
  }

  stream(): WritableStream<AudioData> {
    return new WritableStream<AudioData>({
      write: (chunk: AudioData) => {
        this.sendAudio(chunk);
      },
    });
  }

  sendAudio(audio: AudioData) {
    this.send(audio);
  }

  private send(data: BufferLike) {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      throw new Error("Socket is not open for communication");
    }
    this.socket.send(data);
  }

  async close(waitForSessionTermination = true) {
    if (this.socket) {
      if (this.socket.readyState === this.socket.OPEN) {
        if (waitForSessionTermination) {
          const sessionTerminatedPromise = new Promise<void>((resolve) => {
            this.sessionTerminatedResolve = resolve;
          });
          this.socket.send(terminateSessionMessage);
          await sessionTerminatedPromise;
        } else {
          this.socket.send(terminateSessionMessage);
        }
      }
      if (this.socket?.removeAllListeners) this.socket.removeAllListeners();
      this.socket.close();
    }

    this.listeners = {};
    this.socket = undefined;
  }
}
