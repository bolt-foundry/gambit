import { WritableStream } from "#streams";
import { conditions } from "#conditions";
import {
  PolyfillWebSocket,
  factory as polyfillWebSocketFactory,
} from "#websocket";
import { ErrorEvent, MessageEvent, CloseEvent } from "ws";
import {
  RealtimeEvents,
  RealtimeListeners,
  RealtimeTranscriberParams,
  RealtimeMessage,
  RealtimeTranscript,
  PartialTranscript,
  FinalTranscript,
  SessionBeginsEventData,
  AudioEncoding,
  AudioData,
  SessionInformation,
} from "../..";
import { RealtimeError, RealtimeErrorMessages } from "../../utils/errors";
import { RealtimeErrorTypeCodes } from "../../utils/errors/realtime";

const defaultRealtimeUrl = "wss://api.assemblyai.com/v2/realtime/ws";
const forceEndOfUtteranceMessage = `{"force_end_utterance":true}`;
const terminateSessionMessage = `{"terminate_session":true}`;

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

/**
 * RealtimeTranscriber connects to the Streaming Speech-to-Text API and lets you transcribe audio in real-time.
 */
export class RealtimeTranscriber {
  private realtimeUrl: string;
  private sampleRate: number;
  private wordBoost?: string[];
  private encoding?: AudioEncoding;
  private apiKey?: string;
  private token?: string;
  private endUtteranceSilenceThreshold?: number;
  private disablePartialTranscripts?: boolean;

  private socket?: PolyfillWebSocket;
  private listeners: RealtimeListeners = {};
  private sessionTerminatedResolve?: () => void;

  /**
   * Create a new RealtimeTranscriber.
   * @param params - Parameters to configure the RealtimeTranscriber
   */
  constructor(params: RealtimeTranscriberParams) {
    this.realtimeUrl = params.realtimeUrl ?? defaultRealtimeUrl;
    this.sampleRate = params.sampleRate ?? 16_000;
    this.wordBoost = params.wordBoost;
    this.encoding = params.encoding;
    this.endUtteranceSilenceThreshold = params.endUtteranceSilenceThreshold;
    this.disablePartialTranscripts = params.disablePartialTranscripts;
    if ("token" in params && params.token) this.token = params.token;
    if ("apiKey" in params && params.apiKey) this.apiKey = params.apiKey;

    if (!(this.token || this.apiKey)) {
      throw new Error("API key or temporary token is required.");
    }
  }

  private connectionUrl(): URL {
    const url = new URL(this.realtimeUrl);

    if (url.protocol !== "wss:") {
      throw new Error("Invalid protocol, must be wss");
    }

    const searchParams = new URLSearchParams();
    if (this.token) {
      searchParams.set("token", this.token);
    }
    searchParams.set("sample_rate", this.sampleRate.toString());
    if (this.wordBoost && this.wordBoost.length > 0) {
      searchParams.set("word_boost", JSON.stringify(this.wordBoost));
    }
    if (this.encoding) {
      searchParams.set("encoding", this.encoding);
    }

    searchParams.set("enable_extra_session_information", "true");

    if (this.disablePartialTranscripts) {
      searchParams.set(
        "disable_partial_transcripts",
        this.disablePartialTranscripts.toString(),
      );
    }
    url.search = searchParams.toString();

    return url;
  }

  /**
   * Listen for the open event which is emitted when the connection is established and the session begins.
   * @param event - The open event.
   * @param listener - The function to call when the event is emitted.
   */
  on(event: "open", listener: (event: SessionBeginsEventData) => void): void;
  /**
   * Listen for the transcript event which is emitted when a partian or final transcript is received.
   * @param event - The transcript event.
   * @param listener - The function to call when the event is emitted.
   */
  on(
    event: "transcript",
    listener: (transcript: RealtimeTranscript) => void,
  ): void;
  /**
   * Listen for the partial transcript event which is emitted when a partial transcript is received.
   * @param event - The partial transcript event.
   * @param listener - The function to call when the event is emitted.
   */
  on(
    event: "transcript.partial",
    listener: (transcript: PartialTranscript) => void,
  ): void;
  /**
   * Listen for the final transcript event which is emitted when a final transcript is received.
   * @param event - The final transcript event.
   * @param listener - The function to call when the event is emitted.
   */
  on(
    event: "transcript.final",
    listener: (transcript: FinalTranscript) => void,
  ): void;
  /**
   * Listen for the session information event which is emitted when session information is received.
   * The session information is sent right before the session is terminated.
   * @param event - The session information event.
   * @param listener - The function to call when the event is emitted.
   */
  on(
    event: "session_information",
    listener: (info: SessionInformation) => void,
  ): void;
  /**
   * Listen for the error event which is emitted when an error occurs.
   * @param event - The error event.
   * @param listener - The function to call when the event is emitted.
   */
  on(event: "error", listener: (error: Error) => void): void;
  /**
   * Listen for the close event which is emitted when the connection is closed.
   * @param event - The close event.
   * @param listener - The function to call when the event is emitted.
   */
  on(event: "close", listener: (code: number, reason: string) => void): void;
  /**
   * Add a listener for an event.
   * @param event - The event to listen for.
   * @param listener - The function to call when the event is emitted.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: RealtimeEvents, listener: (...args: any[]) => void) {
    this.listeners[event] = listener;
  }

  /**
   * Connect to the server and begin a new session.
   * @returns A promise that resolves when the connection is established and the session begins.
   */
  connect() {
    return new Promise<SessionBeginsEventData>((resolve) => {
      if (this.socket) {
        throw new Error("Already connected");
      }

      const url = this.connectionUrl();

      if (this.token) {
        this.socket = polyfillWebSocketFactory(url.toString());
      } else {
        if (conditions.browser) {
          console.warn(
            `API key authentication is not supported for the RealtimeTranscriber in browser environment. Use temporary token authentication instead.
Learn more at https://github.com/AssemblyAI/assemblyai-node-sdk/blob/main/docs/compat.md#browser-compatibility.`,
          );
        }

        this.socket = polyfillWebSocketFactory(url.toString(), {
          headers: { Authorization: this.apiKey },
        });
      }
      this.socket!.binaryType = "arraybuffer";

      this.socket!.onopen = () => {
        if (
          this.endUtteranceSilenceThreshold === undefined ||
          this.endUtteranceSilenceThreshold === null
        ) {
          return;
        }
        this.configureEndUtteranceSilenceThreshold(
          this.endUtteranceSilenceThreshold,
        );
      };

      this.socket!.onclose = ({ code, reason }: CloseEvent) => {
        if (!reason) {
          if (code in RealtimeErrorMessages) {
            reason = RealtimeErrorMessages[code as RealtimeErrorTypeCodes];
          }
        }
        this.listeners.close?.(code, reason);
      };

      this.socket!.onerror = (event: ErrorEvent) => {
        if (event.error) this.listeners.error?.(event.error as Error);
        else this.listeners.error?.(new Error(event.message));
      };

      this.socket!.onmessage = ({ data }: MessageEvent) => {
        const message = JSON.parse(data.toString()) as RealtimeMessage;
        if ("error" in message) {
          this.listeners.error?.(new RealtimeError(message.error));
          return;
        }
        switch (message.message_type) {
          case "SessionBegins": {
            const openObject: SessionBeginsEventData = {
              sessionId: message.session_id,
              expiresAt: new Date(message.expires_at),
            };
            resolve(openObject);
            this.listeners.open?.(openObject);
            break;
          }
          case "PartialTranscript": {
            // message.created is actually a string when coming from the socket
            message.created = new Date(message.created);
            this.listeners.transcript?.(message);
            this.listeners["transcript.partial"]?.(message);
            break;
          }
          case "FinalTranscript": {
            // message.created is actually a string when coming from the socket
            message.created = new Date(message.created);
            this.listeners.transcript?.(message);
            this.listeners["transcript.final"]?.(message);
            break;
          }
          case "SessionInformation": {
            this.listeners.session_information?.(message);
            break;
          }
          case "SessionTerminated": {
            this.sessionTerminatedResolve?.();
            break;
          }
        }
      };
    });
  }

  /**
   * Send audio data to the server.
   * @param audio - The audio data to send to the server.
   */
  sendAudio(audio: AudioData) {
    this.send(audio);
  }

  /**
   * Create a writable stream that can be used to send audio data to the server.
   * @returns A writable stream that can be used to send audio data to the server.
   */
  stream(): WritableStream<AudioData> {
    return new WritableStream<AudioData>({
      write: (chunk: AudioData) => {
        this.sendAudio(chunk);
      },
    });
  }

  /**
   * Manually end an utterance
   */
  forceEndUtterance() {
    this.send(forceEndOfUtteranceMessage);
  }

  /**
   * Configure the threshold for how long to wait before ending an utterance. Default is 700ms.
   * @param threshold - The duration of the end utterance silence threshold in milliseconds.
   * This value must be an integer between 0 and 20_000.
   */
  configureEndUtteranceSilenceThreshold(threshold: number) {
    this.send(`{"end_utterance_silence_threshold":${threshold}}`);
  }

  private send(data: BufferLike) {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      throw new Error("Socket is not open for communication");
    }
    this.socket.send(data);
  }

  /**
   * Close the connection to the server.
   * @param waitForSessionTermination - If true, the method will wait for the session to be terminated before closing the connection.
   * While waiting for the session to be terminated, you will receive the final transcript and session information.
   */
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

/**
 * @deprecated Use RealtimeTranscriber instead
 */
export class RealtimeService extends RealtimeTranscriber {}
