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
 * turn the "no credentials" suite green for the wrong reason.
 *
 * The keys are `loadConfig`'s VALIDATED camelCase output, not the raw
 * environment names — the service reads the config factory's result, which is
 * the single place every setting is read, defaulted and checked. `getOrThrow`
 * rather than `get`, matching the service and every other consumer.
 *
 * The pacing interval defaults to 0 here so the ordinary suites do not each pay
 * a second per message; the suite that owns the pacing sets its own.
 */
const configWith = (
  values: Readonly<Record<string, string>>,
  minSendIntervalMs = 0,
): ConfigService =>
  ({
    getOrThrow: (key: string): string | number =>
      key === 'telegramMinSendIntervalMs'
        ? minSendIntervalMs
        : (values[key] ?? ''),
  }) as unknown as ConfigService;

const FULL_CREDENTIALS = {
  telegramBotToken: '123456:AAF-test-token',
  telegramChatId: '-1001234567890',
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
        FULL_CREDENTIALS.telegramBotToken,
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
        FULL_CREDENTIALS.telegramChatId,
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
      ['no token', { telegramChatId: FULL_CREDENTIALS.telegramChatId }],
      ['no chat id', { telegramBotToken: FULL_CREDENTIALS.telegramBotToken }],
      ['neither token nor chat id', {}],
      ['an empty token', { ...FULL_CREDENTIALS, telegramBotToken: '' }],
      ['an empty chat id', { ...FULL_CREDENTIALS, telegramChatId: '' }],
      ['both empty', { telegramBotToken: '', telegramChatId: '' }],
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
        configWith({ telegramBotToken: FULL_CREDENTIALS.telegramBotToken }),
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
        FULL_CREDENTIALS.telegramChatId,
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

/**
 * Telegram enforces roughly one message a second per chat and answers a burst
 * with 429s. A 429 here is not a delay — the client rejects, `send()` swallows
 * it, and the filing is never delivered. Pacing turns a dropped alert into a
 * late one; the corpus says that costs a few seconds at the observed peak (no
 * 30-second window carries more than nine filings, no minute more than twelve).
 */
describe('TelegramService: pacing and rate limits', () => {
  const PACE_MS = 40;

  let errorSpy: jest.SpyInstance;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    MockedBot.mockClear();
    MockedBot.prototype.sendMessage.mockReset();
    MockedBot.prototype.sendMessage.mockResolvedValue(
      {} as Awaited<ReturnType<TelegramBot['sendMessage']>>,
    );
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  const paced = (): TelegramService =>
    new TelegramService(configWith(FULL_CREDENTIALS, PACE_MS));

  /** A rejection shaped like the client's, with the API body it wraps. */
  const rateLimitRejection = (retryAfter?: number): unknown => ({
    response: {
      body: {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 30',
        ...(retryAfter === undefined
          ? {}
          : { parameters: { retry_after: retryAfter } }),
      },
    },
  });

  it('leaves at least the configured gap between two sends', async () => {
    const service = paced();
    const started = Date.now();

    await service.send('first');
    await service.send('second');

    expect(Date.now() - started).toBeGreaterThanOrEqual(PACE_MS);
    expect(MockedBot.prototype.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not delay the very first send', async () => {
    const started = Date.now();

    await paced().send('first');

    expect(Date.now() - started).toBeLessThan(PACE_MS);
  });

  it('serialises concurrent callers rather than letting them race', async () => {
    // Concurrent sends would defeat the pacing AND arrive in completion order,
    // undoing the chronological ordering the alert service sorts for.
    const service = paced();
    const order: string[] = [];
    MockedBot.prototype.sendMessage.mockImplementation((async (
      _chat: string,
      text: string,
    ) => {
      order.push(text);
      return {};
    }) as never);

    await Promise.all([
      service.send('one'),
      service.send('two'),
      service.send('three'),
    ]);

    expect(order).toEqual(['one', 'two', 'three']);
  });

  it('counts a delivered message', async () => {
    const service = paced();

    await service.send(ALERT);

    expect(service.stats()).toEqual({
      delivered: 1,
      rateLimited: 0,
      failed: 0,
    });
  });

  it('counts a rate-limited send separately from any other failure', async () => {
    // The distinction is the point: a 429 is self-inflicted and recoverable,
    // and reporting it as a generic failure made a systematically dropped
    // alert stream read as occasional noise.
    const service = paced();
    MockedBot.prototype.sendMessage.mockRejectedValueOnce(rateLimitRejection());
    MockedBot.prototype.sendMessage.mockRejectedValueOnce(new Error('502'));

    await service.send('one');
    await service.send('two');

    expect(service.stats()).toEqual({
      delivered: 0,
      rateLimited: 1,
      failed: 1,
    });
  });

  it('says the alert was lost, and how many have been', async () => {
    const service = paced();
    MockedBot.prototype.sendMessage.mockRejectedValue(rateLimitRejection());

    await service.send('one');
    await service.send('two');

    const logged = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(logged).toContain('LOST');
    expect(logged).toContain('2 dropped so far');
  });

  it('does not discard the response body a 429 carried', async () => {
    const service = paced();
    MockedBot.prototype.sendMessage.mockRejectedValueOnce(
      rateLimitRejection(30),
    );

    await service.send(ALERT);

    expect(String(errorSpy.mock.calls[0][0])).toContain('Too Many Requests');
  });

  it('honours the server retry_after for the next send', async () => {
    const service = paced();
    MockedBot.prototype.sendMessage.mockRejectedValueOnce(
      // 0.15s, deliberately longer than the ordinary pace.
      rateLimitRejection(0.15),
    );

    await service.send('one');
    const started = Date.now();
    await service.send('two');

    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('reports the retry_after as absent when Telegram omitted it', async () => {
    const service = paced();
    MockedBot.prototype.sendMessage.mockRejectedValueOnce(rateLimitRejection());

    await service.send(ALERT);

    expect(String(errorSpy.mock.calls[0][0])).toContain('retry_after=absent');
  });

  const NOT_RATE_LIMITS: ReadonlyArray<readonly [string, unknown]> = [
    ['a plain Error', new Error('socket hang up')],
    ['a 400 from the API', { response: { body: { error_code: 400 } } }],
    ['a body that is not an object', { response: { body: 'nope' } }],
    ['a response that is not an object', { response: 'nope' }],
    ['null', null],
    ['a bare string', 'boom'],
  ];

  it.each(NOT_RATE_LIMITS)(
    'does not read %s as a rate limit',
    async (_label, rejection) => {
      const service = paced();
      MockedBot.prototype.sendMessage.mockRejectedValueOnce(rejection);

      await service.send(ALERT);

      expect(service.stats().rateLimited).toBe(0);
      expect(service.stats().failed).toBe(1);
    },
  );

  it('keeps sending after a rate limit rather than wedging the queue', async () => {
    const service = paced();
    MockedBot.prototype.sendMessage.mockRejectedValueOnce(rateLimitRejection());

    await service.send('dropped');
    await service.send('delivered');

    expect(service.stats().delivered).toBe(1);
  });

  it('keeps sending after a rejection that is not an Error at all', async () => {
    // A poisoned queue would silence the channel permanently, so the chain is
    // advanced with a caught copy rather than on the contract alone.
    const service = paced();
    MockedBot.prototype.sendMessage.mockRejectedValueOnce(null);

    await service.send('dropped');
    await service.send('delivered');

    expect(service.stats().delivered).toBe(1);
  });
});
