/**
 * Browser smoke tests. No Supabase project is involved: the REST and auth
 * endpoints are answered from tests/fixtures.mjs, so this runs offline and in
 * CI. Start it with `npm test`.
 */

import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './server.mjs';
import { installSupabaseStub } from './supabase-stub.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The session tests deliberately answer 401 (expired access token) and 400 (a
// refresh token the stub refuses to renew). Those responses, and the app's own
// console.error about them, are the expected result rather than a regression.
// The font stylesheet is remote, so it also fails when the suite runs offline.
const EXPECTED_CONSOLE = [
  /status of 40[01]/,
  /AuthError: Your session has expired/,
  /ERR_CONNECTION/,
  /ERR_NAME_NOT_RESOLVED/,
  /fonts\.googleapis/
];

const failures = [];
let errors = [];

async function step(label, run) {
  const before = errors.length;
  try {
    const detail = await run();
    const fresh = errors.slice(before);
    if (fresh.length) throw new Error(fresh.join('\n      '));
    console.log(` ok  ${label}${detail ? `  — ${detail}` : ''}`);
  } catch (error) {
    failures.push(label);
    console.log(`FAIL ${label}\n      ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startStaticServer(root);
const browser = await chromium.launch();
const page = await browser.newPage();

page.on('pageerror', error => errors.push(`uncaught: ${error.message}`));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (!EXPECTED_CONSOLE.some(pattern => pattern.test(text))) errors.push(`console: ${text}`);
});

let supabase = await installSupabaseStub(page);
await page.goto(server.url, { waitUntil: 'domcontentloaded' });

await step('signs in and loads the workspace', async () => {
  await page.fill('#loginEmail', 'michaila@example.ca');
  await page.fill('#loginPassword', 'correct-horse');
  await page.click('.auth-submit');
  await page.waitForSelector('#appShell:not([hidden])');
  await page.waitForSelector('#taskList .task', { state: 'attached' });
});

await step('overview counts overdue, today and this week', async () => {
  const counters = await page.$$eval('.attn', nodes => nodes.map(node => node.textContent));
  assert(counters.some(text => /overdue/.test(text)), 'no overdue counter');
  assert(counters.some(text => /due today/.test(text)), 'no due-today counter');
  return counters.join(' | ');
});

await step('an attention counter filters the list and shows a clearable chip', async () => {
  await page.click('.attn[data-due-filter="overdue"]');
  await page.waitForSelector('#tasksView.active');
  const names = await page.$$eval('#taskList .task strong', nodes => nodes.map(node => node.textContent));
  assert(names.length === 2, `expected the 2 overdue rows, got ${names.length}`);
  assert(await page.locator('#activeFilters .chip').count() === 1, 'no filter chip');
  return names.join(', ');
});

await step('switching to Completed clears a deadline filter instead of emptying the list', async () => {
  await page.click('.filter[data-filter="completed"]');
  const names = await page.$$eval('#taskList .task strong', nodes => nodes.map(node => node.textContent));
  assert(names.length > 0, 'Completed plus a deadline filter showed nothing');
  assert(await page.locator('#activeFilters .chip').count() === 0, 'deadline chip survived');
  await page.click('.filter[data-filter="open"]');
  return names.join(', ');
});

await step('search narrows the list and keeps the date groupings', async () => {
  await page.fill('#taskSearch', 'reconcil');
  await page.waitForTimeout(250);
  const groups = await page.$$eval('.group-label', nodes => nodes.map(node => node.textContent.trim()));
  assert(groups.length > 0, 'grouping disappeared while searching');
  await page.fill('#taskSearch', '');
  await page.waitForTimeout(250);
  return groups.join(' / ');
});

await step('every sort order renders', async () => {
  for (const value of ['priority', 'name', 'created', 'due']) {
    await page.selectOption('#sortBy', value);
    await page.waitForTimeout(60);
  }
});

await step('completing a recurring task schedules exactly one next occurrence', async () => {
  await page.click('.filter[data-filter="all"]');
  await page.locator('#taskList .task', { hasText: 'Monthly bank rec' }).first().locator('.complete').click();
  await page.waitForTimeout(400);
  const claims = supabase.calls.filter(call => call.includes('recurrence_generated=is.false'));
  const inserts = supabase.calls.filter(call => call === 'POST rest/v1/tasks');
  assert(claims.length === 1, `expected 1 conditional claim, got ${claims.length}`);
  assert(inserts.length === 1, `expected 1 new occurrence, got ${inserts.length}`);
});

await step('a task can be edited', async () => {
  await page.locator('#taskList .task', { hasText: 'Due today filing' }).first().locator('.edit').click();
  await page.waitForSelector('#taskDialog[open]');
  await page.fill('#taskName', 'Due today filing (edited)');
  await page.selectOption('#priority', 'high');
  await page.click('#taskSubmit');
  await page.waitForSelector('#taskDialog[open]', { state: 'detached' });
  await page.waitForSelector('#taskList .task:has-text("Due today filing (edited)")', { state: 'attached' });
});

await step('notes and history open, and the hidden note field is not required', async () => {
  await page.locator('#taskList .task', { hasText: 'Overdue reconciliation' }).first().locator('.notes-button').click();
  await page.waitForSelector('#notesDialog[open]');
  await page.waitForSelector('#notesList .note');

  await page.click('.notes-tab[data-tab="history"]');
  await page.waitForSelector('#historyList .history-item');
  assert(await page.$eval('#noteBody', node => !node.required), 'a required control was left inside the hidden panel');

  await page.click('.notes-tab[data-tab="notes"]');
  await page.fill('#noteBody', 'Adding context.');
  await page.click('#noteActions .primary');
  await page.waitForTimeout(300);
  await page.click('[data-close="notesDialog"]');
});

await step('deleting confirms first, then Undo puts the row back once', async () => {
  await page.locator('#taskList .task', { hasText: 'No date backlog' }).first().locator('.delete').click();
  await page.waitForSelector('#confirmDialog[open]');
  await page.click('#confirmAccept');
  await page.waitForSelector('#toastAction:not([hidden])');
  await page.click('#toastAction');
  await page.waitForTimeout(300);
  const restored = await page.locator('#taskList .task', { hasText: 'No date backlog' }).count();
  assert(restored === 1, `expected 1 restored row, got ${restored}`);
});

await step('every view renders', async () => {
  for (const view of ['projects', 'recurring', 'team', 'overview', 'tasks']) {
    await page.click(`.nav-item[data-view="${view}"]`);
    await page.waitForTimeout(80);
  }
});

await step('the theme cycles through light, dark and auto', async () => {
  const seen = [];
  for (let index = 0; index < 3; index += 1) {
    await page.click('#themeToggle');
    seen.push(await page.getAttribute('html', 'data-theme'));
  }
  assert(new Set(seen).size === 3, `expected three themes, saw ${seen.join(', ')}`);
  return seen.join(' → ');
});

await step('four requests hitting an expired token trigger one refresh, not four', async () => {
  supabase.accessTokenExpired = true;
  const before = supabase.refreshes;
  // A visibility change makes the app reload the workspace: four parallel GETs.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1500);

  const refreshes = supabase.refreshes - before;
  assert(supabase.unauthorized >= 2, `expected several parallel 401s, saw ${supabase.unauthorized}`);
  assert(refreshes === 1, `expected 1 refresh for ${supabase.unauthorized} concurrent 401s, got ${refreshes}`);
  assert(await page.$eval('#appShell', node => !node.hidden), 'a routine token refresh signed the user out');
  return `${supabase.unauthorized} 401s → ${refreshes} refresh`;
});

await step('a session that cannot be renewed returns to sign-in with an explanation', async () => {
  supabase = await installSupabaseStub(page, { accessTokenExpired: true, refreshes: 99 });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('#authScreen:not([hidden])', { timeout: 5000 });
  const message = (await page.textContent('#authError')).trim();
  assert(message.length > 0, 'sent back to sign-in with no explanation');
  return message;
});

await browser.close();
await server.close();

console.log(`\n${failures.length ? `${failures.length} failing: ${failures.join(', ')}` : 'all checks passed'}`);
process.exit(failures.length ? 1 : 0);
