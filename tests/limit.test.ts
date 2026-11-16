import { describe, expect, test } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { limiter, mapLimit } from '../src/limit.js';

describe('mapLimit', () => {
  test('keeps input order and never runs more than max at once', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (ms) => {
      active++;
      peak = Math.max(peak, active);
      await sleep(ms);
      active--;
      return ms * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });

  test('a failed task frees its slot', async () => {
    const run = limiter(1);
    await expect(run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await run(async () => 'next')).toBe('next');
  });
});
