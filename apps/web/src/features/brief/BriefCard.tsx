import { describeKey } from '../../shared/format/describe';
import { safeHref } from '../../shared/format/safe-href';
import { groupInt } from '../../shared/format/group-int';
import { TIER_TITLE, TOPIC_LABEL } from '../../shared/format/vocab';
import { MarkedText } from '../../shared/ui/MarkedText';
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

/**
 * One company's day, one viewport tall. The Copy control joins the foot in
 * Plan 3 with the other clipboard surfaces.
 */
export function BriefCard({
  entry,
  index,
  total,
  onOpenCompany,
  onPickTopic,
}: BriefCardProps): JSX.Element | null {
  const lede = briefLede(entry);
  if (lede === null) return null;
  const f = lede.filing;
  const rest = entry.claims
    .filter((each) => each !== lede)
    .slice(0, BRIEF_REST_CLAIMS);
  const over = entry.claims.length - 1 - BRIEF_REST_CLAIMS;
  const topic = lede.claim.topic;
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
          {/* THE SERVER'S IST STRING, PRINTED WHOLE — slicing a time of day
              out of it means formatting a timestamp, which this page never
              does. */}
          <span className="bwhen">{`${f.disseminatedAtIst} IST`}</span>
        </div>
      </div>
      <p className="blede" data-ui="brief-lede">
        <MarkedText text={lede.claim.text} />
      </p>
      {/* NULL RATHER THAN AN EMPTY LIST: "nothing was found" and "nothing
          was looked for" are different facts. Echoes are kept here — skipped
          only for the lede, the same rule the feed card applies. */}
      {rest.length > 0 && (
        <ul className="brest" data-ui="brief-rest">
          {rest.map((each, i) => (
            <li key={i}>
              <MarkedText text={each.claim.text} />
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
      {/* Null on a null topic — NOT 'other': a single card has no sum to
          keep, and "Everything else" is a verdict nobody made. */}
      {topic !== null && topic !== undefined && (
        <button
          type="button"
          className="btopic"
          data-ui="brief-topic"
          data-topic={topic}
          onClick={() => onPickTopic(topic)}
        >
          <span className={`mixdot t-${topic}`} />
          <span>{describeKey(TOPIC_LABEL, topic)}</span>
        </button>
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
