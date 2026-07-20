# pg-doctor-cli

A portable, open-source Postgres diagnostic CLI. Point it at any Postgres instance and it runs a battery of health checks — bloat, long-running queries, lock chains, connection saturation, and replication lag — then prints a clean terminal report or a Markdown summary you can paste into a PR, Slack, or an incident doc.

No agents, no extensions required (works against stock Postgres 10+), just a connection string.

## Contents

- [Quick start](#quick-start)
- [Example output](#example-output)
- [Connecting](#connecting)
- [Output formats](#output-formats)
- [Checks](#checks)
- [Selecting checks](#selecting-checks)
- [Thresholds](#thresholds)
- [Full CLI reference](#full-cli-reference)
- [Exit codes](#exit-codes)
- [Using it in CI](#using-it-in-ci)
- [SSL](#ssl)
- [Required privileges](#required-privileges)
- [How the checks work](#how-the-checks-work)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Quick start

Run it directly with `npx`, no install needed:

```sh
npx pg-doctor-cli --connection-string postgres://user:pass@host:5432/mydb
```

Or install it globally:

```sh
npm install -g pg-doctor-cli
pg-doctor --connection-string postgres://user:pass@host:5432/mydb
```

`pg-doctor` and `pg-doctor check` are equivalent — `check` is the default command, so you only need to type `pg-doctor` with your connection flags.

## Example output

```
pg-doctor report — prod-db.internal:5432/app
2026-07-20T17:54:30.807Z

[WARN] Connection saturation
  76 / 100 connections in use (76.0%)
┌─────────────────────┬───────┐
│ Metric              │ Count │
├─────────────────────┼───────┤
│ active              │ 12    │
├─────────────────────┼───────┤
│ idle                │ 58    │
├─────────────────────┼───────┤
│ idle in transaction │ 6     │
├─────────────────────┼───────┤
│ total               │ 76    │
├─────────────────────┼───────┤
│ max_connections     │ 100   │
└─────────────────────┴───────┘
  → Investigate idle-in-transaction sessions, add pooling (e.g. PgBouncer), or raise max_connections if headroom allows.

[OK] Long-running queries
  No queries running longer than 300s

[CRIT] Lock chains
  2 session(s) currently blocked waiting on locks
┌──────┬──────┬─────────────┬────────────────────┬───────────────────────────────────────────┐
│ PID  │ User │ Blocked (s) │ Blocked by (PIDs)  │ Query                                      │
├──────┼──────┼─────────────┼────────────────────┼───────────────────────────────────────────┤
│ 4821 │ app  │ 47          │ 4790               │ UPDATE orders SET status = $1 WHERE id = $2 │
└──────┴──────┴─────────────┴────────────────────┴───────────────────────────────────────────┘
  → Inspect the blocking PIDs (pg_terminate_backend if safe) or the transactions holding long locks.

[WARN] Table bloat (dead tuple estimate)
  1 table(s) with >= 20% dead tuples (min size 10.0 MB)
┌────────┬────────┬────────┬─────────────┬─────────────┬──────────┬──────────────────────┐
│ Schema │ Table  │ Dead % │ Live tuples │ Dead tuples │ Size     │ Last autovacuum       │
├────────┼────────┼────────┼─────────────┼─────────────┼──────────┼──────────────────────┤
│ public │ events │ 28.4   │ 1200000     │ 476000      │ 812.3 MB │ 2026-07-19T02:11:00Z  │
└────────┴────────┴────────┴─────────────┴─────────────┴──────────┴──────────────────────┘
  → Run VACUUM (or check autovacuum settings/thresholds) on flagged tables; consider pgstattuple for exact byte-level bloat.

[OK] Replication lag
  1 replica(s) connected, max replay lag: 0.42s

Summary: 2 ok, 2 warning, 1 critical
```

With `--format markdown`, the same run produces a table of contents-style summary table followed by one section per check — see [Output formats](#output-formats).

## Connecting

Connection info is resolved in this order, first match wins:

1. `--connection-string` / `-c` flag
2. A named profile from `.pgdoctorrc.json` (see below) — used if `--profile` is passed explicitly, or if a profile named `default` exists in the config file
3. `DATABASE_URL`, or `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` env vars (same convention as `psql`)

If none of these resolve to connection info, pg-doctor exits with code `3` and an explanatory error rather than hanging.

### Config file profiles

Create `.pgdoctorrc.json` (see `.pgdoctorrc.example.json` in this repo) in your project root or home directory (`~/.pgdoctorrc.json`) to save multiple connection profiles, e.g. one per environment:

```json
{
  "profiles": {
    "default": { "connectionString": "postgres://user:password@localhost:5432/mydb" },
    "staging": {
      "host": "staging-db.internal",
      "port": 5432,
      "database": "app",
      "user": "readonly_diagnostics",
      "password": "change-me",
      "ssl": true
    },
    "prod": {
      "host": "prod-db.internal",
      "port": 5432,
      "database": "app",
      "user": "readonly_diagnostics",
      "password": "change-me",
      "ssl": true
    }
  }
}
```

Each profile is either `{ "connectionString": "..." }` or the discrete `host` / `port` / `database` / `user` / `password` / `ssl` fields — not both.

```sh
pg-doctor --profile prod
pg-doctor --profile staging --config ./config/pgdoctor.json   # explicit config file path
```

`.pgdoctorrc.json` is git-ignored by default (see `.gitignore`) — don't commit real credentials, and prefer a dedicated read-only role for the connecting user (see [Required privileges](#required-privileges)).

## Output formats

```sh
pg-doctor -c "$DATABASE_URL"                            # pretty terminal report (default), printed to stdout
pg-doctor -c "$DATABASE_URL" --format markdown           # markdown, printed to stdout
pg-doctor -c "$DATABASE_URL" --format markdown -o report.md   # markdown, written to a file
pg-doctor -c "$DATABASE_URL" -o report.txt                # terminal-style report written to a file (colors stripped by chalk when not a TTY)
```

The Markdown report opens with a summary table (check, status badge, one-line summary), followed by a `##` section per check with its full detail table and recommendation — ready to paste into a GitHub PR description, a Slack message, or an incident postmortem.

## Checks

Run `pg-doctor list` to see all check ids at any time.

| id | Check | What it looks at |
|---|---|---|
| `connections` | Connection saturation | Active connection count vs `max_connections`, broken down by state (active / idle / idle in transaction) |
| `long-queries` | Long-running queries | Queries running longer than a threshold (default 300s), sorted by duration, excluding pg-doctor's own connection |
| `lock-chains` | Lock chains | Sessions currently blocked waiting on a lock, and the PID(s) blocking them, via `pg_blocking_pids()` |
| `bloat` | Table bloat (dead tuple estimate) | Dead-tuple ratio from `pg_stat_user_tables` — an extension-free proxy for bloat, not exact byte-level bloat (use `pgstattuple` for that — see below) |
| `replication` | Replication lag | If run against a primary: write/flush/replay lag per connected replica. If run against a standby: its own replay delay behind the primary |

## Selecting checks

Run everything (default), or scope to specific checks by id:

```sh
pg-doctor --only connections,bloat     # run just these two
pg-doctor --skip replication           # run everything except this one
```

`--only` and `--skip` are mutually composable but redundant together — `--only` already narrows the set before `--skip` would apply. An unknown id in `--only` fails fast with the list of valid ids.

## Thresholds

Every check's severity thresholds are configurable flags — none are hardcoded:

| Flag | Default | Meaning |
|---|---|---|
| `--long-query-seconds` | `300` | Query duration that counts as "long-running" (warning); 3x this duration is flagged critical |
| `--bloat-warn-pct` / `--bloat-critical-pct` | `20` / `40` | Dead-tuple percentage that triggers warning / critical |
| `--bloat-min-bytes` | `10485760` (10 MB) | Tables smaller than this are ignored by the bloat check, to cut noise from tiny tables |
| `--conn-warn-pct` / `--conn-critical-pct` | `75` / `90` | Percentage of `max_connections` in use that triggers warning / critical |
| `--timeout` | `10000` | Connection and per-statement timeout, in milliseconds |

The `lock-chains` check has no configurable threshold: any blocked session is at least a warning, 5+ concurrently blocked sessions is critical. The `replication` check flags 10s+ replay lag as a warning and 60s+ as critical (not yet exposed as flags — see [Development](#development) if you want to contribute that).

## Full CLI reference

```
Usage: pg-doctor [options] [command]

Commands:
  check [options]   Run diagnostic checks against a Postgres instance (default)
  list              List available diagnostic checks
  help [command]    Display help for a command

Options for "check" (also the default when no subcommand is given):
  -c, --connection-string <string>   Postgres connection string (or set DATABASE_URL / PG* env vars)
  -p, --profile <name>               Named profile from .pgdoctorrc.json
  --config <path>                    Path to a .pgdoctorrc.json config file
  -f, --format <format>              Output format: terminal | markdown (default: "terminal")
  -o, --output <file>                Write report to a file instead of stdout
  --only <ids>                       Comma-separated check ids to run (see "pg-doctor list")
  --skip <ids>                       Comma-separated check ids to skip
  --long-query-seconds <n>           Threshold for long-running queries (default: "300")
  --bloat-warn-pct <n>               Dead-tuple percentage that triggers a bloat warning (default: "20")
  --bloat-critical-pct <n>           Dead-tuple percentage that triggers a critical bloat flag (default: "40")
  --bloat-min-bytes <n>              Ignore tables smaller than this many bytes (default: "10485760")
  --conn-warn-pct <n>                Connection usage percentage that triggers a warning (default: "75")
  --conn-critical-pct <n>            Connection usage percentage that triggers a critical flag (default: "90")
  --timeout <ms>                     Connect and statement timeout in ms (default: "10000")
  --ssl                              Connect using SSL
  --insecure                         Connect using SSL without verifying the server certificate
  --strict                           Exit with a non-zero code on warnings too, not just critical findings
  -h, --help                         Display help for command
  -V, --version                      Output the version number
```

Run `pg-doctor check --help` or `pg-doctor --help` at any time for the live version of this from your installed copy.

## Exit codes

Designed for use in CI/scripts, so you can gate a pipeline on database health:

| Code | Meaning |
|---|---|
| `0` | No issues (or only warnings, if `--strict` was not passed) |
| `1` | Warnings found, and `--strict` was passed |
| `2` | Critical issues found |
| `3` | pg-doctor couldn't run at all (bad/missing connection info, connection failure, invalid `--only` id, etc.) |

## Using it in CI

```sh
# Fail the build on critical findings (e.g. active lock chains, near-saturated connections)
npx pg-doctor-cli -c "$DATABASE_URL" --format markdown -o pg-doctor-report.md
status=$?
if [ $status -ge 2 ]; then
  echo "pg-doctor found critical issues, see pg-doctor-report.md"
  exit 1
fi
```

Add `--strict` if you also want warnings to fail the build.

## SSL

```sh
pg-doctor -c "$DATABASE_URL" --ssl        # standard SSL, verifies the server certificate
pg-doctor -c "$DATABASE_URL" --insecure   # SSL without certificate verification (e.g. self-signed certs, some managed Postgres providers)
```

A profile in `.pgdoctorrc.json` can also set `"ssl": true` per-profile instead of passing `--ssl` on every run.

## Required privileges

Every check reads from Postgres system catalogs/views that are readable by any role by default — **no superuser required**:

- `pg_stat_activity` — connections, long-running queries
- `pg_locks` / `pg_blocking_pids()` — lock chains
- `pg_stat_user_tables` — bloat estimate
- `pg_stat_replication`, `pg_settings`, and standby-side functions (`pg_is_in_recovery()`, `pg_last_xact_replay_timestamp()`, etc.) — replication lag

A dedicated read-only monitoring role is recommended for production use, e.g.:

```sql
CREATE ROLE pg_doctor_readonly WITH LOGIN PASSWORD '...' CONNECTION LIMIT 3;
GRANT pg_monitor TO pg_doctor_readonly;  -- Postgres 10+, grants visibility into stats views
GRANT CONNECT ON DATABASE mydb TO pg_doctor_readonly;
```

pg-doctor never writes to the database — every check is a read-only `SELECT`.

## How the checks work

- **Connection saturation**: compares `count(*)` from `pg_stat_activity` against the `max_connections` setting, with a state breakdown (active / idle / idle in transaction).
- **Long-running queries**: filters `pg_stat_activity` for non-idle sessions where `now() - query_start` exceeds the threshold, excluding pg-doctor's own backend PID.
- **Lock chains**: for every session, checks whether `pg_blocking_pids(pid)` is non-empty — this built-in function (Postgres 9.6+) walks the full wait graph for you, no manual `pg_locks` self-joins needed.
- **Bloat**: uses `n_live_tup` / `n_dead_tup` from `pg_stat_user_tables` to compute a dead-tuple percentage per table. This is an approximation, not exact physical bloat — it needs no extensions and works against any Postgres 10+ instance out of the box. For exact byte-level bloat, install the `pgstattuple` extension and query `pgstattuple()` directly; that's out of scope for this proxy check by design (keeping pg-doctor dependency-free is a deliberate tradeoff).
- **Replication lag**: first checks `pg_is_in_recovery()`. On a primary, reports per-replica `write_lag` / `flush_lag` / `replay_lag` from `pg_stat_replication` (Postgres 10+). On a standby, reports `now() - pg_last_xact_replay_timestamp()` as the replay delay.

## Troubleshooting

- **"No Postgres connection info found"** — none of `-c`, a matching `.pgdoctorrc.json` profile, or `DATABASE_URL`/`PG*` env vars resolved. Double check `echo $DATABASE_URL` or pass `-c` explicitly.
- **"Profile ... not found in config file"** — you passed `--profile <name>` explicitly but no `.pgdoctorrc.json` (in cwd or `$HOME`) has a profile with that name; the error lists the profiles it did find.
- **Connection hangs then times out** — increase `--timeout`, or check that the host is reachable and not behind a firewall/VPN requirement.
- **SSL handshake errors against managed Postgres (RDS, Cloud SQL, etc.)** — try `--insecure` if the provider uses a certificate your local trust store doesn't recognize; prefer `--ssl` with proper CA verification when possible.
- **Replication check errors on a read replica with restricted permissions** — grant the connecting role `pg_monitor` (see [Required privileges](#required-privileges)); pg-doctor reports the underlying error per-check rather than aborting the whole run.
- **A single check errors out** — checks fail independently; one erroring check is reported inline as a critical finding with the underlying error message, and the rest of the report still runs.

## Development

```sh
npm install
npm run dev -- --connection-string postgres://...   # run via ts-node, no build step
npm run build                                        # compile src/ to dist/
npm run typecheck                                    # tsc --noEmit
npm run clean                                        # remove dist/
```

Project layout:

```
src/
  checks/       one file per diagnostic check, plus index.ts (registry + --only/--skip filtering)
  report/       terminal.ts and markdown.ts renderers, both consume the same CheckResult[] shape
  config.ts     connection resolution (flag / profile / env vars)
  runner.ts     runs checks against a pg.Pool, isolates failures per-check, computes exit code
  index.ts      commander CLI wiring
bin/pg-doctor.js  shebang entrypoint that requires dist/index.js (what npm's "bin" field points to)
```

To add a new check: implement the `Check` interface (`src/types.ts`) in a new file under `src/checks/`, register it in `src/checks/index.ts`'s `allChecks` array, and it's automatically picked up by `list`, `--only`/`--skip`, and both renderers.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
