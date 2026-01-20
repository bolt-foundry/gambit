import ws from 'ws';

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

const { WritableStream } = typeof window !== "undefined"
    ? window
    : typeof global !== "undefined"
        ? global
        : globalThis;

const factory = (url, params) => new ws(url, params);

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
        var _a, _b;
        this.listeners = {};
        this.realtimeUrl = (_a = params.realtimeUrl) !== null && _a !== void 0 ? _a : defaultRealtimeUrl;
        this.sampleRate = (_b = params.sampleRate) !== null && _b !== void 0 ? _b : 16000;
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
                var _a, _b;
                if (!reason) {
                    if (code in RealtimeErrorMessages) {
                        reason = RealtimeErrorMessages[code];
                    }
                }
                (_b = (_a = this.listeners).close) === null || _b === void 0 ? void 0 : _b.call(_a, code, reason);
            };
            this.socket.onerror = (event) => {
                var _a, _b, _c, _d;
                if (event.error)
                    (_b = (_a = this.listeners).error) === null || _b === void 0 ? void 0 : _b.call(_a, event.error);
                else
                    (_d = (_c = this.listeners).error) === null || _d === void 0 ? void 0 : _d.call(_c, new Error(event.message));
            };
            this.socket.onmessage = ({ data }) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
                const message = JSON.parse(data.toString());
                if ("error" in message) {
                    (_b = (_a = this.listeners).error) === null || _b === void 0 ? void 0 : _b.call(_a, new RealtimeError(message.error));
                    return;
                }
                switch (message.message_type) {
                    case "SessionBegins": {
                        const openObject = {
                            sessionId: message.session_id,
                            expiresAt: new Date(message.expires_at),
                        };
                        resolve(openObject);
                        (_d = (_c = this.listeners).open) === null || _d === void 0 ? void 0 : _d.call(_c, openObject);
                        break;
                    }
                    case "PartialTranscript": {
                        // message.created is actually a string when coming from the socket
                        message.created = new Date(message.created);
                        (_f = (_e = this.listeners).transcript) === null || _f === void 0 ? void 0 : _f.call(_e, message);
                        (_h = (_g = this.listeners)["transcript.partial"]) === null || _h === void 0 ? void 0 : _h.call(_g, message);
                        break;
                    }
                    case "FinalTranscript": {
                        // message.created is actually a string when coming from the socket
                        message.created = new Date(message.created);
                        (_k = (_j = this.listeners).transcript) === null || _k === void 0 ? void 0 : _k.call(_j, message);
                        (_m = (_l = this.listeners)["transcript.final"]) === null || _m === void 0 ? void 0 : _m.call(_l, message);
                        break;
                    }
                    case "SessionInformation": {
                        (_p = (_o = this.listeners).session_information) === null || _p === void 0 ? void 0 : _p.call(_o, message);
                        break;
                    }
                    case "SessionTerminated": {
                        (_q = this.sessionTerminatedResolve) === null || _q === void 0 ? void 0 : _q.call(this);
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
    close() {
        return __awaiter(this, arguments, void 0, function* (waitForSessionTermination = true) {
            var _a;
            if (this.socket) {
                if (this.socket.readyState === this.socket.OPEN) {
                    if (waitForSessionTermination) {
                        const sessionTerminatedPromise = new Promise((resolve) => {
                            this.sessionTerminatedResolve = resolve;
                        });
                        this.socket.send(terminateSessionMessage);
                        yield sessionTerminatedPromise;
                    }
                    else {
                        this.socket.send(terminateSessionMessage);
                    }
                }
                if ((_a = this.socket) === null || _a === void 0 ? void 0 : _a.removeAllListeners)
                    this.socket.removeAllListeners();
                this.socket.close();
            }
            this.listeners = {};
            this.socket = undefined;
        });
    }
}
/**
 * @deprecated Use RealtimeTranscriber instead
 */
class RealtimeService extends RealtimeTranscriber {
}

export { RealtimeService, RealtimeTranscriber };
