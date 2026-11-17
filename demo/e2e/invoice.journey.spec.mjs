// User journey: create an invoice, reopen it, see the right customer, total
// and status, and confirm that resubmitting the same form does not create a
// duplicate. Runs against BASE_URL (for example a preview environment) or a
// local server started by playwright.config.mjs.
//
// Use data that is safe to create in the target environment. This journey
// only creates draft invoices in an in-memory store. Against a shared
// preview, use a dedicated test account and data you can clean up.

import { test, expect } from '@playwright/test';

test('create an invoice, reopen it, and retry without duplicating', async ({ page, request }, testInfo) => {
  // Record which revision the app says it is running, so the trace and report
  // are tied to the code that was actually tested.
  const health = await request.get('/health');
  expect(health.ok()).toBeTruthy();
  const { revision } = await health.json();
  testInfo.annotations.push({ type: 'app-revision', description: revision });
  if (process.env.EXPECTED_REVISION) {
    expect(revision, 'the app under test is not the revision this run is meant to verify').toBe(process.env.EXPECTED_REVISION);
  }

  const customer = `Journey ${testInfo.testId.slice(0, 8)} ${Date.now()}`;

  await page.goto('/invoices/new');
  await page.getByLabel('Customer').fill(customer);
  await page.getByLabel('Description').fill('Bare-root saplings');
  await page.getByLabel('Quantity').fill('3');
  await page.getByLabel('Unit price (cents)').fill('29');

  // Capture the submitted form so we can replay it exactly as a retry would.
  const submitted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/invoices'));
  await page.getByRole('button', { name: 'Create invoice' }).click();
  const formBody = (await submitted).postData();

  await expect(page.getByTestId('customer')).toHaveText(customer);
  await expect(page.getByTestId('total')).toHaveText('$0.87');
  await expect(page.getByTestId('status')).toHaveText('draft');
  const id = await page.getByTestId('invoice-id').textContent();

  // Reopen from the list, the way a person would come back to it later.
  await page.goto('/invoices');
  await page.getByRole('link', { name: id, exact: true }).click();
  await expect(page.getByTestId('customer')).toHaveText(customer);
  await expect(page.getByTestId('total')).toHaveText('$0.87');

  // Retry: the same form body, same idempotency key.
  const retry = await request.post('/invoices', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: formBody,
    maxRedirects: 0,
  });
  expect(retry.status()).toBe(303);
  expect(retry.headers().location).toBe(`/invoices/${id}`);

  await page.goto('/invoices');
  await expect(page.getByTestId('invoice-row').filter({ hasText: customer })).toHaveCount(1);
});
