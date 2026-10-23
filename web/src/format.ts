// Human-readable texts for periods, events and dates.

import type { DerivedEvent, Match } from '../../core/types.ts';
import { locale, t } from './i18n/index.ts';

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function periodName(period: number, periods: number): string {
  if (periods !== 2) return t('period.generic', { n: period });
  return period === 1 ? t('period.half1') : t('period.half', { n: period });
}

const teamName = (match: Pick<Match, 'homeTeamName' | 'awayTeamName'>, side: 'home' | 'away' | null) =>
  side === 'home' ? match.homeTeamName : side === 'away' ? match.awayTeamName : '';

export function describeEvent(e: DerivedEvent, match: Pick<Match, 'homeTeamName' | 'awayTeamName' | 'periods'>): string {
  const team = teamName(match, e.team);
  const number = e.playerNumber === null ? '' : ` (${t('event.number', { number: e.playerNumber })})`;
  switch (e.type) {
    case 'goal':
    case 'own_goal':
    case 'yellow_card':
    case 'red_card':
      return t(`event.${e.type}`, { team }) + number;
    case 'substitution':
      return t('event.substitution', { team, out: e.playerOutNumber ?? '', in: e.playerInNumber ?? '' });
    case 'note':
      return t('event.note', { text: e.text ?? '' });
    case 'period_start':
    case 'period_end':
      return t(`event.${e.type}`, { period: periodName(e.period ?? 1, match.periods) });
    case 'added_time':
      return t('event.added_time', { minutes: e.minutes ?? 0 });
    case 'period_pause':
    case 'period_resume':
    case 'match_end':
      return t(`event.${e.type}`);
    case 'void':
      return '';
  }
}

/** True when this yellow card is the player's second one. */
export function isSecondYellow(e: DerivedEvent, timeline: readonly DerivedEvent[]): boolean {
  if (e.type !== 'yellow_card' || e.playerNumber === null) return false;
  const previous = timeline.filter((x) => x.type === 'yellow_card' && x.team === e.team && x.playerNumber === e.playerNumber && x.t < e.t);
  return previous.length === 1;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return t('matches.noDate');
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
}

export function formatHourMinute(ms: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
