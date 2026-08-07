import {
  CHANNEL_KINDS,
  DEFAULT_CHANNELS,
  parseChannel,
  parseChannels,
} from './channel';

/**
 * The alert channels, parsed rather than trusted.
 *
 * THIS IS THE ONE PLACE THE DESIGN ACCEPTS SPECULATIVE GENERALITY, and it is
 * accepted knowingly: `config` is `Mixed` in the schema so email, Telegram DM
 * and web push are additions rather than migrations. `Mixed` means Mongoose
 * validates nothing, so this parser IS the validation — without it, "no schema
 * change needed" would be a promise with no check behind it.
 */

describe('parseChannel — the in-app channel', () => {
  it('accepts the v1 channel', () => {
    expect(parseChannel({ kind: 'inapp', enabled: true, config: {} })).toEqual({
      kind: 'inapp',
      enabled: true,
      config: {},
    });
  });

  it('ignores whatever config an inapp channel was stored with', () => {
    // The in-app channel is a QUERY. It has no delivery state, no address and
    // no endpoint, so anything in its config is residue.
    expect(
      parseChannel({ kind: 'inapp', enabled: false, config: { x: 1 } }),
    ).toEqual({ kind: 'inapp', enabled: false, config: {} });
  });
});

describe('parseChannel — the channels that have not shipped yet', () => {
  it('accepts a well-formed email channel', () => {
    expect(
      parseChannel({
        kind: 'email',
        enabled: true,
        config: {
          address: 'asha@example.com',
          verifiedAt: null,
          mode: 'coalesced',
          lastFlushedAt: null,
        },
      }),
    ).toEqual({
      kind: 'email',
      enabled: true,
      config: {
        address: 'asha@example.com',
        verifiedAt: null,
        mode: 'coalesced',
        lastFlushedAt: null,
      },
    });
  });

  it('refuses an email channel with no address, rather than storing a channel that cannot deliver', () => {
    expect(
      parseChannel({ kind: 'email', enabled: true, config: {} }),
    ).toBeNull();
  });

  it('refuses an email channel whose mode is not one of the two that exist', () => {
    expect(
      parseChannel({
        kind: 'email',
        enabled: true,
        config: { address: 'a@b.co', mode: 'instant' },
      }),
    ).toBeNull();
  });

  it('accepts a telegram channel, which is what "no migration" means', () => {
    expect(
      parseChannel({
        kind: 'telegram',
        enabled: true,
        config: { chatId: '12345', deliverable: true, reason: null },
      }),
    ).toEqual({
      kind: 'telegram',
      enabled: true,
      config: { chatId: '12345', deliverable: true, reason: null },
    });
  });

  it('accepts a webpush channel', () => {
    expect(
      parseChannel({
        kind: 'webpush',
        enabled: true,
        config: { endpoint: 'https://push.example/x', p256dh: 'k', auth: 'a' },
      })?.kind,
    ).toBe('webpush');
  });
});

describe('parseChannel — refusals', () => {
  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'inapp'],
    ['an array', [{ kind: 'inapp' }]],
    ['an unknown kind', { kind: 'sms', enabled: true, config: {} }],
    ['a missing kind', { enabled: true, config: {} }],
    ['a kind that is not a string', { kind: 1, enabled: true, config: {} }],
    ['enabled that is not a boolean', { kind: 'inapp', enabled: 'yes' }],
  ])('refuses %s', (_label, raw) => {
    expect(parseChannel(raw)).toBeNull();
  });

  it('defaults a missing `enabled` to false rather than to on', () => {
    // Fail CLOSED on a channel that sends things. A stored document missing the
    // flag must not start delivering.
    expect(parseChannel({ kind: 'inapp', config: {} })).toEqual({
      kind: 'inapp',
      enabled: false,
      config: {},
    });
  });

  it('cannot be tricked by a prototype key', () => {
    expect(parseChannel({ kind: 'constructor' })).toBeNull();
  });
});

describe('parseChannels', () => {
  it('drops the entries it cannot parse and keeps the ones it can', () => {
    // A DROP RATHER THAN A THROW, and the direction matters: one unparseable
    // channel on a user document must not make that user unable to sign in.
    expect(
      parseChannels([
        { kind: 'inapp', enabled: true, config: {} },
        { kind: 'sms', enabled: true, config: {} },
      ]),
    ).toEqual([{ kind: 'inapp', enabled: true, config: {} }]);
  });

  it('answers an empty list for anything that is not an array', () => {
    expect(parseChannels(undefined)).toEqual([]);
    expect(parseChannels({ kind: 'inapp' })).toEqual([]);
  });
});

describe('DEFAULT_CHANNELS', () => {
  it('is the in-app channel, enabled, and nothing else on MVP day', () => {
    expect(DEFAULT_CHANNELS).toEqual([
      { kind: 'inapp', enabled: true, config: {} },
    ]);
  });

  it('names every kind the schema is expected to hold without a migration', () => {
    expect([...CHANNEL_KINDS]).toEqual([
      'inapp',
      'email',
      'telegram',
      'webpush',
    ]);
  });

  it('is frozen, so a caller cannot push a channel onto everyone', () => {
    expect(Object.isFrozen(DEFAULT_CHANNELS)).toBe(true);
  });
});
