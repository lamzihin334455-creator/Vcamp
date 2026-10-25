import { expect, it } from 'vitest';
import { MediaFocus } from '../../src/video/media-focus';

it('returns only once from the owned active host in the still-focused window', () => {
  const focus = new MediaFocus(7, 3, 9);
  focus.activated(9, 7);
  expect(focus.takeReturn(9, 7, true)).toBe(3);
  expect(focus.takeReturn(9, 7, true)).toBeUndefined();
});
it('switching away permanently invalidates return even after switching back', () => {
  for (const invalidate of [(f: MediaFocus) => f.activated(4, 7), (f: MediaFocus) => f.windowChanged(-1), (f: MediaFocus) => f.invalidate()]) {
    const focus = new MediaFocus(7, 3, 9); focus.activated(9, 7); invalidate(focus); focus.activated(9, 7);
    expect(focus.takeReturn(9, 7, true)).toBeUndefined();
  }
  const focus = new MediaFocus(7, 3, 9); focus.activated(9, 7);
  expect(focus.takeReturn(9, 7, false)).toBeUndefined();
});
