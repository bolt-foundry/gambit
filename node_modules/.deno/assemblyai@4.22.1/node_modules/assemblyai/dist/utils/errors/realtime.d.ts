declare const RealtimeErrorType: {
    readonly BadSampleRate: 4000;
    readonly AuthFailed: 4001;
    /**
     * @deprecated Use InsufficientFunds or FreeTierUser instead
     */
    readonly InsufficientFundsOrFreeAccount: 4002;
    readonly InsufficientFunds: 4002;
    readonly FreeTierUser: 4003;
    readonly NonexistentSessionId: 4004;
    readonly SessionExpired: 4008;
    readonly ClosedSession: 4010;
    readonly RateLimited: 4029;
    readonly UniqueSessionViolation: 4030;
    readonly SessionTimeout: 4031;
    readonly AudioTooShort: 4032;
    readonly AudioTooLong: 4033;
    readonly AudioTooSmallToTranscode: 4034;
    /**
     * @deprecated Don't use
     */
    readonly BadJson: 4100;
    readonly BadSchema: 4101;
    readonly TooManyStreams: 4102;
    readonly Reconnected: 4103;
    /**
     * @deprecated Don't use
     */
    readonly ReconnectAttemptsExhausted: 1013;
    readonly WordBoostParameterParsingFailed: 4104;
};
type RealtimeErrorTypeCodes = (typeof RealtimeErrorType)[keyof typeof RealtimeErrorType];
declare const RealtimeErrorMessages: Record<RealtimeErrorTypeCodes, string>;
declare class RealtimeError extends Error {
}
export { RealtimeError, RealtimeErrorType, RealtimeErrorTypeCodes, RealtimeErrorMessages, };
