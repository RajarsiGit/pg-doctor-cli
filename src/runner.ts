import { Pool } from 'pg';
import { Check, CheckOptions, CheckResult } from './types';

export async function runChecks(pool: Pool, checks: Check[], options: CheckOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      const result = await check.run(pool, options);
      results.push(result);
    } catch (err) {
      results.push({
        id: check.id,
        title: check.title,
        severity: 'critical',
        summary: 'Check failed to run',
        error: (err as Error).message,
      });
    }
  }
  return results;
}

export function exitCodeFor(results: CheckResult[], strict: boolean): number {
  const hasCritical = results.some((r) => r.severity === 'critical');
  const hasWarning = results.some((r) => r.severity === 'warning');
  if (hasCritical) return 2;
  if (hasWarning && strict) return 1;
  return 0;
}
