import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOllamaMessages } from './ollama.js';

test('toOllamaMessages: text-only user message', () => {
  const out = toOllamaMessages([
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'hello' }]);
});

test('toOllamaMessages: maps legacy "model" role to "assistant"', () => {
  const out = toOllamaMessages([
    { role: 'model', content: [{ type: 'text', text: 'hi there' }] },
  ]);
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[0].content, 'hi there');
});

test('toOllamaMessages: extracts image and strips the data URI prefix', () => {
  const out = toOllamaMessages([
    {
      role: 'user',
      content: [
        { type: 'image', image: 'data:image/png;base64,QUJD' },
        { type: 'text', text: 'describe this' },
      ],
    },
  ]);
  assert.deepEqual(out, [
    { role: 'user', content: 'describe this', images: ['QUJD'] },
  ]);
});

test('toOllamaMessages: joins multiple text parts with newlines', () => {
  const out = toOllamaMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ],
    },
  ]);
  assert.equal(out[0].content, 'line one\nline two');
});

test('toOllamaMessages: omits images field when there are no images', () => {
  const out = toOllamaMessages([
    { role: 'user', content: [{ type: 'text', text: 'no pics' }] },
  ]);
  assert.equal('images' in out[0], false);
});
