// Live scoreboard: the screen used on the pitch. Every button writes an event locally first.

import { useState } from 'preact/hooks';
import { elapsedAt, formatClock, minuteLabel } from '../../../core/clock.ts';
import type { DerivedEvent, TeamSide } from '../../../core/types.ts';
import { capitalize, describeEvent, isSecondYellow, periodName } from '../format.ts';
import { href, useLocalData, useNow } from '../hooks.ts';
import { t } from '../i18n/index.ts';
import { addEvent, getMatchView, listTeams, resetMatch, type NewEvent } from '../repo.ts';
import { clockActionEvent, clockActions, newestFirst, sentOff, type ClockAction } from '../scoreboard.ts';
import { AddedTimeDialog, ConfirmDialog, NoteDialog, PlayerDialog, SubstitutionDialog } from './Dialog.tsx';
import { toast } from './Layout.tsx';
import { ShareLiveDialog } from './ShareLive.tsx';

type PlayerAction = 'goal' | 'own_goal' | 'yellow_card' | 'red_card';

type Open =
  | { kind: 'player'; action: PlayerAction; team: TeamSide }
  | { kind: 'sub'; team: TeamSide }
  | { kind: 'added' }
  | { kind: 'note' }
  | { kind: 'finish' }
  | { kind: 'undo'; event: DerivedEvent }
  | { kind: 'reset' }
  | { kind: 'share' }
  | null;

const DIALOG_TITLE: Record<PlayerAction, 'dialog.goalTitle' | 'dialog.ownGoalTitle' | 'dialog.yellowTitle' | 'dialog.redTitle'> = {
  goal: 'dialog.goalTitle',
  own_goal: 'dialog.ownGoalTitle',
  yellow_card: 'dialog.yellowTitle',
  red_card: 'dialog.redTitle',
};

export function Scoreboard(props: { id: string }) {
  const data = useLocalData(async () => {
    const view = await getMatchView(props.id);
    return { view, teams: view ? await listTeams() : [] };
  }, [props.id]);
  const [open, setOpen] = useState<Open>(null);
  const running = Boolean(data?.view?.state.clock.running);
  const now = useNow(running);

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
  const names: Record<TeamSide, string> = { home: match.homeTeamName, away: match.awayTeamName };
  const roster = (side: TeamSide) => teams.find((x) => x.id === (side === 'home' ? match.homeTeamId : match.awayTeamId))?.players ?? [];
  const syncById = new Map(view.events.map((e) => [e.id, e]));
  const actions = clockActions(state, match.periods);
  const period = state.clock.period;
  const elapsed = elapsedAt(state.clock, now);

  const record = async (input: NewEvent) => {
    const created = await addEvent(match.id, input);
    setOpen(null);
    toast(t('board.recorded', { event: describeEvent({ ...created, atPeriod: null, minuteLabel: null }, match) }));
  };

  const clockLabel = (action: ClockAction): string => {
    switch (action.kind) {
      case 'start':
        return t('board.start', { period: periodName(action.period, match.periods) });
      case 'pause':
        return t('board.pause');
      case 'resume':
        return t('board.resume');
      case 'end':
        return t('board.end', { period: periodName(action.period, match.periods) });
      case 'finish':
        return t('board.finish');
    }
  };
  const runClock = (action: ClockAction) => (action.kind === 'finish' ? setOpen({ kind: 'finish' }) : void record(clockActionEvent(action)));

  let statusText: string;
  if (state.status === 'scheduled') statusText = t('board.notStarted');
  else if (state.status === 'live') statusText = `${capitalize(periodName(period!, match.periods))}. ${running ? t('status.live') : t('status.paused')}`;
  else statusText = t(`status.${state.status}`);

  return (
    <section class="board" aria-labelledby="board-title">
      <div class="board-top">
        <a class="back-link" href={href.matches()}>
          {t('nav.backToMatches')}
        </a>
        <a class="link-quiet" href={href.editMatch(match.id)}>
          {t('board.edit')}
        </a>
      </div>

      <h1 id="board-title" class="visually-hidden">
        {match.homeTeamName} {t('board.vs')} {match.awayTeamName}
      </h1>

      <div class="scoreline" role="group" aria-label={t('board.score')}>
        <div class="side side-home">
          <span class="side-name">{match.homeTeamName}</span>
          <span class="side-score" aria-live="polite">
            {state.score.home}
          </span>
        </div>
        <span class="score-sep" aria-hidden="true">
          –
        </span>
        <div class="side side-away">
          <span class="side-name">{match.awayTeamName}</span>
          <span class="side-score" aria-live="polite">
            {state.score.away}
          </span>
        </div>
      </div>

      <div class={`clock clock-${state.status}${running ? ' is-running' : ''}`}>
        <span class="clock-time" role="timer" aria-live="off">
          {formatClock(elapsed)}
        </span>
        <span class="clock-status">{statusText}</span>
        {period !== null && state.status !== 'finished' ? (
          <span class="clock-minute">{t('board.minute', { minute: minuteLabel(period, elapsed, match.periodMinutes) })}</span>
        ) : null}
        {state.clock.addedMinutes !== null && state.status === 'live' ? <span class="clock-added">{t('board.added', { minutes: state.clock.addedMinutes })}</span> : null}
      </div>

      {actions.primary ? (
        <button type="button" class={`btn btn-large clock-primary ${actions.primary.kind === 'pause' ? 'btn-pause' : 'btn-primary'}`} onClick={() => runClock(actions.primary!)}>
          {clockLabel(actions.primary)}
        </button>
      ) : null}

      <div class="team-panels">
        {(['home', 'away'] as const).map((side) => (
          <section key={side} class={`team-panel panel-${side}`} aria-label={t('board.actionsFor', { team: names[side] })}>
            <h2 class="panel-title">{names[side]}</h2>
            <button type="button" class="btn btn-goal" onClick={() => setOpen({ kind: 'player', action: 'goal', team: side })}>
              {t('board.goal')}
            </button>
            <div class="card-buttons">
              <button type="button" class="ref-card ref-card-yellow" onClick={() => setOpen({ kind: 'player', action: 'yellow_card', team: side })}>
                {t('board.yellow')}
              </button>
              <button type="button" class="ref-card ref-card-red" onClick={() => setOpen({ kind: 'player', action: 'red_card', team: side })}>
                {t('board.red')}
              </button>
            </div>
            <button type="button" class="btn" onClick={() => setOpen({ kind: 'sub', team: side })}>
              {t('board.sub')}
            </button>
            <button type="button" class="btn btn-quiet" onClick={() => setOpen({ kind: 'player', action: 'own_goal', team: side })}>
              {t('board.ownGoal')}
            </button>
          </section>
        ))}
      </div>

      {actions.secondary.length > 0 || state.status === 'live' ? (
        <div class="clock-secondary">
          {state.status === 'live' ? (
            <button type="button" class="btn" onClick={() => setOpen({ kind: 'added' })}>
              {t('board.addedTime')}
            </button>
          ) : null}
          {actions.secondary.map((action) => (
            <button type="button" key={action.kind} class="btn" onClick={() => runClock(action)}>
              {clockLabel(action)}
            </button>
          ))}
        </div>
      ) : null}

      <div class="board-tools">
        <button type="button" class="btn" onClick={() => setOpen({ kind: 'note' })}>
          {t('board.note')}
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            const last = state.timeline.at(-1);
            if (last) setOpen({ kind: 'undo', event: last });
            else toast(t('board.nothingToUndo'));
          }}
        >
          {t('board.undo')}
        </button>
        <button type="button" class="btn btn-danger-quiet" onClick={() => setOpen({ kind: 'reset' })} disabled={state.timeline.length === 0}>
          {t('board.reset')}
        </button>
      </div>

      <div class="board-share">
        <button type="button" class="btn" onClick={() => setOpen({ kind: 'share' })}>
          {t('share.button')}
        </button>
        <a class="btn" href={href.report(match.id)}>
          {t('report.button')}
        </a>
      </div>

      <section class="timeline" aria-labelledby="timeline-title">
        <h2 id="timeline-title" class="group-title">
          {t('board.timeline')}
        </h2>
        {state.timeline.length === 0 ? <p class="muted">{t('board.timelineEmpty')}</p> : null}
        <ol class="timeline-list" reversed>
          {newestFirst(state.timeline).map((e) => {
            const local = syncById.get(e.id);
            return (
              <li key={e.id} class={`timeline-item type-${e.type}${e.team ? ` team-${e.team}` : ''}`}>
                <span class="timeline-minute">{e.minuteLabel ? `${e.minuteLabel}'` : ''}</span>
                <span class="timeline-text">
                  {describeEvent(e, match)}
                  {isSecondYellow(e, state.timeline) ? ` ${t('event.secondYellow')}` : ''}
                  {local?.syncStatus === 'pending' ? <span class="timeline-flag">{t('board.pendingEvent')}</span> : null}
                  {local?.syncStatus === 'rejected' ? <span class="timeline-flag text-bad">{t('board.rejectedEvent')}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {open?.kind === 'player' ? (
        <PlayerDialog
          title={t(DIALOG_TITLE[open.action], { team: names[open.team] })}
          roster={roster(open.team)}
          muted={open.action === 'yellow_card' || open.action === 'red_card' ? sentOff(state, open.team) : undefined}
          onCancel={() => setOpen(null)}
          onSubmit={(number) => void record({ type: open.action, team: open.team, playerNumber: number })}
        />
      ) : null}
      {open?.kind === 'sub' ? (
        <SubstitutionDialog
          title={t('dialog.subTitle', { team: names[open.team] })}
          roster={roster(open.team)}
          onCancel={() => setOpen(null)}
          onSubmit={(out, inn) => void record({ type: 'substitution', team: open.team, playerOutNumber: out, playerInNumber: inn })}
        />
      ) : null}
      {open?.kind === 'added' ? (
        <AddedTimeDialog onCancel={() => setOpen(null)} onSubmit={(minutes) => void record({ type: 'added_time', minutes, period })} />
      ) : null}
      {open?.kind === 'note' ? (
        <NoteDialog
          homeName={names.home}
          awayName={names.away}
          onCancel={() => setOpen(null)}
          onSubmit={(text, team) => void record({ type: 'note', text, team })}
        />
      ) : null}
      {open?.kind === 'finish' ? (
        <ConfirmDialog
          confirmLabel={t('board.finish')}
          message={t('board.finishConfirm')}
          onCancel={() => setOpen(null)}
          onConfirm={() => void record({ type: 'match_end' })}
        />
      ) : null}
      {open?.kind === 'undo' ? (
        <ConfirmDialog
          confirmLabel={t('board.undo')}
          message={t('board.undoConfirm', { event: describeEvent(open.event, match) })}
          onCancel={() => setOpen(null)}
          onConfirm={async () => {
            // Void exactly the event the user confirmed (a synced watch event may have arrived meanwhile).
            await addEvent(match.id, { type: 'void', voidsEventId: open.event.id });
            setOpen(null);
            toast(t('board.undone', { event: describeEvent(open.event, match) }));
          }}
        />
      ) : null}
      {open?.kind === 'share' ? <ShareLiveDialog match={match} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'reset' ? (
        <ConfirmDialog
          danger
          confirmLabel={t('board.reset')}
          message={t('board.resetConfirm')}
          onCancel={() => setOpen(null)}
          onConfirm={async () => {
            await resetMatch(match.id);
            setOpen(null);
          }}
        />
      ) : null}
    </section>
  );
}
