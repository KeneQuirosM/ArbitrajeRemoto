import { expect, test, type Page } from '@playwright/test';
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

test('quick match without connection syncs once, without duplicates, when the connection returns', async ({ page, context }) => {
  await login(page);
  await page.goto('/');
  // The app shell must be cached by the service worker before going offline.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

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

  // Reload with no connection: the app opens from the cache and keeps the data.
  await page.reload();
  await expect(page.locator('.side-home .side-score')).toHaveText('1');
  await expect(page.locator('.timeline-item')).toHaveCount(3);
  await expect(page.locator('.sync-badge')).toContainText('Sin conexión');

  await context.setOffline(false);
  await expect(page.locator('.sync-badge')).toHaveText('Sincronizado', { timeout: 15_000 });

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
  expect((await (await page.request.get('/api/v1/matches')).json()).matches).toHaveLength(1);
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
