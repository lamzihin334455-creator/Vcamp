import {test,expect} from 'vitest';
import {formatTime,parseTime,validTime} from '../../src/shared/time';
test('time contract uses hours, half-width padded fields and original fractional seconds',()=>{
  expect(formatTime(3599.999)).toBe('59:59');expect(formatTime(3600)).toBe('01:00:00');expect(formatTime(36000)).toBe('10:00:00');
  expect(parseTime('[01:02:03]')).toBe(3723);expect(parseTime('[66:32]')).toBe(3992);expect(parseTime('vcamp-time:12.345')).toBe(12.345);
  for(const value of ['1:2','[01:60]','[01:60:01]','[2026:10:18]','https://x/01:02','javascript:1','vcamp-time:Infinity'])expect(parseTime(value)).toBeNull();
  for(const value of [NaN,Infinity,-1,360000])expect(formatTime(value)).toBe('时间未知');
  expect(validTime(12.4,12)).toBe(false);expect(validTime(12,12)).toBe(true);
});
