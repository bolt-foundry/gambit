const { WritableStream } = typeof window !== "undefined"
    ? window
    : typeof global !== "undefined"
        ? global
        : globalThis;

const PolyfillWebSocket = WebSocket ?? global?.WebSocket ?? window?.WebSocket ?? self?.WebSocket;
const factory = (url, params) => {
    if (params) {
        return new PolyfillWebSocket(url, params);
    }
    return new PolyfillWebSocket(url);
};

const RealtimeErrorType = {
    BadSampleRate: 4000,
    AuthFailed: 4001,
    /**
     * @deprecated Use InsufficientFunds or FreeTierUser instead
     */
    InsufficientFundsOrFreeAccount: 4002,
    InsufficientFunds: 4002,
    FreeTierUser: 4003,
    NonexistentSessionId: 4004,
    SessionExpired: 4008,
    ClosedSession: 4010,
    RateLimited: 4029,
    UniqueSessionViolation: 4030,
    SessionTimeout: 4031,
    AudioTooShort: 4032,
    AudioTooLong: 4033,
    AudioTooSmallToTranscode: 4034,
    /**
     * @deprecated Don't use
     */
    BadJson: 4100,
    BadSchema: 4101,
    TooManyStreams: 4102,
    Reconnected: 4103,
    /**
     * @deprecated Don't use
     */
    ReconnectAttemptsExhausted: 1013,
    WordBoostParameterParsingFailed: 4104,
};
const RealtimeErrorMessages = {
    [RealtimeErrorType.BadSampleRate]: "Sample rate must be a positive integer",
    [RealtimeErrorType.AuthFailed]: "Not Authorized",
    [RealtimeErrorType.InsufficientFunds]: "Insufficient funds",
    [RealtimeErrorType.FreeTierUser]: "This feature is paid-only and requires you to add a credit card. Please visit https://app.assemblyai.com/ to add a credit card to your account.",
    [RealtimeErrorType.NonexistentSessionId]: "Session ID does not exist",
    [RealtimeErrorType.SessionExpired]: "Session has expired",
    [RealtimeErrorType.ClosedSession]: "Session is closed",
    [RealtimeErrorType.RateLimited]: "Rate limited",
    [RealtimeErrorType.UniqueSessionViolation]: "Unique session violation",
    [RealtimeErrorType.SessionTimeout]: "Session Timeout",
    [RealtimeErrorType.AudioTooShort]: "Audio too short",
    [RealtimeErrorType.AudioTooLong]: "Audio too long",
    [RealtimeErrorType.AudioTooSmallToTranscode]: "Audio too small to transcode",
    [RealtimeErrorType.BadJson]: "Bad JSON",
    [RealtimeErrorType.BadSchema]: "Bad schema",
    [RealtimeErrorType.TooManyStreams]: "Too many streams",
    [RealtimeErrorType.Reconnected]: "This session has been reconnected. This WebSocket is no longer valid.",
    [RealtimeErrorType.ReconnectAttemptsExhausted]: "Reconnect attempts exhausted",
    [RealtimeErrorType.WordBoostParameterParsingFailed]: "Could not parse word boost parameter",
};
class RealtimeError extends Error {
}

const defaultRealtimeUrl = "wss://api.assemblyai.com/v2/realtime/ws";
const forceEndOfUtteranceMessage = `{"force_end_utterance":true}`;
const terminateSessionMessage = `{"terminate_session":true}`;
/**
 * RealtimeTranscriber connects to the Streaming Speech-to-Text API and lets you transcribe audio in real-time.
 */
class RealtimeTranscriber {
    /**
     * Create a new RealtimeTranscriber.
     * @param params - Parameters to configure the RealtimeTranscriber
     */
    constructor(params) {
        this.listeners = {};
        this.realtimeUrl = params.realtimeUrl ?? defaultRealtimeUrl;
        this.sampleRate = params.sampleRate ?? 16_000;
        this.wordBoost = params.wordBoost;
        this.encoding = params.encoding;
        this.endUtteranceSilenceThreshold = params.endUtteranceSilenceThreshold;
        this.disablePartialTranscripts = params.disablePartialTranscripts;
        if ("token" in params && params.token)
            this.token = params.token;
        if ("apiKey" in params && params.apiKey)
            this.apiKey = params.apiKey;
        if (!(this.token || this.apiKey)) {
            throw new Error("API key or temporary token is required.");
        }
    }
    connectionUrl() {
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
            searchParams.set("disable_partial_transcripts", this.disablePartialTranscripts.toString());
        }
        url.search = searchParams.toString();
        return url;
    }
    /**
     * Add a listener for an event.
     * @param event - The event to listen for.
     * @param listener - The function to call when the event is emitted.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event, listener) {
        this.listeners[event] = listener;
    }
    /**
     * Connect to the server and begin a new session.
     * @returns A promise that resolves when the connection is established and the session begins.
     */
    connect() {
        return new Promise((resolve) => {
            if (this.socket) {
                throw new Error("Already connected");
            }
            const url = this.connectionUrl();
            if (this.token) {
                this.socket = factory(url.toString());
            }
            else {
                {
                    console.warn(`API key authentication is not supported for the RealtimeTranscriber in browser environment. Use temporary token authentication instead.
Learn more at https://github.com/AssemblyAI/assemblyai-node-sdk/blob/main/docs/compat.md#browser-compatibility.`);
                }
                this.socket = factory(url.toString(), {
                    headers: { Authorization: this.apiKey },
                });
            }
            this.socket.binaryType = "arraybuffer";
            this.socket.onopen = () => {
                if (this.endUtteranceSilenceThreshold === undefined ||
                    this.endUtteranceSilenceThreshold === null) {
                    return;
                }
                this.configureEndUtteranceSilenceThreshold(this.endUtteranceSilenceThreshold);
            };
            this.socket.onclose = ({ code, reason }) => {
                if (!reason) {
                    if (code in RealtimeErrorMessages) {
                        reason = RealtimeErrorMessages[code];
                    }
                }
                this.listeners.close?.(code, reason);
            };
            this.socket.onerror = (event) => {
                if (event.error)
                    this.listeners.error?.(event.error);
                else
                    this.listeners.error?.(new Error(event.message));
            };
            this.socket.onmessage = ({ data }) => {
                const message = JSON.parse(data.toString());
                if ("error" in message) {
                    this.listeners.error?.(new RealtimeError(message.error));
                    return;
                }
                switch (message.message_type) {
                    case "SessionBegins": {
                        const openObject = {
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
    sendAudio(audio) {
        this.send(audio);
    }
    /**
     * Create a writable stream that can be used to send audio data to the server.
     * @returns A writable stream that can be used to send audio data to the server.
     */
    stream() {
        return new WritableStream({
            write: (chunk) => {
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
    configureEndUtteranceSilenceThreshold(threshold) {
        this.send(`{"end_utterance_silence_threshold":${threshold}}`);
    }
    send(data) {
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
                    const sessionTerminatedPromise = new Promise((resolve) => {
                        this.sessionTerminatedResolve = resolve;
                    });
                    this.socket.send(terminateSessionMessage);
                    await sessionTerminatedPromise;
                }
                else {
                    this.socket.send(terminateSessionMessage);
                }
            }
            if (this.socket?.removeAllListeners)
                this.socket.removeAllListeners();
            this.socket.close();
        }
        this.listeners = {};
        this.socket = undefined;
    }
}
/**
 * @deprecated Use RealtimeTranscriber instead
 */
class RealtimeService extends RealtimeTranscriber {
}

export { RealtimeService, RealtimeTranscriber };
