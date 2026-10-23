// Translations. Spanish is the main language; English is optional.
// Texts are always rendered as text nodes (never as HTML).

import { useEffect, useState } from 'preact/hooks';
import en from './en.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };

export type Lang = 'es' | 'en';
export type MessageKey = keyof typeof es;

const MESSAGES: Record<Lang, Record<string, string>> = { es, en };
const STORAGE_KEY = 'arbitrajeremoto.lang';

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    // Storage may be unavailable (private mode): Spanish by default.
  }
  return 'es';
}

let lang: Lang = typeof localStorage === 'undefined' ? 'es' : loadLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not persisted; still applied for this session.
  }
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = MESSAGES[lang][key] ?? MESSAGES.es[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Re-renders the component when the language changes. */
export function useLang(): Lang {
  const [current, setCurrent] = useState(lang);
  useEffect(() => {
    const listener = () => setCurrent(lang);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return current;
}

export function locale(): string {
  return lang === 'es' ? 'es-ES' : 'en-GB';
}
