import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { safeJson, stackOf } from '@app/common';

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

/** Telegram's "too many requests" status. */
const RATE_LIMITED = 429;

const MS_PER_SECOND = 1000;

/** The body Telegram returns with a refusal, as far as this service reads it. */
interface TelegramErrorBody {
  readonly error_code?: unknown;
  readonly description?: unknown;
  readonly parameters?: { readonly retry_after?: unknown };
}

/**
 * Extracts the API response from a `node-telegram-bot-api` rejection.
 *
 * The client wraps the API answer rather than throwing an HTTP error, so the
 * status and the server's own back-off hint live under `response.body`. Every
 * field is optional and `unknown`, because this is a third-party shape arriving
 * at runtime and a confident cast here would throw from inside a catch block.
 */
const bodyOf = (error: unknown): TelegramErrorBody | null => {
  if (typeof error !== 'object' || error === null) return null;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return null;
  const body = (response as { body?: unknown }).body;
  return typeof body === 'object' && body !== null
    ? (body as TelegramErrorBody)
    : null;
};

/** True when Telegram refused the message for rate limiting, specifically. */
const isRateLimited = (error: unknown): boolean =>
  bodyOf(error)?.error_code === RATE_LIMITED;

/**
 * Telegram's own instruction for how long to wait, in milliseconds.
 *
 * Null when the field is absent or not a usable number. Honouring the server's
 * hint is the difference between backing off and hammering an endpoint that has
 * just asked us to stop.
 */
const retryAfterMs = (error: unknown): number | null => {
  const seconds = bodyOf(error)?.parameters?.retry_after;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? seconds * MS_PER_SECOND
    : null;
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
 *
 * Deliberately richer than the shared `describeError`, and built on the same
 * `safeJson` primitive. Telegram's client rejects with plain API objects whose
 * CONTENTS are the entire diagnostic; flattening one to `[object Object]` would
 * throw away the only thing worth reading.
 */
const describeError = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string' && error.trim()) return error;
  return `non-Error rejection (${typeof error}): ${safeJson(error)}`;
};

/** What this channel has done, for a caller that wants to alarm on it. */
export interface TelegramStats {
  /** Messages the API accepted. */
  readonly delivered: number;
  /** Messages Telegram refused with a 429. Each one is a LOST alert. */
  readonly rateLimited: number;
  /** Messages that failed for any other reason. Also lost. */
  readonly failed: number;
}

/**
 * Pushes alerts to a Telegram chat.
 *
 * Three operational rules shape this class, all chosen so that the notification
 * channel can never take down ingestion:
 *
 *   1. Absent credentials degrade to logging. An empty `.env` must still boot,
 *      poll and persist; crashing would turn a missing channel into a total
 *      outage. The alert goes to the log instead.
 *   2. A send failure is caught, never rethrown. Telegram is a third party and
 *      its 429s, 502s and maintenance windows are not ingest failures.
 *   3. Sends are SERIALISED and PACED. Telegram enforces roughly one message a
 *      second per chat and answers a burst with 429s — and a 429 here is not a
 *      delay, it is a filing that is never delivered. Pacing turns a dropped
 *      alert into a late one, which is the right trade: measured over the
 *      recorded 32-day corpus, no 30-second window carries more than nine
 *      filings and no minute more than twelve, so at one message a second the
 *      queue never builds beyond a few seconds even at the observed peak.
 *
 * All three are only defensible because they are LOUD: the missing credential
 * warns at startup, every failed send logs at error level with the reason and,
 * where there is one, the stack, and every rate-limited send is COUNTED — so a
 * systematically dropped alert stream is a number rather than an impression.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: TelegramBot | null;
  private readonly chatId: string;
  private readonly minSendIntervalMs: number;

  /**
   * Serialises sends. Concurrent callers would defeat the pacing below and
   * arrive in completion order, undoing the chronological ordering the alert
   * service deliberately sorts for.
   */
  private queue: Promise<void> = Promise.resolve();

  /** Epoch ms before which the next send must not be issued. */
  private nextSendAtMs = 0;

  private delivered = 0;
  private rateLimited = 0;
  private failed = 0;

  /**
   * Reads the VALIDATED configuration, not the raw environment.
   *
   * `config.get('TELEGRAM_BOT_TOKEN')` also works — `ConfigService` falls
   * through to `process.env` — and that is exactly the problem: it bypasses
   * `loadConfig`, which is the single place every other setting is read,
   * defaulted and checked. Two ways to read one variable is how the two
   * readings drift.
   *
   * `getOrThrow` rather than `get`, matching every other consumer: a missing
   * key here means this wiring and the config factory have come apart, and a
   * silent `undefined` reaching the bot constructor reproduces the failure the
   * validation exists to prevent. An empty string is a real, expected value and
   * passes — that is the documented "no credentials" case.
   */
  constructor(config: ConfigService) {
    const token = config.getOrThrow<string>('telegramBotToken');
    this.chatId = config.getOrThrow<string>('telegramChatId');
    this.minSendIntervalMs = config.getOrThrow<number>(
      'telegramMinSendIntervalMs',
    );

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

  /** Delivered, rate-limited and failed counts since start. */
  stats(): TelegramStats {
    return {
      delivered: this.delivered,
      rateLimited: this.rateLimited,
      failed: this.failed,
    };
  }

  /**
   * Sends one pre-formatted alert. The text arrives already escaped by the
   * formatter and is passed through untouched.
   *
   * Resolves even when delivery failed, and even when it was never attempted.
   * Callers must not treat a resolved promise as proof of delivery — `stats()`
   * is the only honest account of that.
   */
  async send(text: string): Promise<void> {
    const bot = this.bot;
    if (!bot || !this.chatId) {
      this.logger.log(`[alert suppressed]\n${text}`);
      return;
    }

    // The queue advances with a CAUGHT copy. `deliver` is contracted not to
    // reject, but a poisoned chain would silence the channel permanently and
    // that is too much to rest on a contract.
    const run = this.queue.then(() => this.deliver(bot, text));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async deliver(bot: TelegramBot, text: string): Promise<void> {
    await this.waitForSlot();

    try {
      await bot.sendMessage(this.chatId, text, SEND_OPTIONS);
      this.delivered += 1;
    } catch (error) {
      this.recordFailure(error);
    }
  }

  /**
   * Holds until the pacing interval since the previous send has elapsed.
   *
   * A LOOP, NOT ONE SLEEP: Node truncates timers to whole milliseconds and a
   * setTimeout can resolve up to a millisecond EARLY, so a single sleep let a
   * 40ms gap measure 39ms of wall clock — "at least the configured gap" was a
   * contract the code did not quite keep, and its spec failed on exactly that
   * (once on PR #14's runner, again on PR #27's). Re-sleeping the remainder
   * makes the guarantee true rather than loosening the spec to match the bug.
   */
  private async waitForSlot(): Promise<void> {
    while (Date.now() < this.nextSendAtMs) {
      await delay(this.nextSendAtMs - Date.now());
    }
    this.nextSendAtMs = Date.now() + this.minSendIntervalMs;
  }

  /**
   * Records a send that did not land, distinguishing a rate limit from
   * everything else.
   *
   * A 429 used to be swallowed under the same log line as any other failure,
   * which made the one self-inflicted, recoverable failure indistinguishable
   * from a Telegram outage — and made a systematically dropped alert stream
   * read as occasional noise. It is counted separately, and the server's own
   * `retry_after` pushes the next send out so the following message is not
   * thrown at an endpoint that has just asked us to stop.
   */
  private recordFailure(error: unknown): void {
    if (!isRateLimited(error)) {
      this.failed += 1;
      // A Telegram outage must never stop ingestion — so this is swallowed on
      // purpose. It is logged at error level with the reason and stack so the
      // swallow stays diagnosable rather than silent.
      this.logger.error(
        `Telegram send failed: ${describeError(error)}`,
        stackOf(error),
      );
      return;
    }

    this.rateLimited += 1;
    const backoffMs = retryAfterMs(error);
    if (backoffMs !== null) {
      this.nextSendAtMs = Math.max(this.nextSendAtMs, Date.now() + backoffMs);
    }

    this.logger.error(
      `Telegram rate-limited this send and the alert is LOST; ` +
        `${this.rateLimited} dropped so far. ` +
        `retry_after=${backoffMs === null ? 'absent' : `${backoffMs}ms`}. ` +
        `Response: ${safeJson(bodyOf(error))}`,
    );
  }
}
