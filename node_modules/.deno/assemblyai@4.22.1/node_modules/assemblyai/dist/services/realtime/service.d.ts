import { RealtimeTranscriberParams, RealtimeTranscript, PartialTranscript, FinalTranscript, SessionBeginsEventData, AudioData, SessionInformation } from "../..";
/**
 * RealtimeTranscriber connects to the Streaming Speech-to-Text API and lets you transcribe audio in real-time.
 */
export declare class RealtimeTranscriber {
    private realtimeUrl;
    private sampleRate;
    private wordBoost?;
    private encoding?;
    private apiKey?;
    private token?;
    private endUtteranceSilenceThreshold?;
    private disablePartialTranscripts?;
    private socket?;
    private listeners;
    private sessionTerminatedResolve?;
    /**
     * Create a new RealtimeTranscriber.
     * @param params - Parameters to configure the RealtimeTranscriber
     */
    constructor(params: RealtimeTranscriberParams);
    private connectionUrl;
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
    on(event: "transcript", listener: (transcript: RealtimeTranscript) => void): void;
    /**
     * Listen for the partial transcript event which is emitted when a partial transcript is received.
     * @param event - The partial transcript event.
     * @param listener - The function to call when the event is emitted.
     */
    on(event: "transcript.partial", listener: (transcript: PartialTranscript) => void): void;
    /**
     * Listen for the final transcript event which is emitted when a final transcript is received.
     * @param event - The final transcript event.
     * @param listener - The function to call when the event is emitted.
     */
    on(event: "transcript.final", listener: (transcript: FinalTranscript) => void): void;
    /**
     * Listen for the session information event which is emitted when session information is received.
     * The session information is sent right before the session is terminated.
     * @param event - The session information event.
     * @param listener - The function to call when the event is emitted.
     */
    on(event: "session_information", listener: (info: SessionInformation) => void): void;
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
     * Connect to the server and begin a new session.
     * @returns A promise that resolves when the connection is established and the session begins.
     */
    connect(): Promise<SessionBeginsEventData>;
    /**
     * Send audio data to the server.
     * @param audio - The audio data to send to the server.
     */
    sendAudio(audio: AudioData): void;
    /**
     * Create a writable stream that can be used to send audio data to the server.
     * @returns A writable stream that can be used to send audio data to the server.
     */
    stream(): WritableStream<AudioData>;
    /**
     * Manually end an utterance
     */
    forceEndUtterance(): void;
    /**
     * Configure the threshold for how long to wait before ending an utterance. Default is 700ms.
     * @param threshold - The duration of the end utterance silence threshold in milliseconds.
     * This value must be an integer between 0 and 20_000.
     */
    configureEndUtteranceSilenceThreshold(threshold: number): void;
    private send;
    /**
     * Close the connection to the server.
     * @param waitForSessionTermination - If true, the method will wait for the session to be terminated before closing the connection.
     * While waiting for the session to be terminated, you will receive the final transcript and session information.
     */
    close(waitForSessionTermination?: boolean): Promise<void>;
}
/**
 * @deprecated Use RealtimeTranscriber instead
 */
export declare class RealtimeService extends RealtimeTranscriber {
}
