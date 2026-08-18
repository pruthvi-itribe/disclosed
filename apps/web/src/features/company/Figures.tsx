import { describeKey } from '../../shared/format/describe';
import { METRIC_LABEL } from '../../shared/format/vocab';
import { figureBlocks } from './company-model';
import type { FilingView } from '../../shared/types/api';

/**
 * The numbers, as printed. NOTHING IS COMPUTED — no change, growth rate,
 * margin or percentage: results-line.ts holds the argument, and a
 * competitor's rescaled line published a margin of 13.32% where its own
 * numbers give 13.23%. The values are currentDisplay/priorDisplay as the
 * server rendered them; the word is 'vs' and never an arrow. Hidden for
 * almost everyone (15 of 1,286 companies on 2026-08-08), which is the
 * section working rather than failing.
 */
export function Figures({
  items,
}: {
  readonly items: readonly FilingView[];
}): JSX.Element {
  const blocks = figureBlocks(items);
  return (
    <div
      id="co-figures-wrap"
      data-ui="company-figures"
      hidden={blocks.length === 0}
    >
      <h2 className="bucket">The numbers, as printed</h2>
      <p className="sectionnote" data-ui="company-figures-note">
        The filing&apos;s own table, in the filing&apos;s own scale. Nothing
        here is rescaled and no change, margin or percentage is computed from it
        — the table row each figure was read from is in its title.
      </p>
      <div id="co-figures" className="figures">
        {blocks.map((block, i) => (
          <section key={i} className="figblock" data-ui="company-figure-block">
            <div className="fighead">
              <span className="figperiod">{block.results.period}</span>
              {/* NEVER ABBREVIATED: consolidated and standalone statements
                  in one filing differ by tens of per cent, and the heading
                  that fixed which one this is was quoted for this moment. */}
              <span
                className="figbasis"
                title={
                  block.results.basisSpan
                    ? `The document printed: "${block.results.basisSpan}"`
                    : undefined
                }
              >
                {block.results.basis}
              </span>
              <span
                className="figwhen"
                title={`${block.disseminatedAtIst} IST`}
              >
                {block.istDay}
              </span>
            </div>
            <ul className="figrows">
              {block.figures.map((figure, f) => (
                <li
                  key={f}
                  className="figrow"
                  data-ui="company-figure"
                  title={`The document printed: "${figure.span}"`}
                >
                  <span className="figmetric">
                    {describeKey(METRIC_LABEL, figure.metric)}
                  </span>
                  <span className="figvalue">{figure.currentDisplay}</span>
                  <span className="figprior">
                    {`vs ${figure.priorDisplay} · ${block.results.priorPeriod}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
