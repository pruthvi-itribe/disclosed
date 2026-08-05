import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

type SendOptions = NonNullable<Parameters<TelegramBot['sendMessage']>[2]>;

/**
 * `parse_mode: 'HTML'` is a contract with the alert formatter, which escapes
 * `&`, `<` and `>` for exactly this parser. Changing it would leave those
 * escapes visible as literal text.
 *
 * Previews are disabled because the alert's last line is a PDF link: an
 * unfurled card would push the headline off the first screen and stall on NSE's
 * archive host.
 */
const SEND_OPTIONS: SendOptions = {
  parse_mode: 'HTML',
  disable_web_page_preview: true,
};

/** Shown when a value cannot be converted to text by any means at all. */
const UNPRINTABLE = '[unprintable]';

/**
 * Coerces to text without throwing. `String(value)` is not total: a
 * null-prototype object has neither `Symbol.toPrimitive` nor `toString`, so it
 * raises "Cannot convert object to primitive value". Every path in this file
 * must terminate in a string, because the caller is a catch block.
 */
const safeString = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    return UNPRINTABLE;
  }
};

/** Serialises a non-Error rejection without throwing on a circular object. */
const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? safeString(value);
  } catch {
    // Circular or otherwise unserialisable. This is a fallback formatter for a
    // log line, not an error path: any description beats losing the log.
    return safeString(value);
  }
};

/**
 * Describes a rejection for the log, whatever shape it arrives in.
 *
 * A bare `(error as Error).message` is not sufficient here. A rejected promise
 * can carry a string, a bare API object, or nothing at all, and reading
 * `.message` off `null` or `undefined` THROWS — from inside the catch block
 * whose whole job is to contain the failure. The rejection would then escape
 * `send()` and reach the poll loop, which is precisely the outcome the catch
 * exists to prevent. The rest yield the literal text "undefined", which tells
 * an operator nothing.
 */
const describeError = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string' && error.trim()) return error;
  return `non-Error rejection (${typeof error}): ${safeJson(error)}`;
};

/**
 * Pushes alerts to a Telegram chat.
 *
 * Two operational rules shape this class, both chosen so that the notification
 * channel can never take down ingestion:
 *
 *   1. Absent credentials degrade to logging. An empty `.env` must still boot,
 *      poll and persist; crashing would turn a missing channel into a total
 *      outage. The alert goes to the log instead.
 *   2. A send failure is caught, never rethrown. Telegram is a third party and
 *      its 429s, 502s and maintenance windows are not ingest failures.
 *
 * Both are only defensible because they are LOUD: the missing credential warns
 * at startup, and every failed send logs at error level with the reason and,
 * where there is one, the stack. A silent channel must always be diagnosable
 * from the logs.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: TelegramBot | null;
  private readonly chatId: string;

  constructor(config: ConfigService) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    this.chatId = config.get<string>('TELEGRAM_CHAT_ID') ?? '';

    // Absent credentials must degrade to logging, never crash ingest.
    this.bot = token ? new TelegramBot(token, { polling: false }) : null;

    if (!this.bot) {
      this.logger.warn('TELEGRAM_BOT_TOKEN unset — alerts will only be logged');
    } else if (!this.chatId) {
      // The subtler half: the bot constructs fine, so nothing fails at boot and
      // every send would go nowhere. Name the variable that is missing.
      this.logger.warn('TELEGRAM_CHAT_ID unset — alerts will only be logged');
    }
  }

  /**
   * Sends one pre-formatted alert. The text arrives already escaped by the
   * formatter and is passed through untouched.
   *
   * Resolves even when delivery fails. Callers must not treat a resolved
   * promise as proof of delivery.
   */
  async send(text: string): Promise<void> {
    if (!this.bot || !this.chatId) {
      this.logger.log(`[alert suppressed]\n${text}`);
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, text, SEND_OPTIONS);
    } catch (error) {
      // A Telegram outage must never stop ingestion — so this is swallowed on
      // purpose. It is logged at error level with the reason and stack so the
      // swallow stays diagnosable rather than silent.
      this.logger.error(
        `Telegram send failed: ${describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
