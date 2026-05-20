import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batches } from './ingest.js';

test('batches: empty array yields no batches', () => {
  assert.deepEqual(batches([], 64), []);
});

test('batches: exact multiple splits evenly', () => {
  assert.deepEqual(batches([1, 2, 3, 4], 2), [
    [1, 2],
    [3, 4],
  ]);
});

test('batches: remainder goes in a smaller final batch', () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [
    [1, 2],
    [3, 4],
    [5],
  ]);
});

test('batches: size larger than array yields a single batch', () => {
  assert.deepEqual(batches([1, 2, 3], 64), [[1, 2, 3]]);
});
