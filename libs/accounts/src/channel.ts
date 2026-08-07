/**
 * The alert channels a user's preferences carry, and the parser that is the
 * only thing validating them.
 *
 * ================================================================
 * WHY AN ARRAY OF DISCRIMINATED SUBDOCUMENTS ON DAY ONE
 * ================================================================
 *
 * v1 has exactly one channel — the in-app "Watching" view, which is a QUERY and
 * needs no fan-out, no queue and no delivery state at all. Email lands at the
 * exposure gate, Telegram DM and web push after it. The requirement is that
 * each of those is an ADDITION rather than a migration, so `config` is `Mixed`
 * in the schema and the shape of it is decided here.
 *
 * THIS IS THE ONE PLACE THIS DESIGN ACCEPTS SPECULATIVE GENERALITY. `CLAUDE.md`
 * rule 2 forbids "configuration for a case that has never occurred", and the
 * second and third channels here are already named and already dated. That is
 * the condition under which the rule does not apply, and it is written down so
 * the next reader can check the condition rather than the habit.
 *
 * `Mixed` means Mongoose validates NOTHING, so this parser is the validation.
 * Without it, "no schema change needed" would be a promise with no check behind
 * it.
 */

/** Every kind the schema is expected to hold without a migration. */
export const CHANNEL_KINDS = ['inapp', 'email', 'telegram', 'webpush'] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** How email is batched. Per-filing email at 8 a day is a spam-folder trajectory. */
export const EMAIL_MODES = ['coalesced', 'daily'] as const;

export type EmailMode = (typeof EMAIL_MODES)[number];

export interface InAppChannel {
  readonly kind: 'inapp';
  readonly enabled: boolean;
  readonly config: Record<string, never>;
}

export interface EmailChannel {
  readonly kind: 'email';
  readonly enabled: boolean;
  readonly config: {
    readonly address: string;
    readonly verifiedAt: Date | null;
    readonly mode: EmailMode;
    readonly lastFlushedAt: Date | null;
  };
}

export interface TelegramChannel {
  readonly kind: 'telegram';
  readonly enabled: boolean;
  readonly config: {
    readonly chatId: string;
    /** False after a permanent 403 — blocked, deactivated, never started. */
    readonly deliverable: boolean;
    readonly reason: string | null;
  };
}

export interface WebPushChannel {
  readonly kind: 'webpush';
  readonly enabled: boolean;
  readonly config: {
    readonly endpoint: string;
    readonly p256dh: string;
    readonly auth: string;
  };
}

export type AlertChannel =
  InAppChannel | EmailChannel | TelegramChannel | WebPushChannel;

/**
 * What every user starts with: the in-app view, on.
 *
 * Frozen, because it is a module-level value handed to every new user. A caller
 * that pushed onto it would enable a channel for everyone registered after it.
 */
export const DEFAULT_CHANNELS: readonly AlertChannel[] = Object.freeze([
  Object.freeze({ kind: 'inapp', enabled: true, config: {} }),
]) as readonly AlertChannel[];

/** `hasOwnProperty`, because these keys come out of the database and `constructor` is one. */
const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

const asRecord = (raw: unknown): Record<string, unknown> | null =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const asDate = (value: unknown): Date | null =>
  value instanceof Date && Number.isFinite(value.getTime()) ? value : null;

/**
 * Whether a stored channel is one this code can act on, and its parsed form.
 *
 * `enabled` DEFAULTS TO FALSE when absent, not to true. These are channels that
 * SEND things; a document missing the flag must not start delivering.
 */
export const parseChannel = (raw: unknown): AlertChannel | null => {
  const record = asRecord(raw);
  if (record === null) return null;

  const kind = own(record, 'kind');
  if (typeof kind !== 'string') return null;
  if (!(CHANNEL_KINDS as readonly string[]).includes(kind)) return null;

  const rawEnabled = own(record, 'enabled');
  if (rawEnabled !== undefined && typeof rawEnabled !== 'boolean') return null;
  const enabled = rawEnabled === true;

  const config = asRecord(own(record, 'config')) ?? {};

  if (kind === 'inapp') {
    // The in-app channel is a query: no address, no endpoint, no delivery
    // state. Anything stored in its config is residue and is dropped.
    return { kind, enabled, config: {} };
  }

  if (kind === 'email') {
    const address = asText(own(config, 'address'));
    // A channel with no address cannot deliver, and storing one would mean a
    // fan-out writing outbox rows nothing can ever drain.
    if (address === null) return null;

    const rawMode = own(config, 'mode');
    const mode = rawMode === undefined ? 'coalesced' : rawMode;
    if (!(EMAIL_MODES as readonly unknown[]).includes(mode)) return null;

    return {
      kind,
      enabled,
      config: {
        address,
        verifiedAt: asDate(own(config, 'verifiedAt')),
        mode: mode as EmailMode,
        lastFlushedAt: asDate(own(config, 'lastFlushedAt')),
      },
    };
  }

  if (kind === 'telegram') {
    const chatId = asText(own(config, 'chatId'));
    if (chatId === null) return null;
    return {
      kind,
      enabled,
      config: {
        chatId,
        // Defaults to deliverable. An absent flag means nobody has recorded a
        // failure, which is not the same as a recorded refusal.
        deliverable: own(config, 'deliverable') !== false,
        reason: asText(own(config, 'reason')),
      },
    };
  }

  const endpoint = asText(own(config, 'endpoint'));
  const p256dh = asText(own(config, 'p256dh'));
  const auth = asText(own(config, 'auth'));
  if (endpoint === null || p256dh === null || auth === null) return null;

  return { kind: 'webpush', enabled, config: { endpoint, p256dh, auth } };
};

/**
 * Every channel that parses, in order.
 *
 * DROPS rather than throws, and the direction is deliberate: one unparseable
 * channel on a user document must not be the reason that person cannot sign in.
 */
export const parseChannels = (raw: unknown): readonly AlertChannel[] => {
  if (!Array.isArray(raw)) return [];
  const parsed: AlertChannel[] = [];
  for (const entry of raw) {
    const channel = parseChannel(entry);
    if (channel !== null) parsed.push(channel);
  }
  return parsed;
};
