import assert from 'node:assert/strict';
import test from 'node:test';
import { cutoutFilename, decodeBase64Png, segmentEnabled } from './segment.js';

test('segmentEnabled reflects SEGMENT_API_URL', () => {
  const original = process.env.SEGMENT_API_URL;
  delete process.env.SEGMENT_API_URL;
  assert.equal(segmentEnabled(), false);
  process.env.SEGMENT_API_URL = 'https://example.modal.run';
  assert.equal(segmentEnabled(), true);
  if (original === undefined) delete process.env.SEGMENT_API_URL;
  else process.env.SEGMENT_API_URL = original;
});

test('cutoutFilename keeps the base name and ends in .png', () => {
  assert.match(cutoutFilename('beach photo.jpg'),
    /^beach_photo-cutout-[a-f0-9]{12}\.png$/);
});

test('cutoutFilename is unique across calls', () => {
  assert.notEqual(cutoutFilename('a.png'), cutoutFilename('a.png'));
});

test('cutoutFilename tolerates a missing name', () => {
  assert.match(cutoutFilename(undefined), /^image-cutout-[a-f0-9]{12}\.png$/);
});

test('decodeBase64Png strips a data: URI prefix', () => {
  const raw = Buffer.from('hello');
  assert.deepEqual(
    decodeBase64Png(`data:image/png;base64,${raw.toString('base64')}`), raw);
  assert.deepEqual(decodeBase64Png(raw.toString('base64')), raw);
});

test('decodeBase64Png rejects an empty payload', () => {
  assert.throws(() => decodeBase64Png(''));
});
