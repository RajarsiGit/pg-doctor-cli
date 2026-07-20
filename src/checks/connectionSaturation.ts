import { Pool } from 'pg';
import { Check, CheckOptions, CheckResult, Severity } from '../types';

const QUERY = `
  SELECT
    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
    (SELECT count(*) FROM pg_stat_activity) AS total_connections,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') AS idle,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction') AS idle_in_transaction
`;

export const connectionSaturationCheck: Check = {
  id: 'connections',
  title: 'Connection saturation',
  async run(pool: Pool, options: CheckOptions): Promise<CheckResult> {
    const { rows } = await pool.query(QUERY);
    const row = rows[0];
    const max = Number(row.max_connections);
    const total = Number(row.total_connections);
    const pct = max > 0 ? (total / max) * 100 : 0;

    let severity: Severity = 'ok';
    if (pct >= options.connCriticalPct) severity = 'critical';
    else if (pct >= options.connWarnPct) severity = 'warning';

    const summary = `${total} / ${max} connections in use (${pct.toFixed(1)}%)`;

    return {
      id: this.id,
      title: this.title,
      severity,
      summary,
      recommendation:
        severity !== 'ok'
          ? 'Investigate idle-in-transaction sessions, add pooling (e.g. PgBouncer), or raise max_connections if headroom allows.'
          : undefined,
      columns: [
        { header: 'Metric', key: 'metric' },
        { header: 'Count', key: 'count' },
      ],
      rows: [
        { metric: 'active', count: row.active },
        { metric: 'idle', count: row.idle },
        { metric: 'idle in transaction', count: row.idle_in_transaction },
        { metric: 'total', count: total },
        { metric: 'max_connections', count: max },
      ],
    };
  },
};
