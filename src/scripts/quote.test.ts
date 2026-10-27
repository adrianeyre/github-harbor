import { describe, expect, it } from 'vitest';
import { normalisePath, psQuote, shPath, shQuote } from './quote';

describe('psQuote', () => {
  it('wraps in single quotes and doubles embedded quotes', () => {
    expect(psQuote("C:\\Code\\it's")).toBe("'C:\\Code\\it''s'");
  });
  it('doubles typographic single quotes, which PowerShell also treats as quotes', () => {
    expect(psQuote('a\u2019b')).toBe("'a\u2019\u2019b'");
  });
  it('leaves $ and backticks literal', () => {
    expect(psQuote('$env:HOME`n')).toBe("'$env:HOME`n'");
  });
});

describe('shQuote / shPath', () => {
  it('escapes single quotes POSIX-style', () => {
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
  });
  it('keeps $ and backticks literal', () => {
    expect(shQuote('$(rm -rf /)`x`')).toBe(`'$(rm -rf /)\`x\`'`);
  });
  it('keeps a leading ~ expandable', () => {
    expect(shPath('~/code/my org')).toBe(`"$HOME"'/code/my org'`);
    expect(shPath('~')).toBe('"$HOME"');
    expect(shPath('/mnt/~x')).toBe(`'/mnt/~x'`);
  });
});

describe('normalisePath', () => {
  it('trims whitespace and trailing separators', () => {
    expect(normalisePath('  /mnt/nas/code/ ')).toBe('/mnt/nas/code');
    expect(normalisePath('\\\\nas\\share\\code\\')).toBe('\\\\nas\\share\\code');
  });
  it('keeps filesystem roots intact', () => {
    expect(normalisePath('C:\\')).toBe('C:\\');
    expect(normalisePath('/')).toBe('/');
  });
});
