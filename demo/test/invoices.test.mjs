// Unit and property-style checks for the invoice store. Uses node:test only.
// The property tests use a small seeded generator instead of a library so the
// demo has no dependencies; in a real project, fast-check or Hypothesis does
// this better (shrinking, replay).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/invoices.mjs';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomLines(rand) {
  const n = 1 + Math.floor(rand() * 5);
  return Array.from({ length: n }, () => ({ description: 'item', qty: 1 + Math.floor(rand() * 20), unitCents: Math.floor(rand() * 100000) }));
}

const SEED = Number(process.env.PROPERTY_SEED || 20261117);
const RUNS = 500;

test('rejects an invoice without a customer', () => {
  const store = createStore();
  const r = store.create({ customer: ' ', lines: [{ qty: 1, unitCents: 100 }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /customer/);
});

test('property: total equals the exact sum of qty times unit price, in cents', () => {
  const rand = rng(SEED);
  const store = createStore();
  for (let i = 0; i < RUNS; i++) {
    const lines = randomLines(rand);
    const expected = lines.reduce((s, l) => s + l.qty * l.unitCents, 0);
    const { invoice } = store.create({ customer: 'Acme', lines });
    assert.equal(invoice.totalCents, expected, `seed ${SEED}, run ${i}: ${JSON.stringify(lines)}`);
  }
});

test('property: retrying with the same idempotency key never creates a second invoice', () => {
  const rand = rng(SEED + 1);
  const store = createStore();
  for (let i = 0; i < RUNS; i++) {
    const key = `k-${i}`;
    const input = { customer: `C${i}`, lines: randomLines(rand) };
    const first = store.create(input, key);
    const retries = 1 + Math.floor(rand() * 3);
    for (let r = 0; r < retries; r++) {
      const again = store.create(input, key);
      assert.equal(again.invoice.id, first.invoice.id, `seed ${SEED + 1}, run ${i}, retry ${r}`);
    }
  }
  assert.equal(store.list().length, RUNS);
});
