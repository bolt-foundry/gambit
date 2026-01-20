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
} as const;

type RealtimeErrorTypeCodes =
  (typeof RealtimeErrorType)[keyof typeof RealtimeErrorType];

const RealtimeErrorMessages: Record<RealtimeErrorTypeCodes, string> = {
  [RealtimeErrorType.BadSampleRate]: "Sample rate must be a positive integer",
  [RealtimeErrorType.AuthFailed]: "Not Authorized",
  [RealtimeErrorType.InsufficientFunds]: "Insufficient funds",
  [RealtimeErrorType.FreeTierUser]:
    "This feature is paid-only and requires you to add a credit card. Please visit https://app.assemblyai.com/ to add a credit card to your account.",
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
  [RealtimeErrorType.Reconnected]:
    "This session has been reconnected. This WebSocket is no longer valid.",
  [RealtimeErrorType.ReconnectAttemptsExhausted]:
    "Reconnect attempts exhausted",
  [RealtimeErrorType.WordBoostParameterParsingFailed]:
    "Could not parse word boost parameter",
};

class RealtimeError extends Error {}

export {
  RealtimeError,
  RealtimeErrorType,
  RealtimeErrorTypeCodes,
  RealtimeErrorMessages,
};
