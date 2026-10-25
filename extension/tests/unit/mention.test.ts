import { describe, expect, it } from 'vitest';
import { consumeMention, mentionAt, mentionSearchMatches } from '../../src/app/mention';
describe('composer mention and draft preservation', () => {
  it('matches the caret token in Chinese text without consuming the rest of the draft', () => {
    const text = '保留问题 @总结 后文';
    const mention = mentionAt(text, 8);
    expect(mention?.query).toBe('总结');
    expect(consumeMention(text, mention)).toBe('保留问题  后文');
  });
  it('ignores emails, spaces and IME composition', () => {
    expect(mentionAt('a@b', 3)).toBeNull();
    expect(mentionAt('@总结 ', 4)).toBeNull();
    expect(mentionAt('问题 @', 4, true)).toBeNull();
    expect(mentionAt('问题 @', 4, false)?.query).toBe('');
  });
  it('cancel and stale selections keep text untouched', () => {
    expect(consumeMention('原草稿 @模板', null)).toBe('原草稿 @模板');
    expect(consumeMention('另一草稿', { start: 0, end: 3, query: '模板' })).toBe('另一草稿');
  });
  it('matches Chinese names by text, full pinyin and initials', () => {
    expect(mentionSearchMatches('知识笔记','笔记')).toBe(true);
    expect(mentionSearchMatches('知识笔记','zhishibiji')).toBe(true);
    expect(mentionSearchMatches('知识笔记','zsbj')).toBe(true);
    expect(mentionSearchMatches('知识笔记','ditu')).toBe(false);
  });
});
