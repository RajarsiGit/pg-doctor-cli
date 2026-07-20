import { Pool } from 'pg';
import { Check, CheckOptions, CheckResult, Severity } from '../types';

const PRIMARY_QUERY = `
  SELECT
    client_addr,
    application_name,
    state,
    EXTRACT(EPOCH FROM write_lag)::numeric(10,2) AS write_lag_seconds,
    EXTRACT(EPOCH FROM flush_lag)::numeric(10,2) AS flush_lag_seconds,
    EXTRACT(EPOCH FROM replay_lag)::numeric(10,2) AS replay_lag_seconds,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes
  FROM pg_stat_replication
`;

const STANDBY_QUERY = `
  SELECT
    EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::numeric(10,2) AS replay_delay_seconds,
    pg_last_wal_receive_lsn() AS receive_lsn,
    pg_last_wal_replay_lsn() AS replay_lsn
`;

const LAG_WARN_SECONDS = 10;
const LAG_CRITICAL_SECONDS = 60;

export const replicationLagCheck: Check = {
  id: 'replication',
  title: 'Replication lag',
  async run(pool: Pool, _options: CheckOptions): Promise<CheckResult> {
    const { rows: recoveryRows } = await pool.query('SELECT pg_is_in_recovery() AS in_recovery');
    const inRecovery = recoveryRows[0].in_recovery as boolean;

    if (inRecovery) {
      const { rows } = await pool.query(STANDBY_QUERY);
      const row = rows[0];
      const lagSeconds = row.replay_delay_seconds === null ? null : Number(row.replay_delay_seconds);

      let severity: Severity = 'ok';
      if (lagSeconds === null) severity = 'ok';
      else if (lagSeconds >= LAG_CRITICAL_SECONDS) severity = 'critical';
      else if (lagSeconds >= LAG_WARN_SECONDS) severity = 'warning';

      return {
        id: this.id,
        title: this.title,
        severity,
        summary:
          lagSeconds === null
            ? 'Standby has not replayed any transactions yet'
            : `This server is a standby, replay lag: ${lagSeconds}s`,
        recommendation:
          severity !== 'ok' ? 'Check network/WAL shipping to this standby and primary write load.' : undefined,
        columns: [
          { header: 'Metric', key: 'metric' },
          { header: 'Value', key: 'value' },
        ],
        rows: [
          { metric: 'replay delay (s)', value: row.replay_delay_seconds },
          { metric: 'receive LSN', value: row.receive_lsn },
          { metric: 'replay LSN', value: row.replay_lsn },
        ],
      };
    }

    const { rows } = await pool.query(PRIMARY_QUERY);

    if (rows.length === 0) {
      return {
        id: this.id,
        title: this.title,
        severity: 'ok',
        summary: 'This server is a primary with no connected replicas',
      };
    }

    const maxLag = Math.max(...rows.map((r) => Number(r.replay_lag_seconds ?? 0)));
    let severity: Severity = 'ok';
    if (maxLag >= LAG_CRITICAL_SECONDS) severity = 'critical';
    else if (maxLag >= LAG_WARN_SECONDS) severity = 'warning';

    return {
      id: this.id,
      title: this.title,
      severity,
      summary: `${rows.length} replica(s) connected, max replay lag: ${maxLag.toFixed(2)}s`,
      recommendation: severity !== 'ok' ? 'Investigate replica resource usage, network, or WAL generation rate.' : undefined,
      columns: [
        { header: 'Client', key: 'client_addr' },
        { header: 'App', key: 'application_name' },
        { header: 'State', key: 'state' },
        { header: 'Write lag (s)', key: 'write_lag_seconds' },
        { header: 'Flush lag (s)', key: 'flush_lag_seconds' },
        { header: 'Replay lag (s)', key: 'replay_lag_seconds' },
      ],
      rows,
    };
  },
};
