import { PolyfillWebSocketFactory, PolyfillWebSocket } from ".";
export { PolyfillWebSocket } from ".";

const PolyfillWebSocket =
  WebSocket ?? global?.WebSocket ?? window?.WebSocket ?? self?.WebSocket;

export const factory: PolyfillWebSocketFactory = (
  url: string,
  params?: unknown,
) => {
  if (params) {
    return new PolyfillWebSocket(
      url,
      params as string | string[],
    ) as unknown as PolyfillWebSocket;
  }
  return new PolyfillWebSocket(url) as unknown as PolyfillWebSocket;
};
