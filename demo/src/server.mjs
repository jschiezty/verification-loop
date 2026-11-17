// Minimal HTTP app for the journey test. No dependencies.
//   node demo/src/server.mjs            listens on PORT or 4173
// Exposes /health with the commit it was started from, so a smoke test can
// confirm which revision is actually running.

import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createStore, formatCents } from './invoices.mjs';

const store = createStore();
const revision = process.env.APP_REVISION || (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
})();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}label{display:block;margin:.5rem 0}input{font:inherit;padding:.25rem}button{font:inherit;padding:.4rem .8rem}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.3rem;text-align:left}</style>
</head><body>${body}</body></html>`;
}

function newForm() {
  // The idempotency key is minted once per form render, so a double submit
  // or a browser retry of the same form reuses it.
  const key = `form-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return page('New invoice', `<h1>New invoice</h1>
<form method="post" action="/invoices">
<input type="hidden" name="idempotencyKey" value="${key}">
<label>Customer <input name="customer" required></label>
<label>Description <input name="description" required></label>
<label>Quantity <input name="qty" type="number" min="1" step="1" required></label>
<label>Unit price (cents) <input name="unitCents" type="number" min="0" step="1" required></label>
<button type="submit">Create invoice</button>
</form>
<p><a href="/invoices">All invoices</a></p>`);
}

function showInvoice(inv) {
  return page(`Invoice ${inv.id}`, `<h1>Invoice <span data-testid="invoice-id">${esc(inv.id)}</span></h1>
<p>Customer: <strong data-testid="customer">${esc(inv.customer)}</strong></p>
<p>Status: <span data-testid="status">${esc(inv.status)}</span></p>
<table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th></tr></thead><tbody>
${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${l.qty}</td><td>${formatCents(l.unitCents)}</td></tr>`).join('')}
</tbody></table>
<p>Total: <strong data-testid="total">${formatCents(inv.totalCents)}</strong></p>
<p><a href="/invoices">All invoices</a></p>`);
}

function listInvoices() {
  const rows = store.list().map((i) => `<tr data-testid="invoice-row"><td><a href="/invoices/${i.id}">${esc(i.id)}</a></td><td>${esc(i.customer)}</td><td>${formatCents(i.totalCents)}</td></tr>`).join('');
  return page('Invoices', `<h1>Invoices</h1><p><a href="/invoices/new">New invoice</a></p><table><tbody>${rows}</tbody></table>`);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new Error('body too large');
  }
  return raw;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => {
    res.writeHead(status, { 'content-type': type, ...headers });
    res.end(body);
  };
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(200, JSON.stringify({ ok: true, revision }), 'application/json');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/invoices/new')) return send(200, newForm());
    if (req.method === 'GET' && url.pathname === '/invoices') return send(200, listInvoices());
    const m = url.pathname.match(/^\/invoices\/(\d+)$/);
    if (req.method === 'GET' && m) {
      const inv = store.get(m[1]);
      return inv ? send(200, showInvoice(inv)) : send(404, page('Not found', '<h1>Not found</h1>'));
    }
    if (req.method === 'POST' && url.pathname === '/invoices') {
      const form = new URLSearchParams(await readBody(req));
      const result = store.create(
        {
          customer: form.get('customer') || '',
          lines: [{ description: form.get('description') || '', qty: Number(form.get('qty')), unitCents: Number(form.get('unitCents')) }],
        },
        form.get('idempotencyKey') || null,
      );
      if (!result.ok) return send(400, page('Invalid', `<h1>Invalid invoice</h1><ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`));
      return send(303, '', 'text/plain', { location: `/invoices/${result.invoice.id}` });
    }
    send(404, page('Not found', '<h1>Not found</h1>'));
  } catch (err) {
    send(500, page('Error', `<h1>Error</h1><p>${esc(err.message)}</p>`));
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`demo listening on http://127.0.0.1:${port} (revision ${revision.slice(0, 12)})\n`);
});
