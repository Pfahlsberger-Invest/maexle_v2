import { neon } from '@neondatabase/serverless';

// Mount under /api/*
export const config = { path: '/api/*' };

const sql = neon(process.env.DATABASE_URL);

const DECAY_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const DECAY_AMOUNT = 10;
const TZ = 'Europe/Berlin';
const AUDIT_LIMIT = 500;

// Core players are protected: cannot be archived or hard-deleted.
const CORE_NAMES = new Set(['luki', 'simi', 'thoma', 'mauchi']);
const isCore = (name) =>
  !!name && CORE_NAMES.has(String(name).trim().toLowerCase());

// Admin password gates destructive actions (hard delete + reset all rounds).
// Override in Netlify env if you want to change it later.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LukasIstGeil';

// ---------- helpers ----------
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const err = (message, status = 400) => json({ error: message }, status);

const clientIp = (req) =>
  req.headers.get('x-nf-client-connection-ip') ||
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
  null;

// ---------- lazy decay ----------
async function applyDecayIfDue() {
  const rows = await sql`SELECT value FROM app_state WHERE key = 'last_decay_at'`;
  if (rows.length === 0) return;
  const lastDecay = new Date(rows[0].value);
  if (isNaN(lastDecay.getTime())) return;

  const elapsed = Date.now() - lastDecay.getTime();
  const intervals = Math.floor(elapsed / DECAY_INTERVAL_MS);
  if (intervals <= 0) return;

  const totalDecay = intervals * DECAY_AMOUNT;
  const newTs = new Date(
    lastDecay.getTime() + intervals * DECAY_INTERVAL_MS
  ).toISOString();

  await sql.transaction([
    sql`UPDATE players
        SET schande_score = GREATEST(-100, schande_score - ${totalDecay})
        WHERE schande_score > -100 AND archived_at IS NULL`,
    sql`UPDATE app_state
        SET value = to_jsonb(${newTs}::timestamptz), updated_at = now()
        WHERE key = 'last_decay_at'`,
  ]);
}

// ---------- read full state ----------
async function getFullState(req) {
  await applyDecayIfDue();

  // Active players with today + all-time stats
  const players = await sql`
    WITH
    at_losses AS (
      SELECT loser_id, COUNT(*)::int AS cnt FROM rounds GROUP BY loser_id
    ),
    at_parts AS (
      SELECT player_id, COUNT(*)::int AS cnt
      FROM round_participants GROUP BY player_id
    ),
    today_losses AS (
      SELECT loser_id, COUNT(*)::int AS cnt
      FROM rounds
      WHERE played_at >= date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}
      GROUP BY loser_id
    ),
    today_parts AS (
      SELECT rp.player_id, COUNT(*)::int AS cnt
      FROM round_participants rp
      JOIN rounds r ON r.id = rp.round_id
      WHERE r.played_at >= date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}
      GROUP BY rp.player_id
    )
    SELECT
      p.id, p.name, p.color, p.in_game, p.schande_score,
      COALESCE(atl.cnt, 0) AS at_punkte,
      COALESCE(atp.cnt, 0) AS at_runden,
      COALESCE(tl.cnt, 0)  AS today_punkte,
      COALESCE(tp.cnt, 0)  AS today_runden
    FROM players p
    LEFT JOIN at_losses    atl ON atl.loser_id  = p.id
    LEFT JOIN at_parts     atp ON atp.player_id = p.id
    LEFT JOIN today_losses tl  ON tl.loser_id   = p.id
    LEFT JOIN today_parts  tp  ON tp.player_id  = p.id
    WHERE p.archived_at IS NULL
    ORDER BY p.created_at
  `;

  // Archived players with their lifetime stats at archive time
  const archived = await sql`
    SELECT
      p.id, p.name, p.color, p.schande_score, p.archived_at,
      COALESCE(atl.cnt, 0) AS at_punkte,
      COALESCE(atp.cnt, 0) AS at_runden
    FROM players p
    LEFT JOIN (
      SELECT loser_id, COUNT(*)::int AS cnt FROM rounds GROUP BY loser_id
    ) atl ON atl.loser_id = p.id
    LEFT JOIN (
      SELECT player_id, COUNT(*)::int AS cnt FROM round_participants GROUP BY player_id
    ) atp ON atp.player_id = p.id
    WHERE p.archived_at IS NOT NULL
    ORDER BY p.archived_at DESC
  `;

  const audit = await sql`
    SELECT 'round'::text   AS kind,
           r.id            AS id,
           r.loser_id      AS player_id,
           p.name          AS player_name,
           p.color         AS player_color,
           NULL::int       AS delta,
           r.played_at     AS ts,
           r.ip_address::text AS ip
    FROM rounds r
    JOIN players p ON p.id = r.loser_id
    UNION ALL
    SELECT 'schande'::text AS kind,
           sa.id           AS id,
           sa.player_id,
           p.name,
           p.color,
           sa.delta,
           sa.applied_at AS ts,
           sa.ip_address::text AS ip
    FROM schande_adjustments sa
    JOIN players p ON p.id = sa.player_id
    ORDER BY ts DESC
    LIMIT ${AUDIT_LIMIT}
  `;

  return {
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      in_game: p.in_game,
      schande_score: p.schande_score,
      is_core: isCore(p.name),
      today: { punkte: p.today_punkte, runden: p.today_runden },
      all_time: { punkte: p.at_punkte, runden: p.at_runden },
    })),
    archived: archived.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      schande_score: p.schande_score,
      archived_at: p.archived_at,
      is_core: isCore(p.name),
      all_time: { punkte: p.at_punkte, runden: p.at_runden },
    })),
    audit,
    your_ip: clientIp(req),
  };
}

// ---------- main handler ----------
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method;
  const ip = clientIp(req);

  try {
    // GET /state
    if (method === 'GET' && path === '/state') {
      return json(await getFullState(req));
    }

    // POST /players  { name, color }
    if (method === 'POST' && path === '/players') {
      const { name, color } = await req.json().catch(() => ({}));
      if (!name || !color) return err('name und color erforderlich');
      const cleanName = String(name).trim().slice(0, 50);
      if (!cleanName) return err('name darf nicht leer sein');
      const [p] = await sql`
        INSERT INTO players (name, color, in_game)
        VALUES (${cleanName}, ${color}, true)
        RETURNING id, name, color, in_game, schande_score
      `;
      return json({ ...p, is_core: isCore(p.name) }, 201);
    }

    // POST /players/:id/revive — un-archive
    const reviveMatch = path.match(/^\/players\/([0-9a-fA-F-]{36})\/revive$/);
    if (reviveMatch && method === 'POST') {
      const id = reviveMatch[1];
      const rows = await sql`
        UPDATE players
        SET archived_at = NULL, in_game = true
        WHERE id = ${id} AND archived_at IS NOT NULL
        RETURNING id, name, color, in_game, schande_score
      `;
      if (rows.length === 0) return err('Spieler nicht gefunden oder bereits aktiv', 404);
      return json({ ...rows[0], is_core: isCore(rows[0].name) });
    }

    // DELETE /players/:id/hard  { password } — true delete with cascade
    const hardMatch = path.match(/^\/players\/([0-9a-fA-F-]{36})\/hard$/);
    if (hardMatch && method === 'DELETE') {
      const id = hardMatch[1];
      const { password } = await req.json().catch(() => ({}));
      if (password !== ADMIN_PASSWORD) return err('Falsches Passwort', 403);

      const [player] = await sql`SELECT name FROM players WHERE id = ${id}`;
      if (!player) return err('Spieler nicht gefunden', 404);
      if (isCore(player.name)) {
        return err('Core-Spieler können nicht gelöscht werden', 403);
      }

      await sql.transaction([
        sql`DELETE FROM schande_adjustments WHERE player_id = ${id}`,
        sql`DELETE FROM round_participants WHERE player_id = ${id}`,
        sql`DELETE FROM rounds WHERE loser_id = ${id}`,
        sql`DELETE FROM players WHERE id = ${id}`,
      ]);
      return json({ ok: true });
    }

    // /players/:id (PATCH = in_game toggle, DELETE = archive)
    const playerMatch = path.match(/^\/players\/([0-9a-fA-F-]{36})$/);
    if (playerMatch) {
      const id = playerMatch[1];

      if (method === 'PATCH') {
        const body = await req.json().catch(() => ({}));
        if (typeof body.in_game !== 'boolean') {
          return err('in_game (boolean) erforderlich');
        }
        const rows = await sql`
          UPDATE players SET in_game = ${body.in_game}
          WHERE id = ${id} AND archived_at IS NULL
          RETURNING id, name, color, in_game, schande_score
        `;
        if (rows.length === 0) return err('Spieler nicht gefunden', 404);
        return json({ ...rows[0], is_core: isCore(rows[0].name) });
      }

      if (method === 'DELETE') {
        // Soft-archive only; refuse core players
        const [player] = await sql`
          SELECT name FROM players WHERE id = ${id} AND archived_at IS NULL
        `;
        if (!player) return err('Spieler nicht gefunden', 404);
        if (isCore(player.name)) {
          return err('Core-Spieler können nicht archiviert werden', 403);
        }
        await sql`UPDATE players SET archived_at = now() WHERE id = ${id}`;
        return json({ ok: true });
      }
    }

    // DELETE /api/audit/:kind/:id  { password }
    // Löscht einen Audit-Eintrag und macht die zugehörige DB-Änderung rückgängig.
    const auditMatch = path.match(/^\/audit\/(round|schande)\/([0-9a-fA-F-]{36})$/);
    if (auditMatch && method === 'DELETE') {
      const kind = auditMatch[1];
      const id = auditMatch[2];
      const { password } = await req.json().catch(() => ({}));
      if (password !== ADMIN_PASSWORD) return err('Falsches Passwort', 403);

      if (kind === 'round') {
        // Cascade entfernt round_participants automatisch
        const result = await sql`
          DELETE FROM rounds WHERE id = ${id} RETURNING id
        `;
        if (result.length === 0) return err('Eintrag nicht gefunden', 404);
        return json({ ok: true });
      }

      // schande: Delta vom Spieler rückgängig machen + Eintrag löschen,
      // atomar in einer CTE-Query.
      // Hinweis: bei ursprünglich geclippten Werten ist die Umkehrung approximativ.
      const result = await sql`
        WITH deleted AS (
          DELETE FROM schande_adjustments WHERE id = ${id}
          RETURNING player_id, delta
        )
        UPDATE players p
        SET schande_score = GREATEST(-100, LEAST(100, schande_score - d.delta))
        FROM deleted d
        WHERE p.id = d.player_id
        RETURNING p.id
      `;
      if (result.length === 0) return err('Eintrag nicht gefunden', 404);
      return json({ ok: true });
    }

    // POST /rounds  { loser_id, participants: [uuid] }
    if (method === 'POST' && path === '/rounds') {
      const { loser_id, participants } = await req.json().catch(() => ({}));
      if (
        !loser_id ||
        !Array.isArray(participants) ||
        participants.length === 0
      ) {
        return err('loser_id und participants erforderlich');
      }

      const [round] = ip
        ? await sql`
            INSERT INTO rounds (loser_id, ip_address)
            VALUES (${loser_id}, ${ip}::inet)
            RETURNING id, played_at`
        : await sql`
            INSERT INTO rounds (loser_id)
            VALUES (${loser_id})
            RETURNING id, played_at`;

      await sql`
        INSERT INTO round_participants (round_id, player_id)
        SELECT ${round.id}::uuid, x::uuid
        FROM jsonb_array_elements_text(
          ${JSON.stringify(participants)}::jsonb
        ) AS x
      `;

      return json({ id: round.id, played_at: round.played_at }, 201);
    }

    // DELETE /rounds — wipe all rounds (password protected)
    if (method === 'DELETE' && path === '/rounds') {
      const { password } = await req.json().catch(() => ({}));
      if (password !== ADMIN_PASSWORD) return err('Falsches Passwort', 403);

      await sql.transaction([
        sql`DELETE FROM round_participants`,
        sql`DELETE FROM rounds`,
      ]);
      return json({ ok: true });
    }

    // POST /schande  { player_id, delta }
    if (method === 'POST' && path === '/schande') {
      const { player_id, delta } = await req.json().catch(() => ({}));
      const d = Number(delta);
      if (!player_id || !Number.isFinite(d) || d === 0) {
        return err('player_id und non-zero delta erforderlich');
      }
      if (d < -200 || d > 200) return err('delta außerhalb des Bereichs');

      const inserts = ip
        ? [
            sql`INSERT INTO schande_adjustments (player_id, delta, ip_address)
                VALUES (${player_id}, ${d}, ${ip}::inet)`,
            sql`UPDATE players
                SET schande_score = GREATEST(-100, LEAST(100, schande_score + ${d}))
                WHERE id = ${player_id}`,
          ]
        : [
            sql`INSERT INTO schande_adjustments (player_id, delta)
                VALUES (${player_id}, ${d})`,
            sql`UPDATE players
                SET schande_score = GREATEST(-100, LEAST(100, schande_score + ${d}))
                WHERE id = ${player_id}`,
          ];
      await sql.transaction(inserts);

      const [p] = await sql`
        SELECT id, name, color, in_game, schande_score
        FROM players WHERE id = ${player_id}
      `;
      if (!p) return err('Spieler nicht gefunden', 404);
      return json({ ...p, is_core: isCore(p.name) });
    }

    return err('Not found', 404);
  } catch (e) {
    console.error('API error:', e?.message || e);
    return err(e.message || 'Internal server error', 500);
  }
};
