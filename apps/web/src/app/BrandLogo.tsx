/**
 * The mark, ported from logo.ts BRAND_LOGO: the gradient tile, the D, the
 * folded document with its flash corner, and the two text lines — every
 * colour a token, so the mark repaints with the palette. logo.css (ported
 * verbatim, mirror-checked) owns its layout.
 */
export function BrandLogo(): JSX.Element {
  return (
    <span className="logo" data-ui="brand-logo">
      <svg
        className="logomark"
        viewBox="0 0 32 32"
        width="32"
        height="32"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient
            id="brandtile"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="32"
            y2="32"
          >
            <stop offset="0" stopColor="var(--brand-1)" />
            <stop offset="1" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="7" fill="url(#brandtile)" />
        <path
          d="M9 5H14.8A11 11 0 0 1 14.8 27H9A2.8 2.8 0 0 1 6.2 24.2V7.8A2.8 2.8 0 0 1 9 5Z"
          fill="var(--brand-ink)"
        />
        <path
          d="M12 8.7H17.3L22 13.4V21.2A2 2 0 0 1 20 23.2H12A2 2 0 0 1 10 21.2V10.7A2 2 0 0 1 12 8.7Z"
          fill="url(#brandtile)"
        />
        <path d="M17.3 9.8V13.7H21.2Z" fill="var(--flash)" />
        <path
          d="M12.7 16.9H18M12.7 19.7H15.7"
          stroke="var(--brand-ink)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <span className="logotype">
        Disclosed
        <span className="dotmark">.</span>
      </span>
    </span>
  );
}
