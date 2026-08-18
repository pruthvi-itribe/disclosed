import { ICON_IMAGE } from '../../shared/ui/icons';
import {
  ReportingIconButton,
  type IconReport,
} from '../../shared/ui/ReportingIconButton';
import { SHARE_IMAGE_LABEL } from './share-plan';
import { shareDeliver } from './share-deliver';
import { shareCard } from './share-paint';
import { marksReady, shareMarks } from './share-marks';
import type { FilingView } from '../../shared/types/api';

/**
 * The second thing a reader can do with a filing, beside the first. It
 * refuses only when NEITHER mark has arrived — the favicon decodes from a
 * data: URI at load and the raster is a same-origin request, so a card can
 * be drawn as soon as either lands, and a picture that silently arrived
 * without a logo would look like a design choice rather than a failure.
 */
export function ShareImageButton({
  filing,
  ui,
}: {
  readonly filing: FilingView;
  readonly ui: string;
}): JSX.Element {
  const onActivate = (report: IconReport): void => {
    if (!marksReady()) {
      report.fail('not ready', 2000);
      return;
    }
    shareDeliver(shareCard(filing, shareMarks()), filing.symbol, report);
  };
  return (
    <ReportingIconButton
      shapes={ICON_IMAGE}
      label={SHARE_IMAGE_LABEL}
      ui={ui}
      onActivate={onActivate}
    />
  );
}
