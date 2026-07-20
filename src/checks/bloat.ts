import { Pool } from 'pg';
import { Check, CheckOptions, CheckResult, Severity } from '../types';

// Extension-free approximation using live/dead tuple counts from pg_stat_user_tables.
// This is a proxy for physical bloat, not exact byte-level bloat (which needs pgstattuple).
const QUERY = `
  SELECT
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    CASE WHEN n_live_tup + n_dead_tup = 0 THEN 0
         ELSE round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
    END AS dead_pct,
    pg_total_relation_size(relid) AS total_bytes,
    last_autovacuum,
    last_vacuum
  FROM pg_stat_user_tables
  WHERE n_live_tup + n_dead_tup > 0
  ORDER BY n_dead_tup DESC
  LIMIT 20
`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export const bloatCheck: Check = {
  id: 'bloat',
  title: 'Table bloat (dead tuple estimate)',
  async run(pool: Pool, options: CheckOptions): Promise<CheckResult> {
    const { rows } = await pool.query(QUERY);

    const flagged = rows.filter(
      (r) => Number(r.total_bytes) >= options.bloatMinBytes && Number(r.dead_pct) >= options.bloatWarnPct
    );
    const critical = flagged.filter((r) => Number(r.dead_pct) >= options.bloatCriticalPct);

    let severity: Severity = 'ok';
    if (critical.length > 0) severity = 'critical';
    else if (flagged.length > 0) severity = 'warning';

    const summary =
      flagged.length === 0
        ? 'No tables with significant dead-tuple bloat detected'
        : `${flagged.length} table(s) with >= ${options.bloatWarnPct}% dead tuples (min size ${formatBytes(
            options.bloatMinBytes
          )})`;

    return {
      id: this.id,
      title: this.title,
      severity,
      summary,
      recommendation:
        severity !== 'ok'
          ? 'Run VACUUM (or check autovacuum settings/thresholds) on flagged tables; consider pgstattuple for exact byte-level bloat.'
          : undefined,
      columns: [
        { header: 'Schema', key: 'schemaname' },
        { header: 'Table', key: 'relname' },
        { header: 'Dead %', key: 'dead_pct' },
        { header: 'Live tuples', key: 'n_live_tup' },
        { header: 'Dead tuples', key: 'n_dead_tup' },
        { header: 'Size', key: 'size' },
        { header: 'Last autovacuum', key: 'last_autovacuum' },
      ],
      rows: rows
        .filter((r) => Number(r.total_bytes) >= options.bloatMinBytes)
        .map((r) => ({ ...r, size: formatBytes(Number(r.total_bytes)) })),
    };
  },
};
