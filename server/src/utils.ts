import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

/** Error with an HTTP status, surfaced to API clients. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Error whose message is safe to show to socket clients. */
export class UserError extends Error {}

/** Express 4 does not catch rejected promises, so wrap async handlers. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid input");
  }
  return result.data;
}

export const uuidSchema = z.string().uuid();

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
