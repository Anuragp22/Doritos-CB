import assert from 'node:assert/strict';
import test from 'node:test';
import { toBox, toNaturalPoint } from './coords.js';

test('toNaturalPoint scales display pixels to natural pixels', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const natural = { width: 1000, height: 500 };
  assert.deepEqual(toNaturalPoint(50, 50, rect, natural), { x: 500, y: 250 });
});

test('toNaturalPoint accounts for the element offset', () => {
  const rect = { left: 20, top: 10, width: 100, height: 100 };
  const natural = { width: 200, height: 200 };
  assert.deepEqual(toNaturalPoint(70, 60, rect, natural), { x: 100, y: 100 });
});

test('toNaturalPoint clamps to the image bounds', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const natural = { width: 1000, height: 500 };
  assert.deepEqual(toNaturalPoint(200, -10, rect, natural), { x: 999, y: 0 });
});

test('toBox normalises a drag into x0<x1, y0<y1', () => {
  assert.deepEqual(toBox({ x: 80, y: 90 }, { x: 10, y: 20 }), [10, 20, 80, 90]);
  assert.deepEqual(toBox({ x: 5, y: 5 }, { x: 25, y: 35 }), [5, 5, 25, 35]);
});
