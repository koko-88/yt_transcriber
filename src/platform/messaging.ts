import { browser, type Browser } from 'wxt/browser';
type MessageSender = Browser.runtime.MessageSender;
import { z } from 'zod';
import { logger } from '@/core/logger';
import { AppError } from '@/core/errors';

/** Message sender classification */
export type SenderClass = 'content-script' | 'extension-page' | 'untrusted';

/** Classify the sender of a message */
export function classifySender(sender: MessageSender): SenderClass {
  if (!sender.url) return 'untrusted';

  const isSelf = sender.id === browser.runtime.id;
  if (!isSelf) return 'untrusted';

  if (sender.tab) {
    const url = new URL(sender.url);
    if (url.hostname === 'www.youtube.com') {
      return 'content-script';
    }
    return 'untrusted';
  }

  if (sender.url.startsWith('chrome-extension://') || sender.url.startsWith('moz-extension://')) {
    return 'extension-page';
  }

  return 'untrusted';
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
  sender: MessageSender
) => Promise<TRes> | TRes;

class MessageBus {
  private handlers = new Map<string, {
    schema: z.ZodType<any, any, any>;
    allowedSenders: SenderClass[];
    handler: MessageHandler<any, any>;
  }>();

  constructor() {
    this.setupListener();
  }

  /**
   * Register a message handler
   */
  on<TReq, TRes>(
    type: string,
    schema: z.ZodType<TReq, any, any>,
    allowedSenders: SenderClass[],
    handler: MessageHandler<TReq, TRes>
  ) {
    if (this.handlers.has(type)) {
      throw new Error(`Handler for ${type} already registered`);
    }
    this.handlers.set(type, { schema, allowedSenders, handler });
  }

  /**
   * Send a message and wait for a response
   */
  async request<TRes>(
    type: string,
    payload?: unknown,
    tabId?: number
  ): Promise<TRes> {
    const msg = { type, payload };
    let response: BusResponse<TRes>;

    try {
      if (tabId !== undefined) {
        response = await browser.tabs.sendMessage(tabId, msg);
      } else {
        response = await browser.runtime.sendMessage(msg);
      }
    } catch (err: any) {
      throw new AppError({
        code: 'INTERNAL',
        message: `Bus request failed: ${err.message}`,
        cause: err,
      });
    }

    if (!response) {
      throw new AppError({
        code: 'INTERNAL',
        message: 'No response received from bus',
      });
    }

    if (!response.ok) {
      throw new AppError({
        code: (response.error?.code as any) || 'INTERNAL',
        message: response.error?.message || 'Unknown bus error',
        userMessageKey: response.error?.userMessageKey,
      });
    }

    return response.data as TRes;
  }

  private setupListener() {
    // Only register listener in background or pages/content scripts that receive messages
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
      browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Must handle asynchronously
        this.handleMessage(message, sender).then(sendResponse);
        return true; // Keep channel open for async response
      });
    }
  }

  private async handleMessage(
    rawMessage: unknown,
    sender: MessageSender
  ): Promise<BusResponse> {
    try {
      const parsedMsg = MessageSchema.safeParse(rawMessage);
      if (!parsedMsg.success) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid message envelope' } };
      }

      const { type, payload } = parsedMsg.data;
      const registration = this.handlers.get(type);

      if (!registration) {
        return { ok: false, error: { code: 'INTERNAL', message: `No handler for ${type}` } };
      }

      const senderClass = classifySender(sender);
      if (!registration.allowedSenders.includes(senderClass)) {
        logger.warn('messaging', `Rejected ${type} from unauthorized sender class: ${senderClass}`);
        return { ok: false, error: { code: 'INTERNAL', message: 'Unauthorized sender' } };
      }

      const parsedPayload = registration.schema.safeParse(payload ?? {});
      if (!parsedPayload.success) {
        logger.warn('messaging', `Invalid payload for ${type}`, { errors: parsedPayload.error.format() });
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid payload structure' } };
      }

      const data = await registration.handler(parsedPayload.data, sender);
      return { ok: true, data };

    } catch (err: any) {
      logger.error('messaging', `Error handling message`, { error: err.message, rawMessage });
      if (err instanceof AppError) {
        return {
          ok: false,
          error: { code: err.code, message: err.message, userMessageKey: err.userMessageKey }
        };
      }
      return { ok: false, error: { code: 'INTERNAL', message: err.message || 'Unknown error' } };
    }
  }
}

export const bus = new MessageBus();
