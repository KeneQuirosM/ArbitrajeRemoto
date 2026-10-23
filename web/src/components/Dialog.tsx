// Modal dialogs built on the native <dialog> element (focus trap and Escape for free).

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Player } from '../../../core/types.ts';
import { t } from '../i18n/index.ts';

let dialogCounter = 0;

export function Dialog(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [titleId] = useState(() => `dialog-title-${++dialogCounter}`);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <h2 id={titleId} class="dialog-title">
        {props.title}
      </h2>
      {props.children}
    </dialog>
  );
}

export function ConfirmDialog(props: {
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={props.confirmLabel} onClose={props.onCancel}>
      <p class="dialog-text">{props.message}</p>
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={props.onCancel}>
          {t('dialog.cancel')}
        </button>
        <button type="button" class={props.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={props.onConfirm} autofocus>
          {props.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

function parseNumber(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,2}$/.test(trimmed)) return 'invalid';
  const n = Number(trimmed);
  return n >= 1 && n <= 99 ? n : 'invalid';
}

function RosterChips(props: { roster: Player[]; selected: number | null; onPick: (n: number) => void; muted?: Set<number> }) {
  if (props.roster.length === 0) return null;
  return (
    <fieldset class="chips">
      <legend>{t('dialog.roster')}</legend>
      {props.roster.map((p) => (
        <button
          type="button"
          key={p.id}
          class={`chip${props.selected === p.number ? ' is-selected' : ''}${props.muted?.has(p.number) ? ' is-muted' : ''}`}
          aria-pressed={props.selected === p.number}
          onClick={() => props.onPick(p.number)}
          title={p.name ?? undefined}
        >
          <span class="chip-number">{p.number}</span>
          {p.name ? <span class="chip-name">{p.name}</span> : null}
        </button>
      ))}
    </fieldset>
  );
}

/** Asks for an optional player number (1–99). */
export function PlayerDialog(props: {
  title: string;
  roster: Player[];
  muted?: Set<number>;
  onSubmit: (number: number | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (raw: string) => {
    const n = parseNumber(raw);
    if (n === 'invalid') return setError(t('dialog.invalidNumber'));
    props.onSubmit(n);
  };
  const selected = parseNumber(value);
  return (
    <Dialog title={props.title} onClose={props.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
      >
        <RosterChips roster={props.roster} muted={props.muted} selected={typeof selected === 'number' ? selected : null} onPick={(n) => submit(String(n))} />
        <label class="field">
          <span class="field-label">{t('dialog.playerNumber')}</span>
          <input
            class="input input-number"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            autoComplete="off"
            value={value}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby="player-hint"
            onInput={(e) => {
              setValue((e.target as HTMLInputElement).value);
              setError(null);
            }}
            autofocus={props.roster.length === 0}
          />
          <span id="player-hint" class={error ? 'field-error' : 'field-hint'}>
            {error ?? t('dialog.playerNumberHint')}
          </span>
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={props.onCancel}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" class="btn btn-primary">
            {value.trim() === '' ? t('dialog.noNumber') : t('dialog.record')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SubstitutionDialog(props: {
  title: string;
  roster: Player[];
  onSubmit: (out: number, inn: number) => void;
  onCancel: () => void;
}) {
  const [out, setOut] = useState('');
  const [inn, setInn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pickTarget = out.trim() === '' ? setOut : setInn;
  return (
    <Dialog title={props.title} onClose={props.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const a = parseNumber(out);
          const b = parseNumber(inn);
          if (typeof a !== 'number' || typeof b !== 'number') return setError(t('dialog.invalidNumber'));
          if (a === b) return setError(t('dialog.samePlayers'));
          props.onSubmit(a, b);
        }}
      >
        <RosterChips roster={props.roster} selected={null} onPick={(n) => pickTarget(String(n))} />
        <div class="field-row">
          <label class="field">
            <span class="field-label">{t('dialog.playerOut')}</span>
            <input class="input input-number" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={out} required onInput={(e) => setOut((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span class="field-label">{t('dialog.playerIn')}</span>
            <input class="input input-number" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={inn} required onInput={(e) => setInn((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        {error ? <p class="field-error" role="alert">{error}</p> : null}
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={props.onCancel}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" class="btn btn-primary">
            {t('dialog.record')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function AddedTimeDialog(props: { onSubmit: (minutes: number) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  return (
    <Dialog title={t('dialog.addedTitle')} onClose={props.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(value);
          if (value.trim() === '' || !Number.isInteger(n) || n < 0 || n > 30) return setError(true);
          props.onSubmit(n);
        }}
      >
        <div class="quick-picks">
          {[1, 2, 3, 4, 5].map((n) => (
            <button type="button" key={n} class="chip" onClick={() => props.onSubmit(n)}>
              <span class="chip-number">+{n}</span>
            </button>
          ))}
        </div>
        <label class="field">
          <span class="field-label">{t('dialog.addedMinutes')}</span>
          <input class="input input-number" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={value} aria-invalid={error ? 'true' : undefined} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={props.onCancel}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" class="btn btn-primary">
            {t('dialog.record')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function NoteDialog(props: {
  homeName: string;
  awayName: string;
  onSubmit: (text: string, team: 'home' | 'away' | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [team, setTeam] = useState<'home' | 'away' | ''>('');
  return (
    <Dialog title={t('dialog.noteTitle')} onClose={props.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) props.onSubmit(text.trim(), team || null);
        }}
      >
        <label class="field">
          <span class="field-label">{t('dialog.noteText')}</span>
          <textarea class="input" rows={4} maxLength={500} required value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} autofocus />
        </label>
        <label class="field">
          <span class="field-label">{t('dialog.noteTeam')}</span>
          <select class="input" value={team} onChange={(e) => setTeam((e.target as HTMLSelectElement).value as 'home' | 'away' | '')}>
            <option value="">{t('dialog.noteNoTeam')}</option>
            <option value="home">{props.homeName}</option>
            <option value="away">{props.awayName}</option>
          </select>
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={props.onCancel}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" class="btn btn-primary">
            {t('dialog.record')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
