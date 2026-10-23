// Public spectator page (#/vivo/{id}/{token}): score, clock and events, refreshed every 10 s.
// Needs no session and stores nothing on the device.

import { useEffect, useRef, useState } from 'preact/hooks';
import { elapsedAt, formatClock, minuteLabel } from '../../../core/clock.ts';
import { ApiFailure, getIfChanged } from '../api.ts';
import { capitalize, describeEvent, formatDateTime, formatTime, periodName } from '../format.ts';
import { useNow } from '../hooks.ts';
import { t } from '../i18n/index.ts';
import { LIVE_POLL_MS, secondYellowIds, serverOffsetMs, toDerived, type LiveData } from '../live.ts';

type Problem = 'notFound' | 'offline' | null;

export function LiveView(props: { id: string; token: string }) {
  const [data, setData] = useState<LiveData | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const etag = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    etag.current = null;
    setData(null);
    setProblem(null);

    const poll = async () => {
      if (inFlight) return;
      if (timer) clearTimeout(timer);
      timer = null;
      inFlight = true;
      const sentAt = Date.now();
      try {
        const path = `/matches/${encodeURIComponent(props.id)}/live?token=${encodeURIComponent(props.token)}`;
        const res = await getIfChanged<LiveData>(path, etag.current);
        inFlight = false;
        if (!alive) return;
        if (res.data) {
          etag.current = res.etag;
          setOffset(serverOffsetMs(res.data.serverTime, sentAt, Date.now()));
          setData(res.data);
        }
        setProblem(null);
        setCheckedAt(Date.now());
      } catch (error) {
        inFlight = false;
        if (!alive) return;
        if (error instanceof ApiFailure && error.status === 404) {
          setProblem('notFound');
          return; // A wrong or replaced link does not come back: stop asking.
        }
        setProblem('offline');
      }
      // Hidden tabs do not poll (saves battery and the free-plan quota); they refresh when shown again.
      if (alive && document.visibilityState === 'visible') timer = setTimeout(() => void poll(), LIVE_POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !timer) void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [props.id, props.token]);

  const running = Boolean(data?.state.clock.running);
  const now = useNow(running) + offset;

  if (problem === 'notFound') {
    return (
      <section class="page">
        <h1 class="page-title">{t('live.title')}</h1>
        <p class="empty">{t('live.notFound')}</p>
      </section>
    );
  }
  if (!data) {
    return <p class="muted">{problem === 'offline' ? t('live.offline') : t('common.loading')}</p>;
  }

  const { match, state, timeline } = data;
  const period = state.clock.period;
  const elapsed = elapsedAt(state.clock, now);
  const secondYellows = secondYellowIds(timeline);

  let statusText: string;
  if (state.status === 'scheduled') statusText = t('board.notStarted');
  else if (state.status === 'live') statusText = `${capitalize(periodName(period!, match.periods))}. ${running ? t('status.live') : t('status.paused')}`;
  else statusText = t(`status.${state.status}`);

  return (
    <section class="board live" aria-labelledby="live-title">
      <div class="live-head">
        <h1 id="live-title" class="live-title">
          {t('live.title')}
        </h1>
        {match.tournament ? <p class="live-meta">{match.tournament}</p> : null}
        {match.scheduledAt ? <p class="live-meta">{formatDateTime(match.scheduledAt)}</p> : null}
      </div>

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

      <p class={problem === 'offline' ? 'live-status tone-warn' : 'live-status muted small'} role="status">
        {problem === 'offline' ? t('live.offline') : t('live.updatedAt', { time: checkedAt ? formatTime(checkedAt) : '' })}
      </p>

      <section class="timeline" aria-labelledby="live-timeline-title">
        <h2 id="live-timeline-title" class="group-title">
          {t('board.timeline')}
        </h2>
        {timeline.length === 0 ? <p class="muted">{t('live.timelineEmpty')}</p> : null}
        <ol class="timeline-list" reversed>
          {[...timeline].reverse().map((e) => (
            <li key={e.id} class={`timeline-item type-${e.type}${e.team ? ` team-${e.team}` : ''}`}>
              <span class="timeline-minute">{e.minuteLabel ? `${e.minuteLabel}'` : ''}</span>
              <span class="timeline-text">
                {describeEvent(toDerived(e), match)}
                {secondYellows.has(e.id) ? ` ${t('event.secondYellow')}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <p class="muted small">{t('live.autoRefresh')}</p>
    </section>
  );
}
