import { test, expect, type Page } from '@playwright/test';

const clientId = process.env.E2E_CLIENT_ID ?? 'test-client';
const secret = process.env.E2E_CLIENT_SECRET ?? 'test-secret';
async function login(page: Page) {
  await page.getByLabel('Client ID', { exact: true }).fill(clientId);
  await page.getByLabel('Client secret', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("You're ready to publish")).toBeVisible();
}

test('login, publish, wait, display jobs newest first, and keep history on logout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to publishing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Publishing workspace' })).not.toBeVisible();
  await page.getByLabel('Client ID', { exact: true }).fill(clientId);
  await page.getByLabel('Client secret', { exact: true }).fill('wrong-secret');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid client credentials.');
  await login(page);
  await page.getByRole('button', { name: 'DOC001', exact: true }).click();
  await page.getByRole('button', { name: 'Publish document' }).click();
  const first = page.getByRole('article', { name: 'Publication DOC001', exact: true });
  await expect(first).toBeVisible();
  await expect(first.getByText('Done', { exact: true })).toBeVisible();
  await expect(first.getByText('Delivered and reported')).toBeVisible();
  await expect(first.getByText('Vendor attempts: 1')).toBeVisible();
  await page.getByLabel('Document ID', { exact: true }).fill('MISSING');
  await page.getByRole('button', { name: 'Publish document' }).click();
  const failed = page.getByRole('article', { name: 'Publication MISSING', exact: true });
  await expect(failed.getByText('Failed', { exact: true })).toBeVisible();
  await expect(failed.getByText('SOURCE API returned 404.')).toBeVisible();
  await expect(page.getByRole('article').first()).toHaveAccessibleName('Publication MISSING');
  // A second request ID returns the existing document job rather than another row.
  await page.getByLabel('Document ID', { exact: true }).fill('DOC001');
  await page.getByRole('button', { name: 'Publish document' }).click();
  const conflict = page.getByRole('alertdialog', { name: 'Document already submitted' });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText('DOC001 already has a publication job. No new publication was started.');
  await expect(conflict.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await conflict.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(conflict).not.toBeVisible();
  await expect(first.getByText('Done', { exact: true })).toBeVisible();
  await expect(page.getByText('This document was already submitted.', { exact: false })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article').first()).toHaveAccessibleName('Publication MISSING');
  await page.getByRole('button', { name: 'Publish document' }).click();
  await expect(conflict).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(conflict).not.toBeVisible();
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  expect(storage).toEqual({ local: 0, session: 0 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('article')).toHaveCount(0);
  await login(page); await expect(page.getByRole('article')).toHaveCount(2);
  await page.reload(); await expect(page).toHaveURL(/\/login$/);
  await login(page); await expect(page.getByText('No publications yet')).toBeVisible();
  expect(errors).toEqual([]);
});

test('guards direct workspace access and browser history, and redirects expired sessions', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Publishing workspace' })).not.toBeVisible();
  await login(page);
  await page.getByRole('link', { name: 'Fineline publishing home' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.route('**/api/publish', (route) => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Expired' } } }));
  await page.getByRole('button', { name: 'DOC002', exact: true }).click();
  await page.getByRole('button', { name: 'Publish document' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('alert')).toContainText('session has expired');
  await expect(page.getByRole('heading', { name: 'Publishing workspace' })).not.toBeVisible();
  await page.evaluate(() => { history.pushState(null, '', '/workspace'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Publishing workspace' })).not.toBeVisible();
});

test('renders a waiting job on mobile, then its failure reason safely', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let statusReads = 0;
  await page.route('**/api/publish', (route) => route.fulfill({ status: 202, json: { jobId: 'mobile-job' } }));
  await page.route('**/api/jobs/mobile-job', (route) => {
    statusReads++;
    return route.fulfill({ json: {
      jobId: 'mobile-job', documentId: 'DOC002', requestId: 'REQ002', status: statusReads === 1 ? 'running' : 'failed',
      step: 'reporting', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), vendorAttempts: 4,
      deliveryOutcome: 'not_sent', sourceStatusWritten: statusReads > 1,
      ...(statusReads > 1 ? { error: { code: 'VENDOR_HTTP_500', message: '<script>alert("unsafe")</script> Vendor delivery failed.' } } : {}),
    } });
  });
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: 'DOC002', exact: true }).click();
  await page.getByRole('button', { name: 'Publish document' }).click();
  const job = page.getByRole('article', { name: 'Publication DOC002' });
  await expect(job.getByText('Running', { exact: true })).toBeVisible();
  await expect(job.getByText('Failed', { exact: true })).toBeVisible();
  await expect(job.getByText('Vendor attempts: 4')).toBeVisible();
  await expect(job.getByText('<script>alert("unsafe")</script> Vendor delivery failed.')).toBeVisible();
  await page.waitForTimeout(1200); expect(statusReads).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-workspace.png', fullPage: true });
});
