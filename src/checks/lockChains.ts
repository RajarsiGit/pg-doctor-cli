import { Pool } from 'pg';
import { Check, CheckOptions, CheckResult, Severity } from '../types';

const QUERY = `
  SELECT
    a.pid,
    a.usename,
    a.application_name,
    EXTRACT(EPOCH FROM (now() - a.query_start))::int AS blocked_seconds,
    left(a.query, 200) AS query,
    pg_blocking_pids(a.pid) AS blocked_by
  FROM pg_stat_activity a
  WHERE cardinality(pg_blocking_pids(a.pid)) > 0
  ORDER BY blocked_seconds DESC
  LIMIT 20
`;

export const lockChainsCheck: Check = {
  id: 'lock-chains',
  title: 'Lock chains',
  async run(pool: Pool, _options: CheckOptions): Promise<CheckResult> {
    const { rows } = await pool.query(QUERY);

    const severity: Severity = rows.length === 0 ? 'ok' : rows.length >= 5 ? 'critical' : 'warning';
    const summary =
      rows.length === 0 ? 'No blocked sessions' : `${rows.length} session(s) currently blocked waiting on locks`;

    return {
      id: this.id,
      title: this.title,
      severity,
      summary,
      recommendation:
        rows.length > 0
          ? 'Inspect the blocking PIDs (pg_terminate_backend if safe) or the transactions holding long locks.'
          : undefined,
      columns: [
        { header: 'PID', key: 'pid' },
        { header: 'User', key: 'usename' },
        { header: 'Blocked (s)', key: 'blocked_seconds' },
        { header: 'Blocked by (PIDs)', key: 'blocked_by' },
        { header: 'Query', key: 'query' },
      ],
      rows: rows.map((r) => ({ ...r, blocked_by: Array.isArray(r.blocked_by) ? r.blocked_by.join(', ') : r.blocked_by })),
    };
  },
};
