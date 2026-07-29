import type { Role } from "@typesync/shared";

/** Someone currently in the room, as reported by the presence channel. */
export interface ActiveCollaborator {
  userId: string;
  name: string;
  color: string;
  /** Null when the peer's frame predates roles being carried in presence. */
  role: Role | null;
}
