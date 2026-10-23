// Match report (#/partidos/{id}/informe): printable summary. "Print" opens the system dialog,
// where the PDF option lives (iPhone: Share → Print → Save to Files; PC: "Save as PDF").
// Built from local data only, so it also works without connection.

import { useState } from 'preact/hooks';
import type { TeamSide } from '../../../core/types.ts';
import { formatDateTime, formatHourMinute, periodName } from '../format.ts';
import { href, useLocalData } from '../hooks.ts';
import { t } from '../i18n/index.ts';
import { getMatchView, listTeams } from '../repo.ts';
import { buildReport, reportText, type Rosters } from '../report.ts';
import { toast } from './Layout.tsx';

export function Report(props: { id: string }) {
  const data = useLocalData(async () => {
    const view = await getMatchView(props.id);
    return { view, teams: view ? await listTeams() : [] };
  }, [props.id]);
  const [withNotes, setWithNotes] = useState(false);

  if (!data) return <p class="muted">{t('common.loading')}</p>;
  const { view, teams } = data;
  if (!view) {
    return (
      <section class="page">
        <a class="back-link" href={href.matches()}>
          {t('nav.backToMatches')}
        </a>
        <p class="empty">{t('board.notFound')}</p>
      </section>
    );
  }

  const { match, state } = view;
  const rosters: Rosters = {
    home: teams.find((x) => x.id === match.homeTeamId)?.players,
    away: teams.find((x) => x.id === match.awayTeamId)?.players,
  };
  const report = buildReport(match, state, rosters);
  const team = (side: TeamSide | null) => (side === 'home' ? match.homeTeamName : side === 'away' ? match.awayTeamName : '');
  const minute = (m: string | null) => (m ? `${m}'` : '–');
  const number = (n: number | null) => (n === null ? '–' : String(n));
  const date = match.scheduledAt ? formatDateTime(match.scheduledAt) : report.kickOffAt ? formatDateTime(new Date(report.kickOffAt).toISOString()) : null;
  const cardLabel = { yellow: t('report.yellow'), red: t('report.red'), secondYellow: t('report.secondYellow') };

  const shareText = async () => {
    const text = reportText(
      report,
      { title: t('report.title'), teams: { home: match.homeTeamName, away: match.awayTeamName }, tournament: match.tournament, date },
      {
        score: t('report.score'),
        unfinished: t('report.unfinished'),
        goals: t('report.goals'),
        cards: t('report.cards'),
        subs: t('report.subs'),
        notes: withNotes ? t('report.notes') : null,
        ownGoal: t('report.ownGoal'),
        yellow: cardLabel.yellow,
        red: cardLabel.red,
        secondYellow: cardLabel.secondYellow,
        noNumber: t('report.noNumber'),
      },
    );
    try {
      if (typeof navigator.share === 'function') await navigator.share({ title: t('report.title'), text });
      else {
        await navigator.clipboard.writeText(text);
        toast(t('report.copied'));
      }
    } catch {
      // Cancelled by the user or not allowed.
    }
  };

  return (
    <section class="page report-page">
      <div class="board-top no-print">
        <a class="back-link" href={href.match(match.id)}>
          {t('report.back')}
        </a>
      </div>

      <div class="report-tools no-print">
        <label class="check">
          <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes((e.target as HTMLInputElement).checked)} />
          <span>{t('report.includeNotes')}</span>
        </label>
        <div class="button-row">
          <button type="button" class="btn btn-primary" onClick={() => window.print()}>
            {t('report.print')}
          </button>
          <button type="button" class="btn" onClick={() => void shareText()}>
            {t('report.shareText')}
          </button>
        </div>
        <p class="hint">{t('report.printHint')}</p>
      </div>

      <article class="report" aria-labelledby="report-title">
        <header class="report-header">
          <h1 id="report-title" class="report-title">
            {t('report.title')}
          </h1>
          {match.tournament ? <p class="report-meta">{match.tournament}</p> : null}
          {date ? <p class="report-meta">{date}</p> : null}
          <p class="report-score">
            <span>{match.homeTeamName}</span>
            <strong>
              {report.score.home} – {report.score.away}
            </strong>
            <span>{match.awayTeamName}</span>
          </p>
          {!report.finished ? <p class="report-meta report-warn">{t('report.unfinished')}</p> : null}
        </header>

        {report.periods.length > 0 ? (
          <section>
            <h2 class="report-h2">{t('report.periods')}</h2>
            <table class="report-table">
              <thead>
                <tr>
                  <th scope="col">{t('report.period')}</th>
                  <th scope="col">{t('report.start')}</th>
                  <th scope="col">{t('report.end')}</th>
                  <th scope="col">{t('report.added')}</th>
                  <th scope="col">{t('report.score')}</th>
                </tr>
              </thead>
              <tbody>
                {report.periods.map((p) => (
                  <tr key={p.period}>
                    <td>{periodName(p.period, match.periods)}</td>
                    <td class="nowrap">{p.startedAt ? formatHourMinute(p.startedAt) : '–'}</td>
                    <td class="nowrap">{p.endedAt ? formatHourMinute(p.endedAt) : '–'}</td>
                    <td class="nowrap">{p.addedMinutes === null ? '–' : `+${p.addedMinutes}`}</td>
                    <td class="nowrap">
                      {p.score.home} – {p.score.away}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section>
          <h2 class="report-h2">{t('report.goals')}</h2>
          {report.goals.length === 0 ? (
            <p class="muted">{t('report.none')}</p>
          ) : (
            <table class="report-table">
              <thead>
                <tr>
                  <th scope="col">{t('report.minute')}</th>
                  <th scope="col">{t('report.team')}</th>
                  <th scope="col">{t('report.number')}</th>
                  <th scope="col">{t('report.player')}</th>
                </tr>
              </thead>
              <tbody>
                {report.goals.map((g) => (
                  <tr key={g.id}>
                    <td class="nowrap">{minute(g.minute)}</td>
                    <td>{team(g.scoringTeam)}</td>
                    <td>{number(g.playerNumber)}</td>
                    <td>
                      {g.playerName ?? ''}
                      {g.ownGoal ? ` (${t('report.ownGoal')}, ${team(g.playerTeam)})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 class="report-h2">{t('report.cards')}</h2>
          {report.cards.length === 0 ? (
            <p class="muted">{t('report.none')}</p>
          ) : (
            <table class="report-table">
              <thead>
                <tr>
                  <th scope="col">{t('report.minute')}</th>
                  <th scope="col">{t('report.card')}</th>
                  <th scope="col">{t('report.team')}</th>
                  <th scope="col">{t('report.number')}</th>
                  <th scope="col">{t('report.player')}</th>
                </tr>
              </thead>
              <tbody>
                {report.cards.map((c) => (
                  <tr key={c.id} class={`card-row card-${c.kind}`}>
                    <td class="nowrap">{minute(c.minute)}</td>
                    <td>{cardLabel[c.kind]}</td>
                    <td>{team(c.team)}</td>
                    <td>{number(c.playerNumber)}</td>
                    <td>{c.playerName ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 class="report-h2">{t('report.subs')}</h2>
          {report.subs.length === 0 ? (
            <p class="muted">{t('report.none')}</p>
          ) : (
            <table class="report-table">
              <thead>
                <tr>
                  <th scope="col">{t('report.minute')}</th>
                  <th scope="col">{t('report.team')}</th>
                  <th scope="col">{t('report.out')}</th>
                  <th scope="col">{t('report.in')}</th>
                </tr>
              </thead>
              <tbody>
                {report.subs.map((s) => (
                  <tr key={s.id}>
                    <td class="nowrap">{minute(s.minute)}</td>
                    <td>{team(s.team)}</td>
                    <td>
                      {number(s.outNumber)}
                      {s.outName ? ` ${s.outName}` : ''}
                    </td>
                    <td>
                      {number(s.inNumber)}
                      {s.inName ? ` ${s.inName}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {withNotes ? (
          <section>
            <h2 class="report-h2">{t('report.notes')}</h2>
            {report.notes.length === 0 ? (
              <p class="muted">{t('report.none')}</p>
            ) : (
              <ul class="report-notes">
                {report.notes.map((n) => (
                  <li key={n.id}>
                    <strong>
                      {minute(n.minute)}
                      {n.team ? ` · ${team(n.team)}` : ''}
                    </strong>{' '}
                    <span class="report-note-text">{n.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <footer class="report-footer">{t('report.footer', { date: formatDateTime(new Date().toISOString()) })}</footer>
      </article>
    </section>
  );
}
