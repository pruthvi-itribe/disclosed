import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';
import { TOPIC_CHIPS } from '../../shared/format/vocab';
import { useAlertTopics } from './use-alert-topics';
import './alerts.css';

/**
 * The topics a reader follows, as pills on the Watching screen (direction
 * 2026-08-19: "watchlisting also can be categories") — the same
 * subscriptions the Profile panel's checkboxes write, worded for the
 * place: here it reads as following, there as notification preference.
 * Both instances take the server's echo, so a toggle in one is correct in
 * the other after its next read; they are two views of one stored list,
 * never two lists.
 */
export function TopicFollows({
  apiSend,
  initialTopics,
}: {
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  readonly initialTopics: readonly string[];
}): JSX.Element {
  const { topics, toggle, failure } = useAlertTopics({
    apiSend,
    initialTopics,
  });
  return (
    <div className="topicfollows" data-ui="topic-follows">
      <h3>Topics you follow</h3>
      <p className="followsnote">
        Alerts for every verified claim on a topic, from any company.
      </p>
      <div className="followpills">
        {TOPIC_CHIPS.filter(([value]) => value !== '').map(
          ([value, label]) => {
            const on = topics.includes(value);
            return (
              <button
                key={value}
                type="button"
                className={`followpill${on ? ' on' : ''}`}
                data-topic={value}
                aria-pressed={on}
                onClick={() => toggle(value, !on)}
              >
                {label}
              </button>
            );
          },
        )}
      </div>
      <div className="doorfail" hidden={failure === null}>
        {failure ?? ''}
      </div>
    </div>
  );
}
