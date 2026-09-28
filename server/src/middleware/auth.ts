import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { AppError } from "./error.js";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

// Stored beside the request so a handler cannot read a user that requireAuth never set.
const users = new WeakMap<Request, AuthenticatedUser>();

export function authenticatedUser(req: Request): AuthenticatedUser {
  const user = users.get(req);
  if (!user) {
    throw new AppError(401, "Unauthorized");
  }
  return user;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    users.set(req, {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    });
    next();
  } catch {
    res.status(401).json({ success: false, error: "Unauthorized" });
  }
}
