import type { DocumentJoinErrorCode } from "@typesync/shared";

export type JoinFailureAction = "ignore" | "access-lost" | "retry" | "stop";

export function joinFailureAction(code: DocumentJoinErrorCode): JoinFailureAction {
  switch (code) {
    case "cancelled":
      return "ignore";
    case "forbidden":
      return "access-lost";
    case "load-failed":
    case "unavailable":
      return "retry";
    case "invalid-id":
    case "session-expired":
    case "server-draining":
      return "stop";
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
}
