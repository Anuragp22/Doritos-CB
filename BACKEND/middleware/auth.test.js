import test from 'node:test';
import assert from 'node:assert/strict';
import { cookieOptions } from './auth.js';

test('cookieOptions: production uses cross-site cookie settings', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const opts = cookieOptions();
    assert.equal(opts.sameSite, 'none');
    assert.equal(opts.secure, true);
    assert.equal(opts.httpOnly, true);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('cookieOptions: non-production uses a lax, insecure cookie', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const opts = cookieOptions();
    assert.equal(opts.sameSite, 'lax');
    assert.equal(opts.secure, false);
  } finally {
    process.env.NODE_ENV = prev;
  }
});
