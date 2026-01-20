import ws from "ws";
import { PolyfillWebSocket, PolyfillWebSocketFactory } from ".";
export { PolyfillWebSocket } from ".";

export const factory: PolyfillWebSocketFactory = (
  url: string,
  params?: unknown,
) => new ws(url, params as ws.ClientOptions) as unknown as PolyfillWebSocket;
