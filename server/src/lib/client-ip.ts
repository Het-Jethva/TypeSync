import type { IncomingMessage } from "node:http";
import proxyaddr from "proxy-addr";

// Render ingress measurements show three proxy hops for HTTP/polling and one
// for direct WebSocket connections, on both the custom and Render hostnames.
export const RENDER_HTTP_PROXY_HOPS = 3;

export function resolveSocketClientIp(
  request: IncomingMessage,
  { isProduction }: { isProduction: boolean }
): string {
  // Engine.IO validates this transport before Socket.IO receives the request.
  // Keep the original polling policy after an upgrade changes the live transport.
  const transport = new URL(request.url ?? "", "http://localhost").searchParams.getAll("transport").at(-1);
  const hops = isProduction ? (transport === "websocket" ? 1 : RENDER_HTTP_PROXY_HOPS) : 0;
  return proxyaddr(request, (_address, hop) => hop < hops);
}
