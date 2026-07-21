import { describe, expect, it } from 'vitest';
import { describeTarget } from './target';

describe('describeTarget', () => {
  it('formats a connection string target', () => {
    expect(describeTarget({ connectionString: 'postgres://user:pass@db.example.com:6543/mydb' })).toBe(
      'db.example.com:6543/mydb',
    );
  });

  it('defaults the database name when the connection string has none', () => {
    expect(describeTarget({ connectionString: 'postgres://db.example.com:5432/' })).toBe(
      'db.example.com:5432/(default)',
    );
  });

  it('falls back to "connection string" when parsing fails', () => {
    expect(describeTarget({ connectionString: 'not-a-valid-url' })).toBe('connection string');
  });

  it('formats discrete host/port/database fields', () => {
    expect(describeTarget({ host: 'db.internal', port: 5432, database: 'analytics' })).toBe(
      'db.internal:5432/analytics',
    );
  });

  it('defaults host, omits port, and defaults database when unset', () => {
    expect(describeTarget({})).toBe('localhost/(default)');
  });
});
