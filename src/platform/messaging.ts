import { browser, type Browser } from "wxt/browser";
type MessageSender = Browser.runtime.MessageSender;
import { z } from "zod";
import { logger } from "@/core/logger";
import { AppError, type ErrorCode } from "@/core/errors";

/** Message sender classification */
export type SenderClass = "content-script" | "extension-page" | "untrusted";

/** Classify the sender of a message */
export function classifySender(sender: MessageSender): SenderClass {
  if (!sender.url) return "untrusted";

  const isSelf = sender.id === browser.runtime.id;
  if (!isSelf) return "untrusted";

  if (sender.tab) {
    const url = new URL(sender.url);
    if (url.hostname === "www.youtube.com") {
      return "content-script";
    }
    return "untrusted";
  }

  if (
    sender.url.startsWith("chrome-extension://") ||
    sender.url.startsWith("moz-extension://")
  ) {
    return "extension-page";
  }

  return "untrusted";
}

/** Base message types */
export const MessageSchema = z.object({
  type: z.string(),
  payload: z.unknown().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

/** Typed response */
export interface BusResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    userMessageKey?: string;
  };
}

/** Handler function type */
export type MessageHandler<TReq, TRes> = (
  payload: TReq,
  sender: MessageSender,
) => Promise<TRes> | TRes;

const ERROR_CODES = new Set<ErrorCode>([
  "ACQ_NO_PLAYER",
  "ACQ_NO_RESPONSE",
  "ACQ_EMPTY_BODY",
  "ACQ_PARSE_FAILED",
  "ACQ_STALE_VIDEO",
  "ACQ_NETWORK",
  "ACQ_TIMEOUT",
  "ACQ_PERMISSION_REVOKED",
  "STORE_WRITE_FAILED",
  "STORE_READ_FAILED",
  "STORE_QUOTA_EXCEEDED",
  "STORE_MIGRATION_FAILED",
  "STORE_CORRUPT",
  "AI_AUTH",
  "AI_RATE_LIMIT",
  "AI_NETWORK",
  "AI_CORS",
  "AI_ORIGIN_REJECTED",
  "AI_MODEL",
  "AI_CONTEXT_TOO_LARGE",
  "AI_CANCELLED",
  "AI_BLOCKED_STRICT",
  "INTERNAL",
  "INVALID_INPUT",
]);

function isErrorCode(value: string | undefined): value is ErrorCode {
  return value !== undefined && ERROR_CODES.has(value as ErrorCode);
}

class MessageBus {
  private handlers = new Map<
    string,
    {
      schema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
      allowedSenders: SenderClass[];
      handler: (
        payload: unknown,
        sender: MessageSender,
      ) => Promise<unknown> | unknown;
    }
  >();

  constructor() {
    this.setupListener();
  }

  /**
   * Register a message handler
   */
  on<TReq, TRes>(
    type: string,
    schema: z.ZodType<TReq, z.ZodTypeDef, unknown>,
    allowedSenders: SenderClass[],
    handler: MessageHandler<TReq, TRes>,
  ) {
    if (this.handlers.has(type)) {
      throw new Error(`Handler for ${type} already registered`);
    }
    this.handlers.set(type, {
      schema: schema as z.ZodType<unknown, z.ZodTypeDef, unknown>,
      allowedSenders,
      handler: (payload, sender) => handler(payload as TReq, sender),
    });
  }

  /**
   * Send a message and wait for a response
   */
  async request<TRes>(
    type: string,
    payload?: unknown,
    tabId?: number,
  ): Promise<TRes> {
    const msg = { type, payload };
    let response: BusResponse<TRes>;

    try {
      if (tabId !== undefined) {
        response = await browser.tabs.sendMessage(tabId, msg);
      } else {
        response = await browser.runtime.sendMessage(msg);
      }
    } catch (err: unknown) {
      throw new AppError({
        code: "INTERNAL",
        message: `Bus request failed: ${err instanceof Error ? err.message : String(err)}`,
        cause: err,
      });
    }

    if (!response) {
      throw new AppError({
        code: "INTERNAL",
        message: "No response received from bus",
      });
    }

    if (!response.ok) {
      const code = response.error?.code;
      throw new AppError({
        code: isErrorCode(code) ? code : "INTERNAL",
        message: response.error?.message || "Unknown bus error",
        userMessageKey: response.error?.userMessageKey,
      });
    }

    return response.data as TRes;
  }

  private setupListener() {
    // Only register listener in background or pages/content scripts that receive messages
    if (
      typeof browser !== "undefined" &&
      browser.runtime &&
      browser.runtime.onMessage
    ) {
      browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Must handle asynchronously
        this.handleMessage(message, sender).then(sendResponse);
        return true; // Keep channel open for async response
      });
    }
  }

  private async handleMessage(
    rawMessage: unknown,
    sender: MessageSender,
  ): Promise<BusResponse> {
    try {
      const parsedMsg = MessageSchema.safeParse(rawMessage);
      if (!parsedMsg.success) {
        return {
          ok: false,
          error: { code: "INVALID_INPUT", message: "Invalid message envelope" },
        };
      }

      const { type, payload } = parsedMsg.data;
      const registration = this.handlers.get(type);

      if (!registration) {
        return {
          ok: false,
          error: { code: "INTERNAL", message: `No handler for ${type}` },
        };
      }

      const senderClass = classifySender(sender);
      if (!registration.allowedSenders.includes(senderClass)) {
        logger.warn(
          "messaging",
          `Rejected ${type} from unauthorized sender class: ${senderClass}`,
        );
        return {
          ok: false,
          error: { code: "INTERNAL", message: "Unauthorized sender" },
        };
      }

      const parsedPayload = registration.schema.safeParse(payload ?? {});
      if (!parsedPayload.success) {
        logger.warn("messaging", `Invalid payload for ${type}`, {
          errors: parsedPayload.error.format(),
        });
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "Invalid payload structure",
          },
        };
      }

      const data = await registration.handler(parsedPayload.data, sender);
      return { ok: true, data };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Never log the raw message: payloads can carry API keys (ai.secret.set).
      logger.error("messaging", `Error handling message`, {
        type: (rawMessage as { type?: string } | null)?.type,
        error: message,
      });
      if (err instanceof AppError) {
        return {
          ok: false,
          error: {
            code: err.code,
            message: err.message,
            userMessageKey: err.userMessageKey,
          },
        };
      }
      return {
        ok: false,
        error: { code: "INTERNAL", message: message || "Unknown error" },
      };
    }
  }
}

export const bus = new MessageBus();
