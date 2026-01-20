import ws, { Event, ErrorEvent, CloseEvent, MessageEvent } from "ws";

export type PolyfillWebSocket = {
  OPEN: typeof ws.OPEN;
  binaryType: string;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  readonly readyState:
    | typeof ws.CONNECTING
    | typeof ws.OPEN
    | typeof ws.CLOSING
    | typeof ws.CLOSED;
  removeAllListeners?: () => void;
  send(
    data:
      | string
      | number
      | Buffer
      | DataView
      | ArrayBufferView
      | Uint8Array
      | ArrayBuffer
      | SharedArrayBuffer
      | readonly unknown[]
      | readonly number[]
      | { valueOf(): ArrayBuffer }
      | { valueOf(): SharedArrayBuffer }
      | { valueOf(): Uint8Array }
      | { valueOf(): readonly number[] }
      | { valueOf(): string }
      | { [Symbol.toPrimitive](hint: string): string },
  ): unknown;
  close(): unknown;
};

export type PolyfillWebSocketFactory = (
  url: string,
  params?: unknown,
) => PolyfillWebSocket;
