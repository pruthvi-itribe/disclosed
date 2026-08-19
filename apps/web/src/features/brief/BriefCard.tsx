import { useState } from 'react';
import { describeKey } from '../../shared/format/describe';
import { relativeTime } from '../../shared/format/relative-time';
import { safeHref } from '../../shared/format/safe-href';
import { groupInt } from '../../shared/format/group-int';
import { TIER_TITLE, TOPIC_LABEL } from '../../shared/format/vocab';
import { BriefCopyButton } from './BriefCopyButton';
import { GlossedText } from './GlossedText';
import { briefGist } from './gist';
import type { Jargon } from './jargon';
import {
  briefLede,
  BRIEF_REST_CLAIMS,
  type BriefCandidate,
} from './brief-model';

export interface BriefCardProps {
  readonly entry: BriefCandidate;
  readonly index: number;
  readonly total: number;
  readonly onOpenCompany: (symbol: string) => void;
  /**
   * Sets the topic and nothing else — deliberately NOT the chip row's
   * both-axes write. The asymmetry is shipped behaviour and parity keeps it.
   */
  readonly onPickTopic: (topic: string) => void;
}

/** One company's day, one viewport tall. */
export function BriefCard({
  entry,
  index,
  total,
  onOpenCompany,
  onPickTopic,
}: BriefCardProps): JSX.Element | null {
  // What the reader asked about, if anything. Per card and forgotten with
  // it: a card unmounts whole, the way the focus dialog does.
  const [asked, setAsked] = useState<{
    readonly term: Jargon;
    readonly matched: string;
  } | null>(null);
  const ask = (term: Jargon, matched: string): void =>
    setAsked((was) => (was?.matched === matched ? null : { term, matched }));
  // The lede is cut at a boundary the claim printed when it is too long
  // to be a headline; the rest is one tap away and nothing is rewritten.
  const [whole, setWhole] = useState(false);
  const lede = briefLede(entry);
  if (lede === null) return null;
  const f = lede.filing;
  const rest = entry.claims
    .filter((each) => each !== lede)
    .slice(0, BRIEF_REST_CLAIMS);
  const over = entry.claims.length - 1 - BRIEF_REST_CLAIMS;
  const topic = lede.claim.topic;
  // THE SERVER'S HEADLINE FIRST, when the gate admitted one: a slice of
  // the document's own sentence, verified character for character. The
  // client's own cutter is the fallback for everything not yet asked
  // about or refused, and the full claim is the fallback for that.
  const stored = lede.claim.gist ?? null;
  const gist =
    stored === null || stored === ''
      ? briefGist(lede.claim.text)
      : { line: stored, cut: stored.length < lede.claim.text.length };
  const source = safeHref(f.attachmentUrl);

  return (
    <article
      className="bcard"
      data-ui="brief-card"
      data-symbol={entry.symbol}
      data-seq={f.seqId}
      data-index={index}
      role="group"
      aria-label={`Card ${index + 1} of ${total}, ${entry.symbol}`}
      tabIndex={-1}
    >
      <div className="bident" data-ui="brief-ident">
        <button
          type="button"
          className="bsym"
          title={`All filings from ${entry.symbol}`}
          onClick={() => onOpenCompany(entry.symbol)}
        >
          {entry.symbol}
        </button>
        <div className="bmeta">
          <span className="bname">{entry.companyName}</span>
          {/* HOW LONG AGO, with the server's IST string on the title —
              the feed card's and the focus dialog's rule, arriving here
              on 2026-08-19 ("lets add human readable timestamp instead
              of IST"). This is NOT the browser formatting a timestamp:
              relativeTime is a difference between two instants, the same
              number in every timezone, and the absolute time a reader
              cites is still the one the server computed. */}
          <span className="bwhen" title={`${f.disseminatedAtIst} IST`}>
            {relativeTime(f.disseminatedAt)}
          </span>
        </div>
      </div>
      {/* Null on a null topic — NOT 'other': a single card has no sum to
          keep, and "Everything else" is a verdict nobody made. */}
      {topic !== null && topic !== undefined && (
        <button
          type="button"
          className="btopic beyebrow"
          data-ui="brief-topic"
          data-topic={topic}
          onClick={() => onPickTopic(topic)}
        >
          <span className={`mixdot t-${topic}`} />
          <span>{describeKey(TOPIC_LABEL, topic)}</span>
        </button>
      )}
      <p className="blede" data-ui="brief-lede">
        <GlossedText text={whole ? lede.claim.text : gist.line} onAsk={ask} />
        {gist.cut && !whole && (
          <button
            type="button"
            className="bwhole"
            data-ui="brief-lede-more"
            aria-label="Show the rest of this sentence"
            onClick={() => setWhole(true)}
          >
            …
          </button>
        )}
      </p>
      {/* NULL RATHER THAN AN EMPTY LIST: "nothing was found" and "nothing
          was looked for" are different facts. Echoes are kept here — skipped
          only for the lede, the same rule the feed card applies. */}
      {rest.length > 0 && (
        <ul className="brest" data-ui="brief-rest">
          {rest.map((each, i) => (
            <li key={i}>
              <GlossedText text={each.claim.text} onAsk={ask} />
            </li>
          ))}
        </ul>
      )}
      {/* Never an in-card expander: a card that grows stops being one
          viewport, and scroll-snap on uneven children lands between cards. */}
      {over > 0 && (
        <button
          type="button"
          className="bmore"
          onClick={() => onOpenCompany(entry.symbol)}
        >
          {`+ ${groupInt(over)} more from ${entry.symbol}`}
        </button>
      )}
      {/* WHAT KIND OF NEWS THIS IS, said before the claim rather than
          after it: a reader meeting a wall of a sentence wants the
          category first (persona review 2026-08-19 — the card was read
          twice to work out what it was about). Still the chip that
          filters the feed by that topic; it has only moved. */}
      {asked !== null && (
        <div className="bgloss" data-ui="brief-gloss">
          <span className="bglossterm">{asked.term.term(asked.matched)}</span>
          <span className="bglossplain">{asked.term.plain}</span>
          <span className="bglossours">our words, not the filing’s</span>
        </div>
      )}
      <footer className="bfoot" data-ui="brief-foot">
        <span
          className={`tier tier-${f.confidenceTier}`}
          title={describeKey(TIER_TITLE, f.confidenceTier)}
        >
          {f.confidenceTierLabel}
        </span>
        <span className="bcat" title={f.category}>
          {f.category}
        </span>
        <span className="grow" />
        <BriefCopyButton
          symbol={entry.symbol}
          texts={entry.claims.map((each) => each.claim.text)}
        />
        {source !== null && (
          <a
            className="srclink"
            href={source}
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            Source
          </a>
        )}
      </footer>
    </article>
  );
}
