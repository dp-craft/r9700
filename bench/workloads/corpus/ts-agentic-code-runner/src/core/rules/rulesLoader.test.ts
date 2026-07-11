import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadMarkdownWithImports, stripFrontmatter } from './rulesLoader';

describe('loadMarkdownWithImports', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rules-loader-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = async (name: string, content: string): Promise<void> => {
    await writeFile(join(root, name), content, 'utf8');
  };

  it('should inline the imported content when a bare line-start @import is present', async () => {
    await write('child.md', 'CHILD-BODY');
    await write('parent.md', 'before\n@child.md\nafter');

    const result = await loadMarkdownWithImports(join(root, 'parent.md'), { root });

    expect(result).toBe('before\nCHILD-BODY\nafter');
  });

  it('should expand transitively when A imports B imports C', async () => {
    await write('c.md', 'C-LEAF');
    await write('b.md', 'B-top\n@c.md\nB-bottom');
    await write('a.md', '@b.md');

    const result = await loadMarkdownWithImports(join(root, 'a.md'), { root });

    expect(result).toBe('B-top\nC-LEAF\nB-bottom');
  });

  it('should succeed when the same file is imported on two separate branches (diamond)', async () => {
    await write('d.md', 'D-SHARED');
    await write('b.md', '@d.md');
    await write('c.md', '@d.md');
    await write('a.md', '@b.md\n@c.md');

    const result = await loadMarkdownWithImports(join(root, 'a.md'), { root });

    expect(result).toBe('D-SHARED\nD-SHARED');
  });

  it('should throw when a true cycle exists on the active stack (A->B->A)', async () => {
    await write('a.md', '@b.md');
    await write('b.md', '@a.md');

    await expect(loadMarkdownWithImports(join(root, 'a.md'), { root })).rejects.toThrow(/cycle/i);
  });

  it('should leave a backticked @path literal when it is not a bare import line', async () => {
    await write('x.md', 'SHOULD-NOT-LOAD');
    await write('parent.md', 'see `@x.md` for details');

    const result = await loadMarkdownWithImports(join(root, 'parent.md'), { root });

    expect(result).toBe('see `@x.md` for details');
  });

  it('should leave a mid-line @reference literal when it is not at line start', async () => {
    await write('x.md', 'SHOULD-NOT-LOAD');
    await write('parent.md', 'contact @x.md now');

    const result = await loadMarkdownWithImports(join(root, 'parent.md'), { root });

    expect(result).toBe('contact @x.md now');
  });

  it('should throw naming the offending path and parent when the import target is missing', async () => {
    await write('parent.md', '@nope.md');

    await expect(loadMarkdownWithImports(join(root, 'parent.md'), { root })).rejects.toThrow(
      /nope\.md/
    );
  });

  it('should throw when maxDepth is exceeded', async () => {
    await write('c.md', 'C');
    await write('b.md', '@c.md');
    await write('a.md', '@b.md');

    await expect(
      loadMarkdownWithImports(join(root, 'a.md'), { root, maxDepth: 1 })
    ).rejects.toThrow(/depth/i);
  });

  it('should remove a leading frontmatter block and return the body without leading blank-line cruft', async () => {
    const md =
      '---\nname: code-logic-writer\ntools: Bash\nmodel: opus\n---\nBODY-LINE-1\nBODY-LINE-2';

    expect(stripFrontmatter(md)).toBe('BODY-LINE-1\nBODY-LINE-2');
  });

  it('should return the text unchanged when there is no frontmatter', async () => {
    const md = 'just a heading\nand a paragraph';

    expect(stripFrontmatter(md)).toBe(md);
  });

  it('should leave the text unchanged when the first line is not exactly the fence', async () => {
    const md = '# Title\nsome prose\n---\nthis hr is not frontmatter';

    expect(stripFrontmatter(md)).toBe(md);
  });

  it('should strip only the first leading block and leave later fences untouched', async () => {
    const md = '---\nname: x\n---\nHeader\n\n| a | b |\n| --- | --- |\nrow\n---\nfooter hr';

    expect(stripFrontmatter(md)).toBe('Header\n\n| a | b |\n| --- | --- |\nrow\n---\nfooter hr');
  });

  it('should yield the @import-expanded body after stripping frontmatter', async () => {
    await write('child.md', 'CHILD-BODY');
    await write('agent.md', '---\nname: agent\nmodel: opus\n---\n@child.md\nafter');

    const expanded = await loadMarkdownWithImports(join(root, 'agent.md'), { root });

    expect(stripFrontmatter(expanded)).toBe('CHILD-BODY\nafter');
  });
});
