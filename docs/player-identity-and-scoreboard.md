# Player identity, profiles and the live scoreboard

Design note — not yet built. Covers the player id, where the data lives, the
record shape, and the order to build it in. Written so the first phase can ship
with no backend at all and every later phase is additive.

---

## 1. The identity

### The id should be random, not a hash of the name

The brief says "a short hash, produced when the player enters a user name". A
hash *of the name* has two problems that matter later:

- **Collisions are guaranteed.** Two players both type `Zorblax` and get the
  same id — same profile, same scoreboard row.
- **It is not a secret.** Anyone who knows a name can compute the id, and the id
  is what a scoreboard write is addressed to. That makes forged submissions
  trivial the moment there's anything to win.

So: the name is a *label* (not unique, changeable), and the id is a random
token minted once. Two values, two jobs:

| value | form | who sees it | purpose |
|---|---|---|---|
| `id` | 8 chars, Crockford base32 — `K3M7QP2R` | public | addresses the profile; shown as `Zorblax#K3M7QP2R` |
| `token` | 128-bit random, base64url | client only, never displayed | proves "I am this player" on writes |

Display name plus short tag is the Discord model, and it's the right one here:
players get the name they wanted, the system gets uniqueness, and the tag is
short enough to read out loud.

**Collision handling.** 8 base32 chars is 40 bits. At 100k players the birthday
probability of *some* collision is around 0.5% — small but not zero, and it
grows quadratically. Don't tune the length; let the server generate the id and
retry on a unique-constraint violation. That makes collisions structurally
impossible at any population, and 8 chars stays readable.

**Storage on the client.** `localStorage['abductor.player']` holds
`{id, name, token}`. Losing it means losing the account, which is the accepted
trade for having no passwords or email. A later "transfer code" feature (show
the token as a QR/word list, paste on another device) covers the migration case
cheaply — worth designing the token to survive being copied by hand.

### First-run flow

1. Boot. Read `localStorage['abductor.player']`.
2. Missing → show the name screen. It fits after the language picker and before
   the main menu, styled as another `.screen` (index.html already has the
   pattern and the CSS).
3. `POST /api/player {name}` → server mints `id` + `token`, returns both.
4. Offline or the request fails → mint an id **locally** with the same alphabet,
   mark the profile `pending:true`, and carry on. The game is a static PWA and
   must stay playable with no network. The next successful call reconciles: the
   server takes the local id if free, or issues a new one and the client
   rewrites its copy.

Renaming later is just `PATCH /api/player {name}` — the id never changes.

---

## 2. Where the data lives

### Recommendation: D1 as the system of record, KV as a cache

The brief suggests a key-value store. KV is the right shape for the *profile*
(read by key, written rarely) and the wrong shape for the *scoreboard*, which is
the actual goal. Workers KV has no range queries, no sorting, and is eventually
consistent with propagation measured in tens of seconds — so "top 100 this
season" would mean reading every player's record on every request, and a player
would not see their own score appear for up to a minute after finishing a run.

What each Cloudflare primitive is actually good for here:

| | fits | doesn't fit |
|---|---|---|
| **Workers KV** | caching one precomputed `top100.json`; read-hot, write-rare | leaderboards, counters, anything read-after-write |
| **D1** (SQLite) | profiles, sessions, `ORDER BY score LIMIT 100`, per-season queries | very high write rates (not our problem: one write per run) |
| **Durable Objects** | a genuinely *live* scoreboard — one object owns the season ranking, pushes updates over WebSocket | being the primary store for everything |
| **R2** | cosmetics/skin assets if they ever get big | structured queries |

So the shape is:

- **D1** holds players, sessions, season scores. It is the source of truth.
- **KV** holds the rendered leaderboard JSON, rewritten on a cron (every 30–60s)
  or on write. The scoreboard page reads KV and is therefore free and fast at
  any traffic level; a player's *own* rank comes from D1 so it's immediate.
- **A Durable Object** arrives only in the "live" phase, when the scoreboard
  should update without a refresh. Not needed to launch.

Free tiers cover this comfortably: Workers 100k requests/day, D1 5M rows read
and 100k rows written per day. One session-end write per completed run means
the write budget is not a consideration until the game is very popular.

### Hosting note

The site is static on GitHub Pages behind `abductor.lol` (see `CNAME`). Two ways
to attach an API:

- **Keep Pages, add a Worker on `api.abductor.lol`.** Needs the domain on
  Cloudflare DNS, and needs CORS headers on every response.
- **Move hosting to Cloudflare Pages.** Then `/api/*` is same-origin — no CORS,
  no second domain, one deploy. Given the game is already a build-step-free pile
  of static files, this is close to free to do and removes a whole class of
  problems.

Recommend the second unless there's a reason to stay on GitHub Pages.

---

## 3. The record shape

The brief describes one object per user with nested totals, a current-session
object, and session timing. That shape is right for what the client wants to
read; splitting sessions into their own rows is right for what the server needs
to query. Both, then: the player record carries the lifetime rollup, and
sessions live separately.

### What the client holds and sends

```jsonc
{
  "id": "K3M7QP2R",
  "name": "Zorblax",
  "createdAt": 1753900000,
  "lastSeenAt": 1753986400,

  // lifetime — the rollup the profile screen renders
  "lifetime": {
    "runs": 17,
    "playMs": 4021000,
    "score": 12840,
    "taken": 219,
    "crystals": 41,
    "byKind": { "cow": 84, "sheep": 51, "human": 33, "bird": 28, "horse": 23 },
    "best": { "score": 3120, "taken": 44, "runMs": 610000 }
  },

  // the run in progress — mirrors S.tally / S.taken / S.score
  "session": {
    "id": "s_9f2c…",
    "startedAt": 1753986100,
    "endedAt": null,
    "world": "earth",
    "mode": "story",            // story | exploration | tutorial
    "score": 0,
    "taken": 0,
    "crystals": 0,
    "byKind": {},
    "endedReason": null         // crash | energy | meteor | quit | …
  },

  "cosmetics": { "skin": "classic", "owned": ["classic"] }
}
```

`byKind` maps 1:1 onto the existing `S.tally` (`{name: {c, p}}` — the counts are
what's worth keeping; points are derivable). `taken`, `score`, `crystals` and
`elapsed` all already exist on `S`. Nothing new needs to be tracked during play,
which is what makes phase 1 small.

### D1 schema

```sql
CREATE TABLE player (
  id           TEXT PRIMARY KEY,      -- K3M7QP2R
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL,         -- sha256(token); the token itself is never stored
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  skin         TEXT NOT NULL DEFAULT 'classic',
  lifetime     TEXT NOT NULL DEFAULT '{}'   -- the rollup above, as JSON
);

CREATE TABLE session (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES player(id),
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  world       TEXT, mode TEXT,
  score       INTEGER NOT NULL DEFAULT 0,
  taken       INTEGER NOT NULL DEFAULT 0,
  crystals    INTEGER NOT NULL DEFAULT 0,
  by_kind     TEXT NOT NULL DEFAULT '{}',
  ended_reason TEXT
);
CREATE INDEX session_player ON session(player_id, started_at DESC);

CREATE TABLE season (
  id TEXT PRIMARY KEY, name TEXT, starts_at INTEGER, ends_at INTEGER
);

CREATE TABLE season_score (
  season_id  TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  taken      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, player_id)
);
CREATE INDEX season_rank ON season_score(season_id, best_score DESC);
```

`season_rank` is the index that makes "top 100 this season" one cheap query —
the thing KV alone cannot do.

---

## 4. API surface

Small on purpose. Chatty per-frame writes are neither needed nor affordable.

| method | path | when | body / returns |
|---|---|---|---|
| `POST` | `/api/player` | first run | `{name}` → `{id, name, token}` |
| `PATCH` | `/api/player` | rename, skin change | auth; `{name?, skin?}` |
| `GET` | `/api/player/:id` | profile screen | public view (no token, no email — there is none) |
| `POST` | `/api/session` | `startGame()` | auth; `{world, mode}` → `{sessionId, startedAt}` |
| `POST` | `/api/session/:id/end` | `endGame()` / quit | auth; the session block → `{rank, seasonRank, unlocked:[]}` |
| `GET` | `/api/leaderboard?season=&limit=` | scoreboard screen | from KV; `{updatedAt, rows:[…]}` |
| `GET` | `/api/leaderboard/me` | scoreboard screen | auth; from D1, so it's immediate |

Auth is `Authorization: Bearer <token>`; the Worker compares `sha256(token)` to
`token_hash`.

**Writes happen at run boundaries only** — one at start, one at end. A run that
is abandoned (tab closed) leaves `ended_at NULL`; a nightly cron closes those
out using the last-known values, or they simply don't count. Sending a beacon on
`visibilitychange` catches most of them.

**Offline queue.** If a session-end POST fails, push it to
`localStorage['abductor.outbox']` and retry on the next boot. The lifetime
rollup is recomputed server-side from sessions, so replaying a queued session
late is safe as long as each carries its own `id` (idempotent upsert).

---

## 5. The honest note on cheating

The game is client-authoritative and its source is served unminified. Anyone who
opens devtools can `fetch('/api/session/…/end', {score: 999999999})`. That is
fine for a friendly scoreboard and *not* fine for seasonal competitions with
rewards, so it should be decided before rewards ship, not after.

Cheapest defences, in order of value per unit of effort:

1. **Plausibility bounds server-side.** A session has a duration; points per
   second, takes per second and crystals per minute all have hard ceilings the
   real game can't exceed. Reject or flag anything past them. Catches the lazy
   99%.
2. **Server-issued session ids with a start timestamp.** Already in the design —
   it means a run's duration is server-measured, not client-claimed.
3. **Two boards.** An open "all scores" board and a curated "verified" board that
   only accepts sessions passing every check. Rewards hang off the second.
4. **Event log + replay** — the client uploads the abduction events, the server
   re-derives the score from the same scoring table. Real work, and the only
   thing that actually closes the hole. Worth it only if the competition matters.

Recommendation: ship 1 + 2 with the scoreboard, and don't attach anything
scarce to a leaderboard position until 4 exists.

---

## 6. Build order

Each phase is useful on its own and nothing is thrown away.

**Phase 0 — identity, no backend.** Name screen, id minting, profile and
lifetime totals in `localStorage`. A local "personal bests" panel in the menu.
Ships today, no infra, no cost, and it's the whole client half of every later
phase. Everything after this is sync.

**Phase 1 — the Worker.** Cloudflare Pages + D1, `POST /api/player` and the two
session endpoints, plus the outbox. Profiles now survive a cleared browser (via
the transfer code) and the server has real data to rank.

**Phase 2 — the scoreboard.** Leaderboard query, KV cache, a scoreboard screen
in the menu next to the existing sectors. All-time first; seasons need only a
`WHERE season_id`.

**Phase 3 — seasons and rewards.** `season` rows with dates, `season_score`
upserts on session end, and an unlock table mapping thresholds to skins. Skins
are the natural first reward: the saucer is procedural (`systems/saucer.js`), so
a skin is a small palette + material record, not an asset pipeline.

**Phase 4 — live.** A Durable Object per season owning the top-N in memory,
pushing over WebSocket. Only worth building once there are enough concurrent
players for a changing board to be interesting.

---

## 7. Code that will need to change

For orientation when phase 0 starts:

- **new `src/net/player.js`** — identity, localStorage profile, id minting.
- **new `src/net/api.js`** — fetch wrappers, auth header, offline outbox.
- **new `src/ui/name-screen.js`** + a `#nameScreen` block in `index.html` —
  first-run prompt, matching the existing `.screen` styling.
- **`src/ui/screens.js`** — `startGame()` opens a session (it already resets
  `S.taken` / `S.tally` in one place); `endGame()` closes it (it already reads
  the whole tally to render the breakdown).
- **`src/core/state.js`** — a `S.session` handle, nothing more; the counters the
  server wants (`score`, `taken`, `tally`, `crystals`, `elapsed`) all exist.
- **`src/i18n.js`** — strings for the name prompt and the scoreboard.

---

## 8. Open decisions

1. **Cloudflare Pages vs staying on GitHub Pages** — decides whether CORS and a
   second hostname are in scope.
2. **Is a name change free, or once per season?** Affects whether the leaderboard
   stores a name snapshot per row.
3. **Does the tutorial count?** Recommend no: `mode:'tutorial'` sessions upload
   but never touch lifetime or season totals.
4. **When do rewards attach to rank?** See §5 — this is the decision that sets
   how much anti-cheat work is required.
