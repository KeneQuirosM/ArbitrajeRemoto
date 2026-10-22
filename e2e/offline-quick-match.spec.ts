import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { E2E_PASSPHRASE } from '../playwright.config.ts';

// Any console error (including Content-Security-Policy violations) fails the test.
// Failed requests while the test is deliberately offline are expected and ignored.
let consoleErrors: string[] = [];
test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch|network connection was lost/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
});
test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

async function login(page: Page) {
  await page.goto('/#/ajustes');
  await page.getByLabel('Frase de acceso').fill(E2E_PASSPHRASE);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByText('Sesión iniciada')).toBeVisible();
}

async function recordPlayerEvent(page: Page, panel: 'home' | 'away', button: string, number: string) {
  await page.locator(`.panel-${panel}`).getByRole('button', { name: button, exact: true }).click();
  await page.getByLabel('Número de jugador').fill(number);
  await page.getByRole('button', { name: number ? 'Registrar' : 'Sin número' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

/** Creates a quick match and records kick-off, a home goal (9) and an away yellow (4) while offline. */
async function offlineQuickMatch(page: Page, context: BrowserContext): Promise<string> {
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Partido rápido' }).click();
  await expect(page.locator('.scoreline')).toContainText('Local');
  const matchId = decodeURIComponent(page.url().split('/partidos/')[1]!);

  await page.getByRole('button', { name: 'Iniciar 1.er tiempo' }).click();
  await recordPlayerEvent(page, 'home', 'Gol', '9');
  await recordPlayerEvent(page, 'away', 'Amarilla', '4');
  await expect(page.locator('.side-home .side-score')).toHaveText('1');
  await expect(page.locator('.sync-badge')).toContainText('Sin conexión');
  await expect(page.locator('.sync-badge')).toContainText('4 pendientes');
  return matchId;
}

// Playwright can serve pages from a service worker only in Chromium ("Service workers are only
// supported on Chromium-based browsers"); in WebKit an offline reload fails inside Playwright itself.
// On a real iPhone this is covered by the manual test (close and reopen the app in airplane mode).
test('the app reopens offline from its cache and keeps the recorded data', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright supports service workers only in Chromium');
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await offlineQuickMatch(page, context);

  await page.reload();
  await expect(page.locator('.side-home .side-score')).toHaveText('1');
  await expect(page.locator('.timeline-item')).toHaveCount(3);
  await expect(page.locator('.sync-badge')).toContainText('Sin conexión');
  await expect(page.locator('.sync-badge')).toContainText('4 pendientes');
});

test('quick match without connection syncs once, without duplicates, when the connection returns', async ({ page, context }) => {
  await login(page);
  await page.goto('/');
  const matchId = await offlineQuickMatch(page, context);

  await context.setOffline(false);
  // 'online' triggers the sync at once; the 30 s periodic sync is the fallback.
  await expect(page.locator('.sync-badge')).toHaveText('Sincronizado', { timeout: 40_000 });

  const read = async () => {
    const res = await page.request.get(`/api/v1/matches/${matchId}?include=events`);
    expect(res.status(), await res.text()).toBe(200);
    return res.json();
  };
  let remote = await read();
  expect(remote.match).toMatchObject({ homeTeamName: 'Local', awayTeamName: 'Visitante' });
  expect(remote.events).toHaveLength(3);
  expect(remote.state.score).toEqual({ home: 1, away: 0 });

  // Forcing more syncs changes nothing.
  await page.goto('/#/ajustes');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect(page.locator('.sync-badge')).toHaveText('Sincronizado');
  }
  remote = await read();
  expect(remote.events).toHaveLength(3);
  // The test server is shared by the parallel browser projects: count only this match.
  const all = (await (await page.request.get('/api/v1/matches')).json()).matches as { id: string }[];
  expect(all.filter((m) => m.id === matchId)).toHaveLength(1);
});

test('undo asks for confirmation and removes the goal from the score', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Partido rápido' }).click();
  await page.getByRole('button', { name: 'Iniciar 1.er tiempo' }).click();
  await recordPlayerEvent(page, 'away', 'Gol', '');
  await expect(page.locator('.side-away .side-score')).toHaveText('1');
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('dialog')).toContainText('Gol de Visitante');
  await page.locator('dialog').getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.side-away .side-score')).toHaveText('0');
});
