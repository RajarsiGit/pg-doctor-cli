import { Pool } from 'pg';
import { Check, CheckOptions, CheckResult, Severity } from '../types';

const QUERY = `
  SELECT
    pid,
    usename,
    application_name,
    client_addr,
    state,
    EXTRACT(EPOCH FROM (now() - query_start))::int AS duration_seconds,
    left(query, 200) AS query
  FROM pg_stat_activity
  WHERE pid != pg_backend_pid()
    AND state != 'idle'
    AND query_start IS NOT NULL
    AND now() - query_start > ($1 || ' seconds')::interval
  ORDER BY duration_seconds DESC
  LIMIT 20
`;

export const longRunningQueriesCheck: Check = {
  id: 'long-queries',
  title: 'Long-running queries',
  async run(pool: Pool, options: CheckOptions): Promise<CheckResult> {
    const { rows } = await pool.query(QUERY, [options.longQuerySeconds]);

    let severity: Severity = 'ok';
    if (rows.some((r) => Number(r.duration_seconds) > options.longQuerySeconds * 3)) severity = 'critical';
    else if (rows.length > 0) severity = 'warning';

    const summary =
      rows.length === 0
        ? `No queries running longer than ${options.longQuerySeconds}s`
        : `${rows.length} quer${rows.length === 1 ? 'y' : 'ies'} running longer than ${options.longQuerySeconds}s`;

    return {
      id: this.id,
      title: this.title,
      severity,
      summary,
      recommendation:
        severity !== 'ok'
          ? 'Review these queries for missing indexes, unbounded scans, or stuck transactions; consider statement_timeout.'
          : undefined,
      columns: [
        { header: 'PID', key: 'pid' },
        { header: 'User', key: 'usename' },
        { header: 'App', key: 'application_name' },
        { header: 'State', key: 'state' },
        { header: 'Duration (s)', key: 'duration_seconds' },
        { header: 'Query', key: 'query' },
      ],
      rows,
    };
  },
};
