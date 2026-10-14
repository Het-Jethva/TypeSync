import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { z } from "zod";

const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const routes = new Map([
  ["/api/auth/*splat", "/api/auth/*splat"],
  ["/api/health", "/api/health"],
  ["/api/ready", "/api/ready"],
  ["/api/webhooks/resend", "/api/webhooks/resend"],
  ["/", "/api/documents"],
  ["/:id", "/api/documents/:id"],
  ["/:id/collaborators", "/api/documents/:id/collaborators"],
  ["/:id/collaborators/:userId", "/api/documents/:id/collaborators/:userId"],
]);
const FailureKindSchema = z.enum([
  "validation", "app", "body_parser", "database", "unknown", "http",
]);

export const requestDiagnostics: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  res.setHeader("X-Request-ID", requestId);
  res.once("finish", () => {
    if (res.statusCode < 400) return;

    const declaredRoute: unknown = req.route?.path;
    const route = typeof declaredRoute === "string" ? routes.get(declaredRoute) : undefined;
    const kind = FailureKindSchema.safeParse(res.locals.requestFailure);
    console.error("Request failed", JSON.stringify({
      requestId,
      status: res.statusCode,
      ...(methods.has(req.method) ? { method: req.method } : {}),
      ...(route === undefined ? {} : { route }),
      kind: kind.success ? kind.data : "http",
    }));
  });
  next();
};
