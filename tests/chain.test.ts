import { describe, expect, test } from 'bun:test';
import { findChain } from '../src/scan.js';

describe('findChain (BFS over the dependency graph)', () => {
  const graph = {
    a: ['b', 'c'],
    b: ['d'],
    c: ['d', 'e'],
    d: [],
    e: ['a'], // cycle back to a
  };

  test('finds the shortest path from a direct dep', () => {
    expect(findChain(graph, new Set(['a']), 'd')).toEqual(['a', 'b', 'd']);
  });

  test('target that is itself direct returns a single-element path', () => {
    expect(findChain(graph, new Set(['a']), 'a')).toEqual(['a']);
  });

  test('cycles terminate and do not loop forever', () => {
    expect(findChain(graph, new Set(['a']), 'e')).toEqual(['a', 'c', 'e']);
  });

  test('unreachable target → null', () => {
    expect(findChain(graph, new Set(['b']), 'zzz')).toBeNull();
  });

  test('empty direct deps → null', () => {
    expect(findChain(graph, new Set<string>(), 'd')).toBeNull();
  });

  test('multiple roots: nearest root wins', () => {
    expect(findChain(graph, new Set(['a', 'c']), 'e')).toEqual(['c', 'e']);
  });
});
