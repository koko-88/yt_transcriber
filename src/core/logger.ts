// Logger — redacting ring-buffer logger per plan section 27
// Secret values are never logged. Ring buffer holds last 500 events.

import { Secret } from "./secret";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
}

const RING_SIZE = 500;

class Logger {
  private readonly ring: LogEntry[] = [];
  private debugEnabled = false;

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  debug(
    source: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (this.debugEnabled) {
      this.log("debug", source, message, context);
    }
  }

  info(
    source: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.log("info", source, message, context);
  }

  warn(
    source: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.log("warn", source, message, context);
  }

  error(
    source: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.log("error", source, message, context);
  }

  /** Get the ring buffer contents for diagnostics */
  getEntries(): readonly LogEntry[] {
    return [...this.ring];
  }

  /** Generate copyable diagnostics text (no secrets, no content) */
  getDiagnostics(): string {
    return this.ring
      .map((e) => {
        const time = new Date(e.timestamp).toISOString();
        const ctx = e.context ? ` ${JSON.stringify(e.context)}` : "";
        return `[${time}] [${e.level}] [${e.source}] ${e.message}${ctx}`;
      })
      .join("\n");
  }

  /** Clear the ring buffer */
  clear(): void {
    this.ring.length = 0;
  }

  private log(
    level: LogLevel,
    source: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const sanitized = context ? this.redact(context) : undefined;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      source,
      message,
      ...(sanitized === undefined ? {} : { context: sanitized }),
    };

    if (this.ring.length >= RING_SIZE) {
      this.ring.shift();
    }
    this.ring.push(entry);

    // Also output to console in dev
    if (typeof globalThis !== "undefined" && this.debugEnabled) {
      const consoleFn =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : console.debug;
      consoleFn(`[${source}] ${message}`, sanitized ?? "");
    }
  }

  /** Deep-redact any Secret values from a context object */
  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (Secret.isSecret(value)) {
        result[key] = "[redacted]";
      } else if (
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("authorization")
      ) {
        result[key] = "[redacted]";
      } else if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        result[key] = this.redact(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

/** Singleton logger instance */
export const logger = new Logger();
