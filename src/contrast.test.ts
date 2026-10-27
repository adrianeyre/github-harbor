/**
 * Checks the colour tokens in styles.css meet WCAG 2.2 AA contrast in both themes:
 * 4.5:1 for text (1.4.3) and 3:1 for control boundaries, icons and focus outlines (1.4.11).
 * Translucent "soft" backgrounds are composited over the surface they sit on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const darkBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: light)'));
const lightBlock = css.slice(css.indexOf('@media (prefers-color-scheme: light)'), css.indexOf('/* ---------- Base'));
const themes = { dark: tokens(darkBlock), light: { ...tokens(darkBlock), ...tokens(lightBlock) } };

type Rgba = [number, number, number, number];

function parse(color: string): Rgba {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgba = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], +rgba[4]];
  throw new Error(`Unparsed colour ${color}`);
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` on `bg`, where `bg` may be "soft@surface" for a translucent token over another. */
function contrast(t: Record<string, string>, fg: string, bg: string): number {
  const [top, base] = bg.split('@');
  const background = base ? over(parse(t[top]), parse(t[base])) : parse(t[top]);
  return ratio(over(parse(t[fg]), background), background);
}

const TEXT: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'],
  ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-2'], ['text-muted', 'accent-soft@surface'],
  ['accent-text', 'bg'], ['accent-text', 'surface'], ['accent-text', 'accent-soft@surface'],
  ['link', 'surface'], ['link', 'bg'], ['link', 'info-soft@surface'],
  ['on-accent', 'accent'],
  ['danger', 'surface'], ['warning', 'surface'], ['warning', 'warning-soft@surface'],
  ['text', 'warning-soft@surface'], ['text', 'info-soft@surface'],
  ['code-text', 'surface-sunken'],
];

const NON_TEXT: [string, string][] = [
  ['control-border', 'bg'], ['control-border', 'surface'], ['control-border', 'surface-2'],
  ['accent', 'surface'], ['accent', 'bg'],
  ['focus', 'bg'], ['focus', 'surface'], ['focus', 'surface-2'],
  ['danger', 'bg'], ['info', 'info-soft@surface'],
];

describe.each(Object.entries(themes))('%s theme contrast', (_name, t) => {
  it.each(TEXT)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(t, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(NON_TEXT)('%s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(t, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
