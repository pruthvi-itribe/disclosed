import { describeKey } from '../../shared/format/describe';
import { TOPIC_LABEL } from '../../shared/format/vocab';
import { topicMix } from './company-model';
import type { FilingView } from '../../shared/types/api';

/**
 * What they say, as one bar over claims — the only floored section on the
 * page, because it is the only distribution.
 *
 * EVERY COLOUR THE BAR DRAWS IS NAMED. The legend used to stop at three,
 * and the segments' own titles were held to cover the rest — but a title
 * is a hover tooltip, and a phone has no hover: on 2026-08-19 a reader
 * asked what the purple stood for, having correctly read orange as
 * capacity from the legend it did reach. A stripe nobody can decode is
 * decoration pretending to be data, which is the same objection that took
 * the unlabelled mix bar off the Brief cover.
 */
export function TopicMix({
  items,
}: {
  readonly items: readonly FilingView[];
}): JSX.Element {
  const mix = topicMix(items);
  return (
    <div id="co-topics-wrap" data-ui="company-topic-mix" hidden={mix === null}>
      <h2 className="bucket">What they say</h2>
      <div id="co-topics" className="mix">
        {(mix ?? []).map((seg) => (
          <div
            key={seg.topic}
            className={`mixseg t-${seg.topic}`}
            style={{ flexGrow: seg.count }}
            title={`${describeKey(TOPIC_LABEL, seg.topic)}: ${seg.count} claim(s)`}
          />
        ))}
      </div>
      <div id="co-topics-legend" className="mixlegend">
        {(mix ?? []).map((seg) => (
          <span key={seg.topic} className="mixitem">
            <span className={`mixdot t-${seg.topic}`} />
            <span>{`${describeKey(TOPIC_LABEL, seg.topic)} ${seg.count}`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
