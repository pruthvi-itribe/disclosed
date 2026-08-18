import { IconSvg } from './IconSvg';
import type { IconShape } from './icons';

/**
 * The link twin of IconButton — same one-string label rule, and the rel that
 * keeps an exchange-hosted document from holding a handle to this page.
 * Callers pass an href that has already been through safeHref; this component
 * never checks, because a null href means the caller draws nothing at all.
 */
export function IconLink({
  shapes,
  label,
  ui,
  href,
}: {
  readonly shapes: readonly IconShape[];
  readonly label: string;
  readonly ui: string;
  readonly href: string;
}): JSX.Element {
  return (
    <a
      className="iconbtn"
      data-ui={ui}
      aria-label={label}
      title={label}
      href={href}
      rel="noopener noreferrer nofollow"
      target="_blank"
    >
      <IconSvg shapes={shapes} />
    </a>
  );
}
