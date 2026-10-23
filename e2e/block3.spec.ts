import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSPHRASE } from '../playwright.config.ts';

// Live view, match report and watch pairing, as the owner and a spectator use them.
let consoleErrors: string[] = [];
test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/i.test(message.text())) consoleErrors.push(message.text());
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
  await expect(page.locator('.sync-badge')).toHaveText('Sincronizado', { timeout: 15_000 });
}

async function openTab(page: Page, name: 'Partidos' | 'Ajustes') {
  await page.locator('.tabbar').getByRole('link', { name }).click();
}

async function recordPlayerEvent(page: Page, panel: 'home' | 'away', button: string, number: string) {
  await page.locator(`.panel-${panel}`).getByRole('button', { name: button, exact: true }).click();
  await page.getByLabel('Número de jugador').fill(number);
  await page.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

async function addNote(page: Page, text: string) {
  await page.locator('.board-tools').getByRole('button', { name: 'Nota' }).click();
  await page.getByLabel('Texto (privado, máx. 500)').fill(text);
  await page.locator('dialog').getByRole('button', { name: 'Registrar' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

/** Quick match with kick-off, a home goal by 9 and a private note, synced to the server. */
async function syncedMatch(page: Page, note: string) {
  await login(page);
  await openTab(page, 'Partidos');
  await page.getByRole('button', { name: 'Partido rápido' }).click();
  await page.getByRole('button', { name: 'Iniciar 1.er tiempo' }).click();
  await recordPlayerEvent(page, 'home', 'Gol', '9');
  await addNote(page, note);
  await expect(page.locator('.sync-badge')).toHaveText('Sincronizado', { timeout: 15_000 });
}

test('a spectator follows the match through the live link, never sees notes, and loses access when the link is replaced', async ({ page, browser }) => {
  const note = 'Nota privada del árbitro';
  await syncedMatch(page, note);

  await page.getByRole('button', { name: 'Compartir en vivo' }).click();
  const link = await page.getByLabel('Enlace', { exact: true }).inputValue();
  expect(link).toMatch(/\/#\/vivo\/[0-9a-f-]{36}\/.+/);
  await page.locator('dialog').getByRole('button', { name: 'Cerrar' }).click();

  // A different browser profile: no session, no local data.
  const spectatorContext = await browser.newContext();
  const spectator = await spectatorContext.newPage();
  const spectatorErrors: string[] = [];
  spectator.on('pageerror', (error) => spectatorErrors.push(String(error)));
  await spectator.goto(link);
  await expect(spectator.getByRole('heading', { name: 'En vivo' })).toBeVisible();
  await expect(spectator.locator('.side-home .side-score')).toHaveText('1');
  await expect(spectator.locator('.timeline-list')).toContainText('Gol de Local (n.º 9)');
  await expect(spectator.locator('body')).not.toContainText(note);
  await expect(spectator.locator('.tabbar')).toHaveCount(0);
  await expect(spectator.locator('.sync-badge')).toHaveCount(0);

  // A new goal shows up on the next refresh (every 10 s).
  await recordPlayerEvent(page, 'away', 'Gol', '7');
  await expect(page.locator('.sync-badge')).toHaveText('Sincronizado', { timeout: 15_000 });
  await expect(spectator.locator('.side-away .side-score')).toHaveText('1', { timeout: 15_000 });

  // Replacing the link cuts off the old one.
  await page.getByRole('button', { name: 'Compartir en vivo' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Cambiar enlace' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Cambiar enlace' }).click();
  await expect(page.getByText('Enlace nuevo creado')).toBeVisible();
  await expect(spectator.getByText('Este enlace no es válido')).toBeVisible({ timeout: 15_000 });

  expect(spectatorErrors).toEqual([]);
  await spectatorContext.close();
});

test('the match report lists the goal and shows notes only when asked', async ({ page }) => {
  const note = 'Retraso de 5 minutos por lluvia';
  await syncedMatch(page, note);

  await page.getByRole('link', { name: 'Informe' }).click();
  await expect(page.getByRole('heading', { name: 'Informe del partido' })).toBeVisible();
  await expect(page.locator('.report-score')).toContainText('1 – 0');
  await expect(page.locator('.report')).toContainText('Partido sin terminar');
  const goals = page.locator('.report > section', { has: page.getByRole('heading', { name: 'Goles' }) }).locator('tbody tr');
  await expect(goals).toHaveCount(1);
  await expect(goals.first()).toContainText('9');
  await expect(page.locator('.report')).not.toContainText(note);

  await page.getByLabel('Incluir mis notas (privadas)').check();
  await expect(page.locator('.report')).toContainText(note);
  await expect(page.getByRole('button', { name: 'Imprimir o guardar PDF' })).toBeVisible();
});

test('the owner pairs a watch with its code, the watch gets a working key, and unpairing revokes it', async ({ page, browserName, request }) => {
  await login(page);
  // `request` has its own cookie jar: the watch never carries the owner's session.

  // What the watch does: ask for a code and show it on screen.
  const deviceId = `watch-e2e-${browserName}`;
  const requested = await request.post('/api/v1/pairing/request', { data: { deviceId, deviceName: `Reloj ${browserName}` } });
  expect(requested.status()).toBe(201);
  const { code, pollToken } = await requested.json();
  const poll = () => request.post('/api/v1/pairing/poll', { data: { code, pollToken } });
  expect((await poll()).status()).toBe(202);

  // The owner types it in lower case with a hyphen, as people do.
  await openTab(page, 'Ajustes');
  await page.getByLabel('Código del reloj').fill(`${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()}`);
  await page.getByRole('button', { name: 'Vincular reloj' }).click();
  await expect(page.getByText(`Reloj «Reloj ${browserName}» aprobado`)).toBeVisible();

  // The watch collects its key on its next poll; then it shows up in the list.
  const approved = await poll();
  expect(approved.status()).toBe(200);
  const { deviceKey } = await approved.json();
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  const row = page.locator('.device-row', { hasText: `Reloj ${browserName}` });
  await expect(row).toBeVisible();
  const asWatch = () => request.get('/api/v1/matches', { headers: { Authorization: `Bearer ${deviceKey}` } });
  expect((await asWatch()).status()).toBe(200);

  // A used code cannot be approved twice.
  await page.getByLabel('Código del reloj').fill(code);
  await page.getByRole('button', { name: 'Vincular reloj' }).click();
  await expect(page.getByRole('alert')).toContainText('ya se usó');

  await row.getByRole('button', { name: 'Desvincular' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Desvincular' }).click();
  await expect(page.locator('.device-row:not(.is-revoked)', { hasText: `Reloj ${browserName}` })).toHaveCount(0);
  expect((await asWatch()).status()).toBe(401);
});
