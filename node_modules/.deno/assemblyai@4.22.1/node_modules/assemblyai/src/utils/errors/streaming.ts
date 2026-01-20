const StreamingErrorType = {
  BadSampleRate: 4000,
  AuthFailed: 4001,
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
  BadSchema: 4101,
  TooManyStreams: 4102,
  Reconnected: 4103,
} as const;

type StreamingErrorTypeCodes =
  (typeof StreamingErrorType)[keyof typeof StreamingErrorType];

const StreamingErrorMessages: Record<StreamingErrorTypeCodes, string> = {
  [StreamingErrorType.BadSampleRate]: "Sample rate must be a positive integer",
  [StreamingErrorType.AuthFailed]: "Not Authorized",
  [StreamingErrorType.InsufficientFunds]: "Insufficient funds",
  [StreamingErrorType.FreeTierUser]:
    "This feature is paid-only and requires you to add a credit card. Please visit https://app.assemblyai.com/ to add a credit card to your account.",
  [StreamingErrorType.NonexistentSessionId]: "Session ID does not exist",
  [StreamingErrorType.SessionExpired]: "Session has expired",
  [StreamingErrorType.ClosedSession]: "Session is closed",
  [StreamingErrorType.RateLimited]: "Rate limited",
  [StreamingErrorType.UniqueSessionViolation]: "Unique session violation",
  [StreamingErrorType.SessionTimeout]: "Session Timeout",
  [StreamingErrorType.AudioTooShort]: "Audio too short",
  [StreamingErrorType.AudioTooLong]: "Audio too long",
  [StreamingErrorType.AudioTooSmallToTranscode]: "Audio too small to transcode",
  [StreamingErrorType.BadSchema]: "Bad schema",
  [StreamingErrorType.TooManyStreams]: "Too many streams",
  [StreamingErrorType.Reconnected]:
    "This session has been reconnected. This WebSocket is no longer valid.",
};

class StreamingError extends Error {}

export {
  StreamingError,
  StreamingErrorType,
  StreamingErrorTypeCodes,
  StreamingErrorMessages,
};
