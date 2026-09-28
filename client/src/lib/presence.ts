import { RoleSchema, type PresenceIdentity } from "@typesync/shared";

export function presenceIdentityFromAwareness(value: unknown): PresenceIdentity | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("userId" in value) || !("name" in value) || !("color" in value)) return null;

  const userId = value.userId;
  const name = value.name;
  const color = value.color;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof name !== "string" || typeof color !== "string") return null;

  const role = "role" in value ? value.role : null;
  if (role === undefined || role === null) {
    return { userId, name, color, role: null };
  }
  const parsedRole = RoleSchema.safeParse(role);
  if (!parsedRole.success) return null;
  return { userId, name, color, role: parsedRole.data };
}
