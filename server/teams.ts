// Teams (rosters). Stored together in one small document.

import type { Team } from '../core/types.ts';
import { LIMITS, validateId, validatePlayers, validateText } from '../core/validate.ts';
import { requireOwner, requireOwnerOrDevice, type Ctx } from './context.ts';
import { notFound, validationError } from './errors.ts';
import { json, noContent, readJson } from './http.ts';
import { update } from './store.ts';

interface TeamsDoc {
  teams: Team[];
}

const TEAMS_KEY = 'teams';
export const MAX_TEAMS = 300;

export async function readTeams(ctx: Ctx): Promise<Team[]> {
  const doc = await ctx.deps.store.get<TeamsDoc>(TEAMS_KEY);
  return doc?.data.teams ?? [];
}

export async function listTeams(ctx: Ctx): Promise<Response> {
  await requireOwnerOrDevice(ctx);
  const teams = [...(await readTeams(ctx))].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return json({ teams });
}

/** Creates or replaces a team (including its players). Safe to retry. */
export async function putTeam(ctx: Ctx): Promise<Response> {
  await requireOwner(ctx);
  const id = validateId(ctx.params.id);
  if (!id.ok) throw validationError(id.reason);
  const body = await readJson(ctx.req);
  const name = validateText(body.name, 'name', LIMITS.teamName, { required: true });
  if (!name.ok) throw validationError(name.reason);
  const players = validatePlayers(body.players, ctx.deps.uuid);
  if (!players.ok) throw validationError(players.reason);

  const nowIso = new Date(ctx.deps.now()).toISOString();
  let created = false;
  let saved: Team | null = null;
  await update<TeamsDoc>(ctx.deps.store, TEAMS_KEY, (current) => {
    const teams = current?.teams ?? [];
    const existing = teams.find((t) => t.id === id.value);
    created = !existing;
    if (!existing && teams.length >= MAX_TEAMS) throw validationError('too_many_teams');
    const team: Team = {
      id: id.value,
      name: name.value as string,
      players: players.value,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    saved = team;
    return { teams: [...teams.filter((t) => t.id !== id.value), team] };
  });
  return json({ team: saved }, created ? 201 : 200);
}

export async function deleteTeam(ctx: Ctx): Promise<Response> {
  await requireOwner(ctx);
  const id = validateId(ctx.params.id);
  if (!id.ok) throw notFound('Team');
  await update<TeamsDoc>(ctx.deps.store, TEAMS_KEY, (current) => {
    const teams = current?.teams ?? [];
    if (!teams.some((t) => t.id === id.value)) throw notFound('Team');
    return { teams: teams.filter((t) => t.id !== id.value) };
  });
  // Matches keep their team-name snapshot, so deleting a team never breaks a report.
  return noContent();
}
