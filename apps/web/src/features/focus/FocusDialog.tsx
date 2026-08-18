import { useEffect, useRef, useState } from 'react';
import type { FilingView } from '../../shared/types/api';
import { relativeTime } from '../../shared/format/relative-time';
import { safeHref } from '../../shared/format/safe-href';
import { describeKey } from '../../shared/format/describe';
import { TIER_TITLE } from '../../shared/format/vocab';
import { Insight } from '../../shared/ui/Insight';
import { IconLink } from '../../shared/ui/IconLink';
import { ICON_SOURCE, SOURCE_LABEL } from '../../shared/ui/icons';
import { focusLines, type FocusLine } from './focus-lines';

const SPAN_SHOW = 'Show source line';
const SPAN_HIDE = 'Hide';

/** One quote, whitespace collapsed, quotation marks as TEXT — never markup. */
function SourceSpan({
  label,
  text,
}: {
  readonly label: string;
  readonly text: string;
}): JSX.Element {
  return (
    <div className="focusspan" data-ui="focus-span">
      <span className="focusspanlabel">{label}</span>
      {`"${text.replace(/\s+/g, ' ').trim()}"`}
    </div>
  );
}

/**
 * One claim with its source quotes behind one control. Two quotes from two
 * places, never merged — merging would forge a sentence the document did not
 * print. CLOSED BY DEFAULT (a filing with eight claims otherwise opens as
 * sixteen text blocks), the toggle before the box so a keyboard reader tabs
 * onto the control before the text, and nothing is remembered across a close
 * because the dialog unmounts whole.
 */
function ClaimLine({ line }: { readonly line: FocusLine }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <Insight
        text={line.text}
        direction={line.direction}
        evidence={line.evidence}
      />
      {line.span === '' ? (
        <div className="focusnospan">
          No source sentence is stored for this line.
        </div>
      ) : (
        <>
          <button
            type="button"
            className="spantoggle"
            data-ui="focus-span-toggle"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            {open ? SPAN_HIDE : SPAN_SHOW}
          </button>
          <div className="focusspans" data-ui="focus-spans" hidden={!open}>
            <SourceSpan label="matched in the document" text={line.span} />
            {line.periodSpan !== '' && (
              <SourceSpan label="period from" text={line.periodSpan} />
            )}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Everything one filing said, snapshotted at open. The dialog lives outside
 * the polled tree and holds the filing it was opened with, so no repaint can
 * change it under the reader; closing unmounts it whole, which is both the
 * privacy rule (nothing stays in the document on a shared screen) and what
 * resets every span toggle.
 */
export function FocusDialog({
  filing,
  onClose,
}: {
  readonly filing: FilingView;
  readonly onClose: () => void;
}): JSX.Element {
  const backRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  // TWO-PHASE OPEN: the element renders first, `.open` lands on the NEXT
  // frame — both in one commit and the transition is silently skipped, the
  // exact recorded bug.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Focus moves to Close on open and back to the opener on unmount.
  useEffect(() => {
    const opener = document.activeElement;
    backRef.current?.querySelector<HTMLButtonElement>('#focus-close')?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Escape closes from anywhere; Tab is trapped manually, because
  // aria-modal="true" is a claim the page must honour.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const back = backRef.current;
      if (back === null) return;
      const focusables = back.querySelectorAll<HTMLElement>(
        'button, a[href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const lines = focusLines(filing.enrichment);
  const source = safeHref(filing.attachmentUrl);

  return (
    <div
      id="focus-back"
      ref={backRef}
      className={`focusback${open ? ' open' : ''}`}
      data-ui="focus-back"
      onClick={(event) => {
        // Only a click on the backdrop ITSELF closes — a click that started
        // inside the panel is what selecting a span to copy looks like.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        id="focus"
        className="focuscard"
        data-ui="focus-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-symbol"
      >
        <header className="focushead">
          <div className="who">
            <span id="focus-symbol" className="sym">
              {filing.symbol}
            </span>
            <span id="focus-name" className="coname">
              {filing.companyName}
            </span>
          </div>
          <span
            id="focus-when"
            className="when"
            title={`${filing.disseminatedAtIst} IST`}
          >
            {relativeTime(filing.disseminatedAt)}
          </span>
          <button
            id="focus-close"
            type="button"
            className="focusclose"
            aria-label="Close"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div id="focus-body" className="focusbody">
          {filing.enrichment.resultsLine !== null && (
            <div className="focusresults" data-ui="focus-results">
              {filing.enrichment.resultsLine}
            </div>
          )}
          {lines.length === 0 ? (
            <p className="focusstated" data-ui="focus-stated">
              {filing.outcome}
            </p>
          ) : (
            <ul className="insights" data-ui="focus-claims">
              {lines.map((line, i) => (
                <ClaimLine key={i} line={line} />
              ))}
            </ul>
          )}
        </div>
        <footer id="focus-foot" className="focusfoot">
          <span
            className={`tier tier-${filing.confidenceTier}`}
            data-ui="focus-tier"
            title={describeKey(TIER_TITLE, filing.confidenceTier)}
          >
            {filing.confidenceTierLabel}
          </span>
          <span className="cardcat" data-ui="focus-category">
            {filing.category}
          </span>
          {source !== null && (
            <IconLink
              shapes={ICON_SOURCE}
              label={SOURCE_LABEL}
              ui="focus-source"
              href={source}
            />
          )}
        </footer>
      </div>
    </div>
  );
}
