// Error taxonomy — structured, typed errors for the whole extension
// Per architecture plan: AppError { code; retryable; userMessageKey; context (redacted); cause? }

/** Error codes by subsystem */
export type ErrorCode =
  // Acquisition errors
  | "ACQ_NO_PLAYER"
  | "ACQ_NO_RESPONSE"
  | "ACQ_EMPTY_BODY"
  | "ACQ_PARSE_FAILED"
  | "ACQ_STALE_VIDEO"
  | "ACQ_NETWORK"
  | "ACQ_TIMEOUT"
  | "ACQ_PERMISSION_REVOKED"
  // Storage errors
  | "STORE_WRITE_FAILED"
  | "STORE_READ_FAILED"
  | "STORE_QUOTA_EXCEEDED"
  | "STORE_MIGRATION_FAILED"
  | "STORE_CORRUPT"
  // AI errors
  | "AI_AUTH"
  | "AI_RATE_LIMIT"
  | "AI_NETWORK"
  | "AI_CORS"
  | "AI_ORIGIN_REJECTED"
  | "AI_MODEL"
  | "AI_CONTEXT_TOO_LARGE"
  | "AI_CANCELLED"
  | "AI_BLOCKED_STRICT"
  // General
  | "INTERNAL"
  | "INVALID_INPUT";

/** Structured application error */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly userMessageKey: string;
  readonly context: Record<string, unknown>;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    retryable?: boolean | undefined;
    userMessageKey?: string | undefined;
    context?: Record<string, unknown> | undefined;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "AppError";
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.userMessageKey = opts.userMessageKey ?? "error.unknown";
    this.context = opts.context ?? {};
  }

  /** Create a serializable representation (never includes secrets) */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      userMessageKey: this.userMessageKey,
    };
  }
}

/** Wrap unknown thrown values into AppError */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError({
      code: "INTERNAL",
      message: err.message,
      cause: err,
    });
  }
  return new AppError({
    code: "INTERNAL",
    message: String(err),
  });
}
