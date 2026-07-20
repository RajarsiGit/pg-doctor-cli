import { Pool } from 'pg';

export type Severity = 'ok' | 'info' | 'warning' | 'critical';

export interface CheckOptions {
  longQuerySeconds: number;
  bloatWarnPct: number;
  bloatCriticalPct: number;
  bloatMinBytes: number;
  connWarnPct: number;
  connCriticalPct: number;
  statementTimeoutMs: number;
}

export interface TableColumn {
  header: string;
  key: string;
}

export interface CheckResult {
  id: string;
  title: string;
  severity: Severity;
  summary: string;
  recommendation?: string;
  columns?: TableColumn[];
  rows?: Record<string, unknown>[];
  error?: string;
}

export interface Check {
  id: string;
  title: string;
  run(pool: Pool, options: CheckOptions): Promise<CheckResult>;
}

export interface ConnectionProfile {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
}

export interface PgDoctorConfig {
  profiles: Record<string, ConnectionProfile>;
}
