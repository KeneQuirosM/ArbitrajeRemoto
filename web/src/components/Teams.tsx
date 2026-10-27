import { useState } from 'preact/hooks';
import type { Player, Team } from '../../../core/types.ts';
import { LIMITS, validatePlayers, validateText } from '../../../core/validate.ts';
import { href, navigate, useLocalData } from '../hooks.ts';
import { t } from '../i18n/index.ts';
import { deleteTeam, getTeam, listTeams, saveTeam, uuid } from '../repo.ts';
import { ConfirmDialog } from './Dialog.tsx';
import { toast } from './Layout.tsx';

export function TeamList() {
  const teams = useLocalData(listTeams, []);
  if (!teams) return <p class="muted">{t('common.loading')}</p>;
  return (
    <section class="page">
      <h1 class="page-title">{t('teams.title')}</h1>
      <a class="btn btn-primary btn-large" href={href.newTeam()}>
        {t('teams.new')}
      </a>
      {teams.length === 0 ? <p class="empty">{t('teams.empty')}</p> : null}
      <ul class="team-list">
        {teams.map((team) => (
          <li key={team.id}>
            <a class="team-row" href={href.team(team.id)}>
              <span class="team-name">{team.name}</span>
              <span class="muted">{team.players.length === 1 ? t('teams.playersOne') : t('teams.players', { count: team.players.length })}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TeamForm(props: { id?: string }) {
  const team = useLocalData(async () => (props.id ? ((await getTeam(props.id)) ?? null) : null), [props.id]);
  if (team === undefined) return <p class="muted">{t('common.loading')}</p>;
  if (props.id && !team) return <p class="empty">{t('board.notFound')}</p>;
  return <TeamFormInner key={props.id ?? 'new'} initial={team} />;
}

interface Row {
  id: string;
  number: string;
  name: string;
}

function TeamFormInner(props: { initial: Team | null }) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [rows, setRows] = useState<Row[]>(
    props.initial?.players.map((p) => ({ id: p.id, number: String(p.number), name: p.name ?? '' })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = (id: string, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const submit = async (e: Event) => {
    e.preventDefault();
    const teamName = validateText(name, 'name', LIMITS.teamName, { required: true });
    if (!teamName.ok) return setError(t('teams.nameRequired'));
    const filled = rows.filter((r) => r.number.trim() !== '' || r.name.trim() !== '');
    const players = validatePlayers(
      filled.map((r) => ({ id: r.id, number: /^\d+$/.test(r.number.trim()) ? Number(r.number) : NaN, name: r.name })),
      uuid,
    );
    if (!players.ok) {
      if (players.reason === 'duplicate_player_number') {
        const seen = new Set<string>();
        const dup = filled.find((r) => (seen.has(r.number.trim()) ? true : (seen.add(r.number.trim()), false)));
        return setError(t('teams.duplicateNumber', { number: dup?.number ?? '' }));
      }
      return setError(t('teams.invalidNumber'));
    }
    const id = props.initial?.id ?? uuid();
    await saveTeam({ id, name: teamName.value as string, players: players.value as Player[] });
    toast(t('teams.saved'));
    navigate(href.teams());
  };

  return (
    <section class="page">
      <a class="back-link" href={href.teams()}>
        {t('nav.backToTeams')}
      </a>
      <h1 class="page-title">{props.initial ? t('teams.editTitle') : t('teams.newTitle')}</h1>
      <form class="form" onSubmit={submit} noValidate>
        <label class="field">
          <span class="field-label">{t('teams.name')}</span>
          <input class="input" required maxLength={LIMITS.teamName} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <fieldset class="fieldset">
          <legend>{t('teams.roster')}</legend>
          <ul class="roster-rows">
            {rows.map((row) => (
              <li key={row.id} class="roster-row">
                <label class="field field-number">
                  <span class="field-label">{t('teams.number')}</span>
                  <input class="input input-number" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={row.number} onInput={(e) => update(row.id, { number: (e.target as HTMLInputElement).value })} />
                </label>
                <label class="field field-grow">
                  <span class="field-label">{t('teams.playerName')}</span>
                  <input class="input" maxLength={LIMITS.playerName} value={row.name} onInput={(e) => update(row.id, { name: (e.target as HTMLInputElement).value })} />
                </label>
                <button
                  type="button"
                  class="btn btn-icon"
                  aria-label={t('teams.removePlayer', { number: row.number || '?' })}
                  onClick={() => setRows((list) => list.filter((r) => r.id !== row.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button type="button" class="btn" onClick={() => setRows((list) => [...list, { id: uuid(), number: '', name: '' }])} disabled={rows.length >= LIMITS.playersPerTeam}>
            {t('teams.addPlayer')}
          </button>
        </fieldset>
        {error ? (
          <p class="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" class="btn btn-primary btn-large">
          {t('teams.save')}
        </button>
        {props.initial ? (
          <button type="button" class="btn btn-danger-quiet" onClick={() => setConfirmDelete(true)}>
            {t('teams.delete')}
          </button>
        ) : null}
      </form>
      {confirmDelete && props.initial ? (
        <ConfirmDialog
          danger
          confirmLabel={t('teams.delete')}
          message={t('teams.deleteConfirm', { name: props.initial.name })}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteTeam(props.initial!.id);
            navigate(href.teams());
          }}
        />
      ) : null}
    </section>
  );
}
