import type { MatchStatus } from '../../../core/types.ts';
import { formatDateTime } from '../format.ts';
import { href, navigate, useLocalData } from '../hooks.ts';
import { t } from '../i18n/index.ts';
import { createMatch, listMatches, type MatchView } from '../repo.ts';

const GROUPS: { key: 'live' | 'upcoming' | 'finished'; statuses: MatchStatus[]; title: () => string }[] = [
  { key: 'live', statuses: ['live', 'halftime'], title: () => t('matches.live') },
  { key: 'upcoming', statuses: ['scheduled'], title: () => t('matches.upcoming') },
  { key: 'finished', statuses: ['finished'], title: () => t('matches.finished') },
];

const when = (v: MatchView) => Date.parse(v.match.scheduledAt ?? v.match.createdAt);

export async function startQuickMatch(): Promise<void> {
  const id = await createMatch({
    homeTeamId: null,
    awayTeamId: null,
    homeTeamName: defaultName('home'),
    awayTeamName: defaultName('away'),
    scheduledAt: new Date().toISOString(),
    periods: 2,
    periodMinutes: 45,
    tournament: null,
  });
  navigate(href.match(id));
}

/** Default team names are stored in Spanish, like the API defaults, whatever the UI language. */
function defaultName(side: 'home' | 'away'): string {
  return side === 'home' ? 'Local' : 'Visitante';
}

function statusLabel(v: MatchView): string {
  if (v.state.status === 'live' && !v.state.clock.running) return t('status.paused');
  return t(`status.${v.state.status}`);
}

export function MatchList() {
  const views = useLocalData(listMatches, []);
  if (!views) return <p class="muted">{t('common.loading')}</p>;

  return (
    <section class="page">
      <h1 class="page-title">{t('matches.title')}</h1>
      <div class="start-actions">
        <button type="button" class="btn btn-primary btn-large" onClick={() => void startQuickMatch()}>
          {t('matches.quick')}
        </button>
        <p class="hint">{t('matches.quickHint')}</p>
        <a class="btn" href={href.newMatch()}>
          {t('matches.new')}
        </a>
      </div>

      {views.length === 0 ? <p class="empty">{t('matches.empty')}</p> : null}

      {GROUPS.map((group) => {
        const items = views
          .filter((v) => group.statuses.includes(v.state.status))
          .sort((a, b) => (group.key === 'finished' ? when(b) - when(a) : when(a) - when(b)));
        if (items.length === 0) return null;
        return (
          <section key={group.key} class="match-group" aria-labelledby={`group-${group.key}`}>
            <h2 id={`group-${group.key}`} class="group-title">
              {group.title()}
            </h2>
            <ul class="match-list">
              {items.map((v) => (
                <li key={v.match.id}>
                  <a class={`match-row status-${v.state.status}`} href={href.match(v.match.id)}>
                    <span class="match-teams">
                      <span class="team-line">
                        <span class="team-name">{v.match.homeTeamName}</span>
                        <span class="team-score">{v.state.score.home}</span>
                      </span>
                      <span class="team-line">
                        <span class="team-name">{v.match.awayTeamName}</span>
                        <span class="team-score">{v.state.score.away}</span>
                      </span>
                    </span>
                    <span class="match-meta">
                      <span class={`status-pill status-${v.state.status}`}>{statusLabel(v)}</span>
                      <span>{formatDateTime(v.match.scheduledAt)}</span>
                      {v.match.tournament ? <span>{v.match.tournament}</span> : null}
                      {v.match.syncError ? <span class="text-bad">{t('matches.syncError')}</span> : null}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
