// A tiny invoice store used as a target for the example checks.
// Set DEMO_BUG to seed one of two regressions and watch which checks catch it:
//   DEMO_BUG=duplicate-on-retry   retrying with the same idempotency key makes a second invoice
//   DEMO_BUG=float-total          totals are summed in floating point dollars, then rounded

export function createStore({ bug = process.env.DEMO_BUG || '' } = {}) {
  const invoices = new Map();
  const byKey = new Map();
  let next = 1;

  function totalCents(lines) {
    if (bug === 'float-total') {
      const dollars = lines.reduce((sum, l) => sum + l.qty * (l.unitCents / 100), 0);
      return Math.floor(dollars * 100);
    }
    return lines.reduce((sum, l) => sum + l.qty * l.unitCents, 0);
  }

  function validate(input) {
    const errors = [];
    if (!input || typeof input.customer !== 'string' || !input.customer.trim()) errors.push('customer is required');
    if (!Array.isArray(input?.lines) || input.lines.length === 0) errors.push('at least one line is required');
    for (const l of input?.lines || []) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) errors.push('qty must be a positive integer');
      if (!Number.isInteger(l.unitCents) || l.unitCents < 0) errors.push('unitCents must be a non-negative integer');
    }
    return errors;
  }

  function create(input, idempotencyKey) {
    const errors = validate(input);
    if (errors.length) return { ok: false, errors };
    if (idempotencyKey && byKey.has(idempotencyKey) && bug !== 'duplicate-on-retry') {
      return { ok: true, invoice: invoices.get(byKey.get(idempotencyKey)), replayed: true };
    }
    const id = String(next++);
    const invoice = {
      id,
      customer: input.customer.trim(),
      lines: input.lines.map((l) => ({ description: String(l.description || ''), qty: l.qty, unitCents: l.unitCents })),
      totalCents: totalCents(input.lines),
      status: 'draft',
    };
    invoices.set(id, invoice);
    if (idempotencyKey) byKey.set(idempotencyKey, id);
    return { ok: true, invoice, replayed: false };
  }

  return {
    create,
    get: (id) => invoices.get(id) || null,
    list: () => [...invoices.values()],
    totalCents,
  };
}

export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
