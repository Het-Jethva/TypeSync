import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

const PROBE = "typesync-proxy-20261013-84c7f923";
const MARKER = "203.0.113.101";

function addressClass(value: string | undefined): string {
  if (!value || !isIP(value)) return "absent-or-invalid";
  const address = value.toLowerCase().replace(/^::ffff:/, "");
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|f[cd]|fe[89ab])/.test(address) || address === "::1"
    ? "private" : "public";
}

export function logProxyProbe(request: IncomingMessage): void {
  if (request.headers["x-typesync-proxy-probe"] !== PROBE) return;
  const forwarded = request.headers["x-forwarded-for"];
  const addresses = typeof forwarded === "string" ? forwarded.split(",").map(value => value.trim()) : [];
  console.log(JSON.stringify({
    event: "typesync.proxy.probe", transport: request.headers.upgrade ? "websocket" : "http",
    peer: addressClass(request.socket.remoteAddress),
    forwarded: addresses.map(address => ({ kind: addressClass(address), marker: address === MARKER })),
    cfHeaderPresent: Boolean(request.headers["cf-connecting-ip"]),
    cfHeaderIsMarker: request.headers["cf-connecting-ip"] === MARKER,
    trueClientHeaderPresent: Boolean(request.headers["true-client-ip"]),
    trueClientHeaderIsMarker: request.headers["true-client-ip"] === MARKER,
  }));
}
