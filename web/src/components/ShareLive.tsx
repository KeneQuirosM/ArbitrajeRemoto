// Owner dialog with the public live link: share, copy, open, or replace it with a new one.

import { useState } from 'preact/hooks';
import { api } from '../api.ts';
import { t } from '../i18n/index.ts';
import { liveUrl } from '../live.ts';
import { setLiveToken } from '../repo.ts';
import type { LocalMatch } from '../db.ts';
import { ConfirmDialog, Dialog } from './Dialog.tsx';
import { toast } from './Layout.tsx';

export function ShareLiveDialog(props: { match: LocalMatch; onClose: () => void }) {
  const { match } = props;
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = match.liveToken ? liveUrl(location.origin, match.id, match.liveToken) : null;
  const title = t('share.text', { home: match.homeTeamName, away: match.awayTeamName });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('share.copied'));
    } catch {
      // Clipboard can be blocked; the link is visible and selectable in the field.
      toast(t('share.copyFailed'));
    }
  };

  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ title, url });
    } catch {
      // Cancelled by the user, or not allowed: nothing to do.
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const { data } = await api<{ match: { liveToken: string } }>('PATCH', `/matches/${encodeURIComponent(match.id)}`, { rotateLiveToken: true });
      await setLiveToken(match.id, data.match.liveToken);
      toast(t('share.rotated'));
    } catch {
      toast(t('share.rotateFailed'));
    } finally {
      setBusy(false);
      setConfirmRotate(false);
    }
  };

  if (confirmRotate) {
    return (
      <ConfirmDialog
        danger
        confirmLabel={t('share.rotate')}
        message={t('share.rotateConfirm')}
        onCancel={() => setConfirmRotate(false)}
        onConfirm={() => void rotate()}
      />
    );
  }

  return (
    <Dialog title={t('share.title')} onClose={props.onClose}>
      {url ? (
        <>
          <p class="dialog-text">{t('share.hint')}</p>
          <label class="field">
            <span class="field-label">{t('share.link')}</span>
            <input class="input" readOnly value={url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          </label>
          <div class="share-actions">
            {typeof navigator.share === 'function' ? (
              <button type="button" class="btn btn-primary" onClick={() => void share()}>
                {t('share.share')}
              </button>
            ) : null}
            <button type="button" class="btn" onClick={() => void copy()}>
              {t('share.copy')}
            </button>
            <a class="btn" href={url} target="_blank" rel="noopener noreferrer">
              {t('share.open')}
            </a>
            <button type="button" class="btn btn-danger-quiet" disabled={busy} onClick={() => setConfirmRotate(true)}>
              {t('share.rotate')}
            </button>
          </div>
        </>
      ) : (
        <p class="dialog-text">{t('share.notReady')}</p>
      )}
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={props.onClose} autofocus>
          {t('share.close')}
        </button>
      </div>
    </Dialog>
  );
}
