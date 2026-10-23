// Daily Vercel Cron Job: a few light queries so Supabase's Free plan does not pause
// the project after a week without database activity. Only Vercel can call it:
// it sends `Authorization: Bearer <CRON_SECRET>`.

import { safeEqual } from '../../server/crypto.ts';
import { json } from '../../server/http.ts';
import { getSql, misconfigured } from '../../server/runtime.ts';

export default {
  async fetch(request: Request): Promise<Response> {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization') ?? '';
    if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }
    const sql = getSql();
    if (!sql) return misconfigured();
    const [clock] = await sql<{ now: Date }[]>`select now()`;
    const [count] = await sql<{ matches: number }[]>`select count(*)::int as matches from arbitraje.matches`;
    // Housekeeping: pairing codes are useless one day after they expire.
    await sql`delete from arbitraje.pairing_codes where expires_at < now() - interval '1 day'`;
    return json({ ok: true, at: new Date(clock!.now).toISOString(), matches: count!.matches });
  },
};
