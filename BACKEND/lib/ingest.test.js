import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batches, contextualize } from './ingest.js';

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

test('contextualize: paged segment includes filename and page', () => {
  assert.equal(
    contextualize('the body text', 'report.pdf', 4),
    '[report.pdf · p.4] the body text'
  );
});

test('contextualize: unpaged segment includes filename only', () => {
  assert.equal(
    contextualize('the body text', 'notes.txt', null),
    '[notes.txt] the body text'
  );
});
