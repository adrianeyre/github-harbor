import { describe, expect, it } from 'vitest';
import { parseChangelog } from './changelog';

const sample = `# [1.1.0](https://github.com/adrianeyre/github-clone/compare/v1.0.0...v1.1.0) (2026-11-01)


### Features

* **update:** restore stashes after pulling ([abc1234](https://github.com/adrianeyre/github-clone/commit/abc1234))
* add SSH cloning ([def5678](https://github.com/adrianeyre/github-clone/commit/def5678))

### BREAKING CHANGES

Scripts now need git 2.23.
`;

describe('parseChangelog', () => {
  it('reads semantic-release headings, lists and paragraphs', () => {
    const blocks = parseChangelog(sample);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'heading', 'list', 'heading', 'paragraph']);
    expect(blocks[0]).toMatchObject({ level: 1, content: [{ kind: 'link', text: '1.1.0' }, { kind: 'text', text: ' (2026-11-01)' }] });
    expect(blocks[2]).toMatchObject({
      kind: 'list',
      items: [
        [{ kind: 'strong', text: 'update:' }, { kind: 'text', text: ' restore stashes after pulling (' }, { kind: 'link', text: 'abc1234' }, { kind: 'text', text: ')' }],
        [{ kind: 'text', text: 'add SSH cloning (' }, { kind: 'link' }, { kind: 'text', text: ')' }],
      ],
    });
  });

  it('only links web addresses', () => {
    expect(parseChangelog('* [x](javascript:alert(1))')).toEqual([
      { kind: 'list', items: [[{ kind: 'text', text: '[x](javascript:alert(1)' }, { kind: 'text', text: ')' }]] },
    ]);
  });

  it('is empty before the first release', () => {
    expect(parseChangelog('')).toEqual([]);
  });
});
