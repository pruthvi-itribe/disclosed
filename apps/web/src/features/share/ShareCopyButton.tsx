import { ICON_COPY } from '../../shared/ui/icons';
import {
  ReportingIconButton,
  type IconReport,
} from '../../shared/ui/ReportingIconButton';
import { shareText } from './share-text';
import type { FilingView } from '../../shared/types/api';

/**
 * What the control is for, now that it has no room to say so on its face:
 * a drawing has to name the alternative it is not — the picture beside it.
 */
export const SHARE_COPY_LABEL = 'Copy as text';

/** How long the check mark stays before the control is a copy button again. */
export const COPY_REVERT_MS = 1500;

/**
 * The control that puts the message on the clipboard — one definition for
 * every foot, because the per-surface copies had already drifted once. The
 * clipboard guard is not decoration: navigator.clipboard is absent on an
 * insecure origin, and a dashboard served over plain http must say so
 * rather than throw. The two failure words draw the cross and never revert.
 */
export function ShareCopyButton({
  filing,
  ui,
}: {
  readonly filing: FilingView;
  readonly ui: string;
}): JSX.Element {
  const onActivate = (report: IconReport): void => {
    if (!navigator.clipboard) {
      report.fail('no clipboard');
      return;
    }
    navigator.clipboard.writeText(shareText(filing)).then(
      () => report.done('Copied', COPY_REVERT_MS),
      () => report.fail('failed'),
    );
  };
  return (
    <ReportingIconButton
      shapes={ICON_COPY}
      label={SHARE_COPY_LABEL}
      ui={ui}
      onActivate={onActivate}
    />
  );
}
