// Watch pairing (Settings): the watch shows a 6-character code, the owner types it here to approve it.
// Also lists paired watches and revokes their keys. Needs connection and an owner session.

import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiFailure, NetworkError } from '../api.ts';
import { formatDateTime } from '../format.ts';
import { t } from '../i18n/index.ts';
import { ConfirmDialog } from './Dialog.tsx';
import { toast } from './Layout.tsx';

interface Device {
  keyId: string;
  deviceId: string;
  deviceName: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

/** Same alphabet as the server: no 0/O or 1/I/L. Spaces and hyphens are ignored. */
export function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

export const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

function approveError(error: unknown): string {
  if (error instanceof NetworkError) return t('watch.offline');
  if (error instanceof ApiFailure) {
    if (error.code === 'CODE_EXPIRED') return t('watch.expired');
    if (error.code === 'CODE_USED') return t('watch.used');
    if (error.status === 404) return t('watch.notFound');
    if (error.status === 429) return t('watch.tooMany');
    if (error.status === 401) return t('watch.needsLogin');
  }
  return t('common.error', { message: error instanceof Error ? error.message : String(error) });
}

export function Watches() {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const load = async () => {
    try {
      const { data } = await api<{ devices: Device[] }>('GET', '/devices');
      setDevices(data.devices);
      setListError(null);
    } catch (err) {
      setListError(err instanceof NetworkError ? t('watch.offline') : t('watch.listFailed'));
    }
  };

  useEffect(() => {
    void load();
    return () => refreshTimers.current.forEach(clearTimeout);
  }, []);

  const normalized = normalizeCode(code);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!CODE_PATTERN.test(normalized)) {
      setError(t('watch.invalidCode'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { code: normalized };
      if (name.trim()) body.deviceName = name.trim();
      const { data } = await api<{ deviceName: string | null; deviceId: string }>('POST', '/pairing/approve', body);
      setCode('');
      setName('');
      toast(t('watch.approved', { name: data.deviceName ?? data.deviceId }));
      // The watch appears in the list once it collects its key (it asks every 5 s).
      refreshTimers.current.push(setTimeout(() => void load(), 6_000), setTimeout(() => void load(), 15_000));
    } catch (err) {
      setError(approveError(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (device: Device) => {
    try {
      await api('DELETE', `/devices/${encodeURIComponent(device.keyId)}`);
      toast(t('watch.revoked', { name: device.deviceName ?? device.deviceId }));
    } catch (err) {
      toast(err instanceof NetworkError ? t('watch.offline') : t('watch.revokeFailed'));
    } finally {
      setRevoking(null);
      await load();
    }
  };

  const active = devices?.filter((d) => !d.revokedAt) ?? [];
  const revoked = devices?.filter((d) => d.revokedAt) ?? [];

  return (
    <section class="settings-block" aria-labelledby="watch-title">
      <h2 id="watch-title" class="group-title">
        {t('watch.title')}
      </h2>
      <form class="form" onSubmit={submit}>
        <p class="hint">{t('watch.hint')}</p>
        <label class="field">
          <span class="field-label">{t('watch.code')}</span>
          <input
            class="input input-code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellcheck={false}
            maxLength={9}
            required
            value={code}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby="watch-code-hint"
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          />
          <span id="watch-code-hint" class="field-hint">
            {t('watch.codeHint')}
          </span>
        </label>
        <label class="field">
          <span class="field-label">{t('watch.name')}</span>
          <input class="input" type="text" maxLength={60} value={name} placeholder={t('watch.namePlaceholder')} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        {error ? (
          <p class="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" class="btn btn-primary btn-large" disabled={busy || normalized.length === 0}>
          {t('watch.approve')}
        </button>
      </form>

      <div class="subgroup-head">
        <h3 class="subgroup-title">{t('watch.paired')}</h3>
        <button type="button" class="btn btn-quiet" onClick={() => void load()}>
          {t('watch.refresh')}
        </button>
      </div>
      {listError ? <p class="text-bad">{listError}</p> : null}
      {devices && active.length === 0 ? <p class="muted">{t('watch.none')}</p> : null}
      <ul class="device-list">
        {active.map((d) => (
          <li key={d.keyId} class="device-row">
            <div class="device-info">
              <strong>{d.deviceName ?? d.deviceId}</strong>
              <span class="muted small">{t('watch.pairedAt', { date: formatDateTime(d.createdAt) })}</span>
              <span class="muted small">{t('watch.lastSeen', { date: d.lastSeenAt ? formatDateTime(d.lastSeenAt) : t('settings.never') })}</span>
            </div>
            <button type="button" class="btn btn-danger-quiet" onClick={() => setRevoking(d)}>
              {t('watch.revoke')}
            </button>
          </li>
        ))}
      </ul>
      {revoked.length > 0 ? (
        <button type="button" class="link-quiet btn-link" onClick={() => setShowRevoked(!showRevoked)} aria-expanded={showRevoked}>
          {t('watch.showRevoked', { count: revoked.length })}
        </button>
      ) : null}
      {showRevoked ? (
        <ul class="device-list">
          {revoked.map((d) => (
            <li key={d.keyId} class="device-row is-revoked">
              <div class="device-info">
                <strong>{d.deviceName ?? d.deviceId}</strong>
                <span class="muted small">{t('watch.revokedAt', { date: formatDateTime(d.revokedAt) })}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {revoking ? (
        <ConfirmDialog
          danger
          confirmLabel={t('watch.revoke')}
          message={t('watch.revokeConfirm', { name: revoking.deviceName ?? revoking.deviceId })}
          onCancel={() => setRevoking(null)}
          onConfirm={() => void revoke(revoking)}
        />
      ) : null}
    </section>
  );
}
