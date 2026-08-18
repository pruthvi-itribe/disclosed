import { describeKey } from '../../shared/format/describe';
import { TOPIC_LABEL } from '../../shared/format/vocab';
import { topicMix } from './company-model';
import type { FilingView } from '../../shared/types/api';

/**
 * What they say, as one bar over claims — the only floored section on the
 * page, because it is the only distribution. Top-3 legend.
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
        {(mix ?? []).slice(0, 3).map((seg) => (
          <span key={seg.topic} className="mixitem">
            <span className={`mixdot t-${seg.topic}`} />
            <span>{`${describeKey(TOPIC_LABEL, seg.topic)} ${seg.count}`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
