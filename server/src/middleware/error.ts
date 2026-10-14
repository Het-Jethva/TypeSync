import { Request, Response, NextFunction, RequestHandler } from "express";
import { z } from "zod";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string
  ) {
    super(message);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function validationErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Validation error";
}

const JsonParserErrorSchema = z.union([
  z.object({
    type: z.enum(["entity.parse.failed", "request.aborted", "request.size.invalid"]),
    status: z.literal(400),
  }),
  z.object({ type: z.literal("entity.too.large"), status: z.literal(413) }),
  z.object({
    type: z.enum(["charset.unsupported", "encoding.unsupported"]),
    status: z.literal(415),
  }),
]);

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof z.ZodError) {
    res.locals.requestFailure = "validation";
    return res.status(400).json({
      success: false,
      error: validationErrorMessage(err),
    });
  }

  if (err instanceof AppError) {
    res.locals.requestFailure = "app";
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
  }

  const parserError = JsonParserErrorSchema.safeParse(err);
  if (parserError.success) {
    res.locals.requestFailure = "body_parser";
    return res.status(parserError.data.status).json({
      success: false,
      error: parserError.data.type === "entity.parse.failed"
        ? "Invalid JSON body"
        : parserError.data.status === 413 ? "Request body is too large"
        : parserError.data.status === 415 ? "Unsupported request body encoding"
        : "Invalid request body",
    });
  }

  res.locals.requestFailure = "unknown";
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
};
