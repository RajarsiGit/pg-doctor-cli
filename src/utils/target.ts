import { PgClientConfig } from '../config';

export function describeTarget(config: PgClientConfig): string {
  if (config.connectionString) {
    try {
      const normalized = config.connectionString.replace(/^postgres:\/\//, 'postgresql://');
      const url = new URL(normalized);
      const db = url.pathname.replace(/^\//, '') || '(default)';
      return `${url.hostname}${url.port ? ':' + url.port : ''}/${db}`;
    } catch {
      return 'connection string';
    }
  }
  return `${config.host ?? 'localhost'}${config.port ? ':' + config.port : ''}/${config.database ?? '(default)'}`;
}
