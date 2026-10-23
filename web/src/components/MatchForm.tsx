import { useState } from 'preact/hooks';
import type { Team } from '../../../core/types.ts';
import { LIMITS, validateText } from '../../../core/validate.ts';
import { fromLocalInput, toLocalInput } from '../format.ts';
import { href, navigate, useLocalData } from '../hooks.ts';
import { t } from '../i18n/index.ts';
import { createMatch, deleteMatch, getMatchView, listTeams, updateMatch, type MatchInput } from '../repo.ts';
import { ConfirmDialog } from './Dialog.tsx';
import { toast } from './Layout.tsx';

interface SideState {
  teamId: string;
  name: string;
}

function TeamPicker(props: { label: string; teams: Team[]; value: SideState; onChange: (v: SideState) => void; error?: string | null; idPrefix: string }) {
  const selectId = `${props.idPrefix}-team`;
  const nameId = `${props.idPrefix}-name`;
  const team = props.teams.find((x) => x.id === props.value.teamId);
  return (
    <fieldset class="fieldset">
      <legend>{props.label}</legend>
      {props.teams.length > 0 ? (
        <div class="field">
          <label class="field-label" for={selectId}>
            {t('form.teamFromRoster')}
          </label>
          <select
            id={selectId}
            class="input"
            value={props.value.teamId}
            onChange={(e) => {
              const teamId = (e.target as HTMLSelectElement).value;
              const picked = props.teams.find((x) => x.id === teamId);
              props.onChange({ teamId, name: picked ? picked.name : props.value.name });
            }}
          >
            <option value="">{t('form.noRoster')}</option>
            {props.teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div class="field">
        <label class="field-label" for={nameId}>
          {t('form.teamName')}
        </label>
        <input
          id={nameId}
          class="input"
          maxLength={LIMITS.teamName}
          required
          value={team ? team.name : props.value.name}
          disabled={Boolean(team)}
          aria-invalid={props.error ? 'true' : undefined}
          onInput={(e) => props.onChange({ ...props.value, name: (e.target as HTMLInputElement).value })}
        />
        {props.error ? <span class="field-error">{props.error}</span> : null}
      </div>
    </fieldset>
  );
}

export function MatchForm(props: { id?: string }) {
  const data = useLocalData(async () => ({ teams: await listTeams(), view: props.id ? await getMatchView(props.id) : null }), [props.id]);
  if (!data) return <p class="muted">{t('common.loading')}</p>;
  if (props.id && !data.view) return <p class="empty">{t('board.notFound')}</p>;
  return <MatchFormInner key={props.id ?? 'new'} teams={data.teams} initial={data.view?.match ?? null} />;
}

function MatchFormInner(props: { teams: Team[]; initial: (MatchInput & { id: string }) | null }) {
  const init = props.initial;
  const [home, setHome] = useState<SideState>({ teamId: init?.homeTeamId ?? '', name: init?.homeTeamName ?? 'Local' });
  const [away, setAway] = useState<SideState>({ teamId: init?.awayTeamId ?? '', name: init?.awayTeamName ?? 'Visitante' });
  const [date, setDate] = useState(toLocalInput(init?.scheduledAt ?? null));
  const [periods, setPeriods] = useState(String(init?.periods ?? 2));
  const [minutes, setMinutes] = useState(String(init?.periodMinutes ?? 45));
  const [tournament, setTournament] = useState(init?.tournament ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resolveName = (side: SideState) => props.teams.find((x) => x.id === side.teamId)?.name ?? side.name;

  const submit = async (e: Event) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const homeName = validateText(resolveName(home), 'name', LIMITS.teamName, { required: true });
    const awayName = validateText(resolveName(away), 'name', LIMITS.teamName, { required: true });
    if (!homeName.ok) next.home = t('teams.nameRequired');
    if (!awayName.ok) next.away = t('teams.nameRequired');
    if (home.teamId && home.teamId === away.teamId) next.away = t('form.sameTeam');
    const p = Number(periods);
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > LIMITS.maxPeriodMinutes) next.minutes = t('form.invalid');
    const tour = validateText(tournament, 'tournament', LIMITS.tournament);
    setErrors(next);
    if (Object.keys(next).length > 0 || !homeName.ok || !awayName.ok || !tour.ok) return;

    const input: MatchInput = {
      homeTeamId: home.teamId || null,
      awayTeamId: away.teamId || null,
      homeTeamName: homeName.value as string,
      awayTeamName: awayName.value as string,
      scheduledAt: fromLocalInput(date),
      periods: p,
      periodMinutes: m,
      tournament: tour.value,
    };
    if (props.initial) {
      await updateMatch(props.initial.id, input);
      navigate(href.match(props.initial.id));
    } else {
      const id = await createMatch(input);
      navigate(href.match(id));
    }
  };

  return (
    <section class="page">
      <a class="back-link" href={props.initial ? href.match(props.initial.id) : href.matches()}>
        {t('nav.backToMatches')}
      </a>
      <h1 class="page-title">{props.initial ? t('form.editTitle') : t('form.newTitle')}</h1>
      <form class="form" onSubmit={submit} noValidate>
        <TeamPicker idPrefix="home" label={t('form.home')} teams={props.teams} value={home} onChange={setHome} error={errors.home} />
        <TeamPicker idPrefix="away" label={t('form.away')} teams={props.teams} value={away} onChange={setAway} error={errors.away} />
        <label class="field">
          <span class="field-label">{t('form.date')}</span>
          <input class="input" type="datetime-local" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <div class="field-row">
          <label class="field">
            <span class="field-label">{t('form.periods')}</span>
            <select class="input" value={periods} onChange={(e) => setPeriods((e.target as HTMLSelectElement).value)}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span class="field-label">{t('form.periodMinutes')}</span>
            <input
              class="input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              value={minutes}
              aria-invalid={errors.minutes ? 'true' : undefined}
              onInput={(e) => setMinutes((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        <label class="field">
          <span class="field-label">{t('form.tournament')}</span>
          <input class="input" maxLength={LIMITS.tournament} value={tournament} onInput={(e) => setTournament((e.target as HTMLInputElement).value)} />
        </label>
        {Object.keys(errors).length > 0 ? (
          <p class="field-error" role="alert">
            {t('form.invalid')}
          </p>
        ) : null}
        <button type="submit" class="btn btn-primary btn-large">
          {props.initial ? t('form.save') : t('form.create')}
        </button>
        {props.initial ? (
          <button type="button" class="btn btn-danger-quiet" onClick={() => setConfirmDelete(true)}>
            {t('form.delete')}
          </button>
        ) : null}
      </form>
      {confirmDelete && props.initial ? (
        <ConfirmDialog
          danger
          confirmLabel={t('form.delete')}
          message={t('form.deleteConfirm', { home: props.initial.homeTeamName, away: props.initial.awayTeamName })}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteMatch(props.initial!.id);
            toast(t('form.deleted'));
            navigate(href.matches());
          }}
        />
      ) : null}
    </section>
  );
}
