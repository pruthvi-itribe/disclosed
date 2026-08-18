import { readFileSync } from 'fs';
import { join } from 'path';
import { render } from '@testing-library/react';
import {
  ICON_STAR,
  ICON_COPY,
  ICON_IMAGE,
  ICON_SOURCE,
  ICON_DONE,
  ICON_FAIL,
  SOURCE_LABEL,
} from './icons';
import { IconButton } from './IconButton';
import { IconLink } from './IconLink';

describe('IconButton', () => {
  it('is a button with the drawing hidden and the words on the control', () => {
    const { container } = render(
      <IconButton shapes={ICON_COPY} label="Copy as text" ui="card-copy" />,
    );
    const button = container.querySelector('button.iconbtn');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.getAttribute('data-ui')).toBe('card-copy');
    // BOTH LABELS, ONE STRING: aria-label is what a screen reader hears,
    // title is what a pointer discovers, and they cannot disagree.
    expect(button?.getAttribute('aria-label')).toBe('Copy as text');
    expect(button?.getAttribute('title')).toBe('Copy as text');
  });

  it('draws one svg with the shared stroke style', () => {
    const { container } = render(
      <IconButton shapes={ICON_STAR} label="Watch" ui="watch" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('width')).toBe('17');
    expect(svg?.getAttribute('height')).toBe('17');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('stroke-width')).toBe('1.7');
    // The button carries the words; an unhidden graphic would add a second,
    // empty node beside them. focusable=false keeps old engines from putting
    // every SVG in the tab order.
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(container.querySelector('polygon')).not.toBeNull();
  });

  it('renders every shape of a multi-shape drawing', () => {
    const { container } = render(
      <IconButton
        shapes={ICON_IMAGE}
        label="Copy as image"
        ui="card-copy-image"
      />,
    );
    expect(container.querySelectorAll('rect, circle, polyline')).toHaveLength(
      3,
    );
  });
});

describe('IconLink', () => {
  it('is an anchor that opens elsewhere without a referrer', () => {
    const { container } = render(
      <IconLink
        shapes={ICON_SOURCE}
        label={SOURCE_LABEL}
        ui="card-source"
        href="https://example.invalid/doc.pdf"
      />,
    );
    const link = container.querySelector('a.iconbtn');
    expect(link?.getAttribute('href')).toBe('https://example.invalid/doc.pdf');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('aria-label')).toBe(SOURCE_LABEL);
    expect(link?.getAttribute('title')).toBe(SOURCE_LABEL);
  });
});

describe('the drawings mirror script-icon.ts', () => {
  // The shapes are a PORT: every attribute value must appear verbatim in the
  // fragment they were copied from, so a redrawn icon there fails here.
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'dashboard',
      'src',
      'ui',
      'script',
      'script-icon.ts',
    ),
    'utf8',
  );

  it.each([
    ['ICON_STAR', ICON_STAR],
    ['ICON_COPY', ICON_COPY],
    ['ICON_IMAGE', ICON_IMAGE],
    ['ICON_SOURCE', ICON_SOURCE],
    ['ICON_DONE', ICON_DONE],
    ['ICON_FAIL', ICON_FAIL],
  ])('%s', (_name, shapes) => {
    for (const shape of shapes) {
      for (let i = 2; i < shape.length; i += 2) {
        expect(source).toContain(shape[i]);
      }
    }
  });

  it('SOURCE_LABEL is the fragment wording', () => {
    expect(source).toContain(SOURCE_LABEL);
  });
});
