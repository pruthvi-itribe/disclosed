import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from './telegram.service';

jest.mock('node-telegram-bot-api');

const MockedBot = TelegramBot as unknown as jest.MockedClass<
  typeof TelegramBot
>;

/**
 * A stub rather than a real ConfigService: the real one falls through to
 * `process.env`, so a developer with TELEGRAM_BOT_TOKEN exported would silently
 * turn the "no credentials" suite green for the wrong reason. `as unknown as`
 * rather than `any` — the service only ever calls `get`.
 */
const configWith = (values: Readonly<Record<string, string>>): ConfigService =>
  ({
    get: (key: string): string | undefined => values[key],
  }) as unknown as ConfigService;

const FULL_CREDENTIALS = {
  TELEGRAM_BOT_TOKEN: '123456:AAF-test-token',
  TELEGRAM_CHAT_ID: '-1001234567890',
};

const ALERT = 'PANACEABIO — UPDATES\n\nOrder received.\n\n10:28:18 IST';

describe('TelegramService', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    MockedBot.mockClear();
    MockedBot.prototype.sendMessage.mockReset();
    MockedBot.prototype.sendMessage.mockResolvedValue(
      {} as Awaited<ReturnType<TelegramBot['sendMessage']>>,
    );
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('with credentials configured', () => {
    const build = (): TelegramService =>
      new TelegramService(configWith(FULL_CREDENTIALS));

    it('constructs one bot with polling disabled', () => {
      build();

      // Polling would open a long-lived connection to Telegram and start
      // consuming updates. This bot only ever pushes.
      expect(MockedBot).toHaveBeenCalledTimes(1);
      expect(MockedBot).toHaveBeenCalledWith(
        FULL_CREDENTIALS.TELEGRAM_BOT_TOKEN,
        {
          polling: false,
        },
      );
    });

    it('does not warn when the token is present', () => {
      build();

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('sends the text to the configured chat', async () => {
      await build().send(ALERT);

      expect(MockedBot.prototype.sendMessage).toHaveBeenCalledTimes(1);
      expect(MockedBot.prototype.sendMessage).toHaveBeenCalledWith(
        FULL_CREDENTIALS.TELEGRAM_CHAT_ID,
        ALERT,
        { parse_mode: 'HTML', disable_web_page_preview: true },
      );
    });

    /**
     * `parse_mode: 'HTML'` is a contract with the formatter, not a preference.
     * The formatter escapes `&`, `<` and `>` for HTML specifically; switching to
     * Markdown would leave those escapes visible as literal text and leave
     * Markdown's own metacharacters unescaped.
     */
    it('sends as HTML, matching what the formatter escapes for', async () => {
      await build().send(ALERT);

      const options = MockedBot.prototype.sendMessage.mock.calls[0][2];
      expect(options?.parse_mode).toBe('HTML');
    });

    /**
     * The alert carries a PDF link on its last line. With previews enabled
     * Telegram appends an unfurled card, which buries the headline the trader is
     * scanning for and delays rendering on the exchange's slow archive host.
     */
    it('disables the link preview', async () => {
      await build().send(ALERT);

      const options = MockedBot.prototype.sendMessage.mock.calls[0][2];
      expect(options?.disable_web_page_preview).toBe(true);
    });

    it('passes the text through byte-for-byte', async () => {
      // Formatting belongs to the formatter. Any trimming, re-escaping or
      // truncation here would corrupt already-escaped exchange text.
      const escaped =
        'M&amp;M — UPDATES\n\n&lt;b&gt;kept&lt;/b&gt;\n\n10:00:00 IST';

      await build().send(escaped);

      expect(MockedBot.prototype.sendMessage.mock.calls[0][1]).toBe(escaped);
    });

    /**
     * One wire message per alert. Nothing here coalesces, batches or joins
     * texts, which matters because the wire format's value depends on one
     * filing per message. This says nothing about concurrency — the calls are
     * awaited sequentially, so their order is not in question.
     */
    it('issues one sendMessage per alert, never batching them', async () => {
      const service = build();

      await service.send('first');
      await service.send('second');

      expect(MockedBot.prototype.sendMessage).toHaveBeenCalledTimes(2);
      expect(
        MockedBot.prototype.sendMessage.mock.calls.map((c) => c[1]),
      ).toEqual(['first', 'second']);
    });
  });

  /**
   * Absent credentials must degrade to logging, never crash. This is a
   * first-run and a misconfiguration case: the process has to boot, poll and
   * persist filings even with an empty `.env`, because a crash-on-boot turns a
   * missing notification channel into a total ingest outage. The alert still
   * reaches the operator, on stdout.
   */
  describe('with credentials absent', () => {
    const ABSENT_CASES: ReadonlyArray<
      readonly [string, Readonly<Record<string, string>>]
    > = [
      ['no token', { TELEGRAM_CHAT_ID: FULL_CREDENTIALS.TELEGRAM_CHAT_ID }],
      [
        'no chat id',
        { TELEGRAM_BOT_TOKEN: FULL_CREDENTIALS.TELEGRAM_BOT_TOKEN },
      ],
      ['neither token nor chat id', {}],
      ['an empty token', { ...FULL_CREDENTIALS, TELEGRAM_BOT_TOKEN: '' }],
      ['an empty chat id', { ...FULL_CREDENTIALS, TELEGRAM_CHAT_ID: '' }],
      ['both empty', { TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' }],
    ];

    it.each(ABSENT_CASES)('constructs with %s', (_label, values) => {
      expect(() => new TelegramService(configWith(values))).not.toThrow();
    });

    it.each(ABSENT_CASES)('resolves send() with %s', async (_label, values) => {
      await expect(
        new TelegramService(configWith(values)).send(ALERT),
      ).resolves.toBeUndefined();
    });

    it.each(ABSENT_CASES)(
      'sends nothing over the wire with %s',
      async (_label, values) => {
        await new TelegramService(configWith(values)).send(ALERT);

        expect(MockedBot.prototype.sendMessage).not.toHaveBeenCalled();
      },
    );

    it.each(ABSENT_CASES)(
      'still surfaces the alert in the log with %s',
      async (_label, values) => {
        await new TelegramService(configWith(values)).send(ALERT);

        // Suppressed on Telegram, not discarded: the operator can still read it.
        const logged = logSpy.mock.calls
          .map((call) => String(call[0]))
          .join('\n');
        expect(logged).toContain(ALERT);
      },
    );

    it('never constructs a bot without a token', () => {
      new TelegramService(configWith({}));

      expect(MockedBot).not.toHaveBeenCalled();
    });

    it('warns once at startup that alerts will only be logged', () => {
      new TelegramService(configWith({}));

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('TELEGRAM_BOT_TOKEN');
    });

    /**
     * A token with no chat id is the subtler half. The bot object constructs
     * fine, so nothing fails at boot, and every send would go nowhere with no
     * diagnosis. The operator has to be told which variable is missing.
     */
    it('warns that the chat id is missing when only the chat id is absent', () => {
      new TelegramService(
        configWith({ TELEGRAM_BOT_TOKEN: FULL_CREDENTIALS.TELEGRAM_BOT_TOKEN }),
      );

      const warned = warnSpy.mock.calls
        .map((call) => String(call[0]))
        .join('\n');
      expect(warned).toContain('TELEGRAM_CHAT_ID');
    });
  });

  /**
   * THE DELIBERATE SWALLOW. A Telegram outage must never stop ingestion: the
   * pipeline's first duty is to fetch and persist filings, and notification is
   * downstream of that. A rejection escaping `send()` would propagate into the
   * poll loop and could take down the poller over a third party's 502.
   *
   * The swallow is only defensible because it is LOUD. Every failure logs at
   * error level with the underlying reason, so a silent channel is diagnosable
   * from the logs rather than a mystery. These tests exist to stop anyone
   * quietly weakening the log into a bare `catch {}`.
   */
  describe('when Telegram fails', () => {
    const build = (): TelegramService =>
      new TelegramService(configWith(FULL_CREDENTIALS));

    const failWith = (reason: unknown): void => {
      MockedBot.prototype.sendMessage.mockRejectedValue(reason);
    };

    it('resolves rather than rejecting when the bot throws', async () => {
      failWith(new Error('ETELEGRAM: 502 Bad Gateway'));

      await expect(build().send(ALERT)).resolves.toBeUndefined();
    });

    it('logs the failure at error level before returning', async () => {
      failWith(new Error('ETELEGRAM: 502 Bad Gateway'));

      await build().send(ALERT);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain(
        'ETELEGRAM: 502 Bad Gateway',
      );
    });

    /**
     * Diagnosis needs the reason, whatever shape it arrives in. `error.message`
     * alone yields the string "undefined" for anything that is not an Error —
     * and a rejected HTTP promise, a thrown string or a bare API object are all
     * realistic here. "Telegram send failed: undefined" tells an operator
     * nothing, which is the swallow becoming silent by accident.
     */
    const FAILURE_SHAPES: ReadonlyArray<readonly [string, unknown, string]> = [
      ['an Error', new Error('ETELEGRAM: 400 Bad Request'), '400 Bad Request'],
      [
        'a TypeError from a programming mistake',
        new TypeError('x is not a function'),
        'x is not a function',
      ],
      ['a thrown string', 'socket hang up', 'socket hang up'],
      ['a rejected object with no message', { code: 'EFATAL' }, 'EFATAL'],
      ['null', null, 'null'],
      ['undefined', undefined, 'undefined'],
    ];

    it.each(FAILURE_SHAPES)(
      'describes %s in the error log',
      async (_label, reason, expected) => {
        failWith(reason);

        await build().send(ALERT);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const logged = errorSpy.mock.calls[0].map(String).join(' ');
        expect(logged).toContain(expected);
        expect(logged).not.toMatch(/failed: undefined/);
      },
    );

    /**
     * The last throw-inside-the-catch path. A circular object with a null
     * prototype fails `JSON.stringify` (circular) AND throws from `String()`
     * ("Cannot convert object to primitive value"), because it has neither
     * `Symbol.toPrimitive` nor `toString`. Unreachable from
     * node-telegram-bot-api in practice, but it is the same defect class the
     * describe-the-error helper exists to close: an exception raised while
     * formatting the log escapes the catch block that is supposed to contain
     * the failure, and the poll loop dies on a notification error after all.
     * Closed completely rather than half-closed, so nobody reads the helper as
     * fully defensive when it is not.
     */
    it('describes a rejection that cannot be stringified at all', async () => {
      const unprintable: Record<string, unknown> = Object.create(null);
      unprintable.self = unprintable;
      failWith(unprintable);

      await expect(build().send(ALERT)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('[unprintable]');
    });

    /**
     * A programming error inside this method — not inside Telegram — must not
     * be quietly absorbed as if it were an outage. It is still caught, because
     * ingestion outranks notification, but it is logged with its stack so the
     * bug is findable rather than presenting as a flaky notification channel.
     */
    it('logs the stack when the failure carries one', async () => {
      const bug = new TypeError('Cannot read properties of undefined');
      failWith(bug);

      await build().send(ALERT);

      // The stack goes to Logger.error's second parameter, which is what Nest
      // renders as a trace. Asserting on `bug.stack` by identity, rather than on
      // some substring, is what proves the trace is not being dropped.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('TypeError'),
        bug.stack,
      );
    });

    it('is not poisoned by a failure and sends the next alert', async () => {
      const service = build();
      failWith(new Error('ETELEGRAM: 502 Bad Gateway'));
      await service.send('first');

      MockedBot.prototype.sendMessage.mockResolvedValue(
        {} as Awaited<ReturnType<TelegramBot['sendMessage']>>,
      );
      await service.send('second');

      expect(MockedBot.prototype.sendMessage).toHaveBeenLastCalledWith(
        FULL_CREDENTIALS.TELEGRAM_CHAT_ID,
        'second',
        { parse_mode: 'HTML', disable_web_page_preview: true },
      );
    });

    it('resolves for every alert in a burst even when all of them fail', async () => {
      failWith(new Error('ETELEGRAM: 429 Too Many Requests'));
      const service = build();

      await expect(
        Promise.all([1, 2, 3, 4, 5].map((n) => service.send(`alert ${n}`))),
      ).resolves.toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(errorSpy).toHaveBeenCalledTimes(5);
    });
  });
});
