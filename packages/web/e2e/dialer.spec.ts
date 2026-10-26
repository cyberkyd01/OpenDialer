import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * End-to-end flow against the real server (sim telephony):
 *  1. setup wizard → login → campaign → list → CSV import → assign agent → activate
 *  2. agent: join → ready → lead → dial (forced "answer") → talking → hang up → disposition → next lead
 *  3. supervisor dashboard shows the agent live
 *  4. manual dial of a DNC number is refused with the server message
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = { username: 'admin', password: 'password123' };
const AGENT = { username: 'agent1', password: 'password123', displayName: 'Agent One' };

const CSV = [
  'phone,first_name,last_name,company,priority,plan',
  '(415) 555-0101,Alice,Anderson,Acme Inc,10,Gold',
  '212-555-0123,Bob,Brown,Bravo LLC,5,Silver',
  '+1 202 555 0188,Carol,Clark,Charlie Co,0,Bronze',
].join('\n');

let admin: Page;
let agent: Page;

async function newPage(browser: Browser, baseURL: string | undefined) {
  const ctx = await browser.newContext({ baseURL, permissions: ['microphone'] });
  return ctx.newPage();
}

async function login(page: Page, u: { username: string; password: string }) {
  await page.goto('/login');
  await page.locator('input[name=username]').fill(u.username);
  await page.locator('input[name=password]').fill(u.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.beforeAll(async ({ browser }, info) => {
  const baseURL = info.project.use.baseURL;
  admin = await newPage(browser, baseURL);
  agent = await newPage(browser, baseURL);
});

test.afterAll(async () => {
  await admin?.context().close();
  await agent?.context().close();
});

test('admin: setup wizard, login, campaign, list, CSV import, agent assignment, activation', async () => {
  const page = admin;
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.locator('input[name=username]').fill(ADMIN.username);
  await page.locator('input[name=displayName]').fill('Admin User');
  await page.locator('input[name=password]').fill(ADMIN.password);
  await page.locator('input[name=confirm]').fill(ADMIN.password);
  await page.locator('input[name=companyName]').fill('E2E Co');
  await page.locator('select[name=defaultCountry]').selectOption('US');
  await page.locator('select[name=defaultTimezone]').selectOption('UTC');
  await page.getByRole('button', { name: /Create admin/ }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  // log out and back in
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, ADMIN);
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Live dashboard' })).toBeVisible();

  // agent user
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: '+ New user' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('input[name=username]').fill(AGENT.username);
  await dlg.locator('input[name=displayName]').fill(AGENT.displayName);
  await dlg.locator('input[name=password]').fill(AGENT.password);
  await dlg.locator('select[name=role]').selectOption('agent');
  await dlg.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('cell', { name: AGENT.username, exact: true })).toBeVisible();

  // campaign: preview, 24/7, fixed UTC
  await page.getByRole('link', { name: 'Campaigns' }).click();
  await page.getByRole('button', { name: '+ New campaign' }).click();
  const form = page.getByRole('dialog');
  await form.locator('input[name=name]').fill('E2E Campaign');
  await form.locator('select[name=dialMode]').selectOption('preview');
  await form.getByRole('button', { name: '24/7' }).click();
  await form.locator('select[name=timezoneMode]').selectOption('fixed');
  await form.locator('select[name=fixedTimezone]').selectOption('UTC');
  await form.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page).toHaveURL(/\/admin\/campaigns\/\d+$/);
  await expect(page.getByRole('heading', { name: 'E2E Campaign' })).toBeVisible();

  // list + CSV import through the wizard
  await page.getByRole('tab', { name: 'Lists & import' }).click();
  await page.getByLabel('New list name').fill('List A');
  await page.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('cell', { name: 'List A', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const wiz = page.getByRole('dialog');
  await wiz.getByLabel('CSV file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await wiz.getByRole('button', { name: 'Upload & preview' }).click();
  await expect(wiz.getByLabel('Column for Phone')).toHaveValue('phone');
  await expect(wiz.getByLabel('Column for First name')).toHaveValue('first_name');
  await expect(wiz.getByLabel('Column for Priority')).toHaveValue('priority');
  await wiz.getByRole('button', { name: 'Import 3 rows' }).click();
  await expect(wiz.getByTestId('import-result')).toContainText('Imported 3 of 3 rows');
  await wiz.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('row', { name: /List A\s+3/ })).toBeVisible();

  // assign the agent
  await page.getByRole('tab', { name: /^Agents/ }).click();
  await page.getByLabel(new RegExp(AGENT.displayName)).check();
  await page.getByRole('button', { name: 'Save agents' }).click();
  await expect(page.getByRole('tab', { name: 'Agents (1)' })).toBeVisible();

  // activate
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.locator('.page-head .badge')).toHaveText('active');
});

test('agent: join, ready, preview lead, dial, talk, hang up, disposition, next lead', async () => {
  const page = agent;
  await login(page, AGENT);
  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByTestId('phone-status')).toContainText('Simulated');
  // force a deterministic "answered" outcome for the simulated softphone
  await page.evaluate(() => localStorage.setItem('opendialer.simOutcomes', JSON.stringify([{ outcome: 'answer', delayMs: 700 }])));

  await page.getByLabel('Campaign').selectOption({ label: 'E2E Campaign – preview' });
  await page.getByRole('button', { name: 'Join campaign' }).click();
  await expect(page.getByTestId('agent-state')).toHaveAttribute('data-state', 'paused');

  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(page.getByTestId('agent-state')).toHaveAttribute('data-state', 'assigned');
  await expect(page.getByTestId('lead-name')).toHaveText('Alice Anderson');
  await expect(page.getByTestId('lead-phone')).toHaveText('(415) 555-0101');
  await expect(page.getByTestId('lead-card')).toContainText('Gold');

  await page.getByTestId('lead-card').getByRole('button', { name: /Dial/ }).click();
  await expect(page.getByTestId('call-phase')).toHaveAttribute('data-phase', /dialing|ringing/);
  await expect(page.getByTestId('call-phase')).toHaveAttribute('data-phase', 'talking');
  await expect(page.getByTestId('agent-state')).toHaveAttribute('data-state', 'talking');

  await page.getByRole('button', { name: 'Hang up' }).click();
  await expect(page.getByTestId('agent-state')).toHaveAttribute('data-state', 'wrapup');
  const wrap = page.getByTestId('wrapup-panel');
  await wrap.getByRole('button', { name: /Interested/ }).click();
  await wrap.getByLabel('Call notes').fill('Wants a demo next week');
  await wrap.getByRole('button', { name: /Submit – Interested/ }).click();

  await expect(page.getByTestId('lead-name')).toHaveText('Bob Brown');
  await expect(page.getByTestId('agent-state')).toHaveAttribute('data-state', 'assigned');
  await expect(page.getByRole('region', { name: 'Recent calls' })).toContainText('INTERESTED');
});

test('supervisor: live dashboard shows the agent', async () => {
  const page = admin;
  await page.goto('/admin/dashboard');
  const tile = page.locator('[data-testid=agent-tile][data-agent=agent1]');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute('data-state', /^(ready|assigned)$/);
  await expect(tile).toContainText(AGENT.displayName);
  await expect(tile).toContainText('E2E Campaign');
});

test('agent: manual dial of a DNC number is blocked with the server message', async () => {
  // admin puts the number on the DNC list
  await admin.goto('/admin/dnc');
  await admin.getByLabel('DNC phone').fill('+1 312 555 7788');
  await admin.getByRole('button', { name: 'Add to DNC' }).click();
  await expect(admin.getByRole('cell', { name: '(312) 555-7788' })).toBeVisible();

  const page = agent;
  await page.getByRole('button', { name: /Pause/ }).click();
  await page.getByRole('menuitem', { name: 'Break' }).click();
  await expect(page.getByTestId('agent-state')).toHaveAttribute('data-state', 'paused');

  const box = page.getByRole('region', { name: 'Manual dial' });
  await box.getByLabel('Phone number').fill('(312) 555-7788');
  await box.getByRole('button', { name: 'Check DNC' }).click();
  await expect(box.getByTestId('manual-dial-msg')).toContainText('is on the do-not-call list');
  await box.getByRole('button', { name: 'Dial', exact: true }).click();
  await expect(box.getByTestId('manual-dial-msg')).toHaveText('Number is on the do-not-call list');
  await expect(page.getByTestId('agent-state')).toHaveAttribute('data-state', 'paused');
  await expect(page.getByTestId('call-phase')).toHaveCount(0);
});
