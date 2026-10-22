// App frame: header with sync status, page content, bottom navigation, toasts.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { href, useSyncStatus, type Route } from '../hooks.ts';
import { t } from '../i18n/index.ts';

// --- Toasts (announced to screen readers) ----------------------------------

let pushToast: ((text: string) => void) | null = null;

export function toast(text: string): void {
  pushToast?.(text);
}

function Toasts() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    pushToast = (next) => {
      setText(next);
      clearTimeout(timer);
      timer = setTimeout(() => setText(null), 3500);
    };
    return () => {
      pushToast = null;
      clearTimeout(timer);
    };
  }, []);
  return (
    <div class="toast-region" role="status" aria-live="polite">
      {text ? <div class="toast">{text}</div> : null}
    </div>
  );
}

// --- Sync badge -------------------------------------------------------------

export function SyncBadge() {
  const status = useSyncStatus();
  const pending = status.pending === 0 ? null : status.pending === 1 ? t('sync.pendingOne') : t('sync.pending', { count: status.pending });
  let label: string;
  let tone: string;
  switch (status.phase) {
    case 'offline':
      label = t('sync.offline');
      tone = 'warn';
      break;
    case 'syncing':
      label = t('sync.syncing');
      tone = 'busy';
      break;
    case 'needsLogin':
      label = t('sync.needsLogin');
      tone = 'warn';
      break;
    case 'error':
      label = t('sync.error');
      tone = 'bad';
      break;
    default:
      label = pending ? '' : t('sync.synced');
      tone = pending ? 'warn' : 'ok';
  }
  const text = [label, pending].filter(Boolean).join('. ');
  return (
    <a class={`sync-badge tone-${tone}`} href={href.settings()}>
      <span class="sync-dot" aria-hidden="true" />
      {text}
    </a>
  );
}

// --- Layout -------------------------------------------------------------------

const TABS: { route: Route['name'][]; href: string; label: () => string }[] = [
  { route: ['matches', 'newMatch', 'match', 'editMatch'], href: href.matches(), label: () => t('nav.matches') },
  { route: ['teams', 'newTeam', 'team'], href: href.teams(), label: () => t('nav.teams') },
  { route: ['settings'], href: href.settings(), label: () => t('nav.settings') },
];

export function Layout(props: { route: Route; children: ComponentChildren }) {
  return (
    <div class="shell">
      <header class="topbar">
        <a class="brand" href={href.matches()}>
          {t('app.name')}
        </a>
        <SyncBadge />
      </header>
      <main class="content" id="main">
        {props.children}
      </main>
      <nav class="tabbar" aria-label={t('nav.main')}>
        {TABS.map((tab) => {
          const active = tab.route.includes(props.route.name);
          return (
            <a key={tab.href} href={tab.href} class={`tab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
              {tab.label()}
            </a>
          );
        })}
      </nav>
      <Toasts />
    </div>
  );
}
