import { useEffect, useState } from 'preact/hooks';
import { ApiFailure, NetworkError } from '../api.ts';
import { formatTime } from '../format.ts';
import { useSyncStatus } from '../hooks.ts';
import { getLang, setLang, t, type Lang } from '../i18n/index.ts';
import { getDeviceId } from '../repo.ts';
import { isLoggedIn, login, logout, syncNow } from '../sync.ts';
import { Watches } from './Watches.tsx';

export function Settings() {
  const status = useSyncStatus();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void getDeviceId().then(setDeviceId);
    isLoggedIn()
      .then(setLoggedIn)
      .catch(() => setLoggedIn(null));
  }, [status.phase]);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(passphrase);
      setPassphrase('');
      setLoggedIn(true);
    } catch (err) {
      if (err instanceof NetworkError) setError(t('settings.loginOffline'));
      else if (err instanceof ApiFailure && err.status === 429) setError(t('settings.tooManyAttempts'));
      else if (err instanceof ApiFailure && err.status === 401) setError(t('settings.wrongPassphrase'));
      else setError(t('common.error', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="page">
      <h1 class="page-title">{t('settings.title')}</h1>

      <section class="settings-block" aria-labelledby="sync-title">
        <h2 id="sync-title" class="group-title">
          {t('settings.account')}
        </h2>
        {loggedIn ? (
          <>
            <p>{t('settings.loggedIn')}</p>
            <div class="button-row">
              <button type="button" class="btn btn-primary" onClick={() => void syncNow()} disabled={status.phase === 'syncing'}>
                {t('settings.syncNow')}
              </button>
              <button
                type="button"
                class="btn"
                onClick={async () => {
                  await logout().catch(() => undefined);
                  setLoggedIn(false);
                }}
              >
                {t('settings.logout')}
              </button>
            </div>
          </>
        ) : (
          <form class="form" onSubmit={submit}>
            <p class="hint">{t('settings.loginHint')}</p>
            <label class="field">
              <span class="field-label">{t('settings.passphrase')}</span>
              <input
                class="input"
                type="password"
                autoComplete="current-password"
                required
                value={passphrase}
                aria-invalid={error ? 'true' : undefined}
                onInput={(e) => setPassphrase((e.target as HTMLInputElement).value)}
              />
            </label>
            {error ? (
              <p class="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" class="btn btn-primary btn-large" disabled={busy || passphrase.length === 0}>
              {t('settings.login')}
            </button>
          </form>
        )}
        <p class="muted">{t('settings.pending', { count: status.pending })}</p>
        <p class="muted">{t('settings.lastSync', { time: status.lastSyncAt ? formatTime(status.lastSyncAt) : t('settings.never') })}</p>
        {status.lastError ? <p class="text-bad">{status.lastError}</p> : null}
      </section>

      {loggedIn ? <Watches /> : null}

      <section class="settings-block" aria-labelledby="lang-title">
        <h2 id="lang-title" class="group-title">
          {t('settings.language')}
        </h2>
        <select class="input" aria-labelledby="lang-title" value={getLang()} onChange={(e) => setLang((e.target as HTMLSelectElement).value as Lang)}>
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </section>

      <section class="settings-block" aria-labelledby="device-title">
        <h2 id="device-title" class="group-title">
          {t('settings.device')}
        </h2>
        <p class="muted small">{t('settings.deviceId', { id: deviceId })}</p>
        <p class="muted small">{t('settings.version', { version: __APP_VERSION__ })}</p>
      </section>
    </section>
  );
}
