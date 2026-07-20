import { Check } from '../types';
import { bloatCheck } from './bloat';
import { connectionSaturationCheck } from './connectionSaturation';
import { lockChainsCheck } from './lockChains';
import { longRunningQueriesCheck } from './longRunningQueries';
import { replicationLagCheck } from './replicationLag';

export const allChecks: Check[] = [
  connectionSaturationCheck,
  longRunningQueriesCheck,
  lockChainsCheck,
  bloatCheck,
  replicationLagCheck,
];

export function selectChecks(only?: string[], skip?: string[]): Check[] {
  let checks = allChecks;
  if (only && only.length > 0) {
    const invalid = only.filter((id) => !allChecks.some((c) => c.id === id));
    if (invalid.length > 0) {
      throw new Error(`Unknown check id(s): ${invalid.join(', ')}. Run "pg-doctor list" to see valid ids.`);
    }
    checks = checks.filter((c) => only.includes(c.id));
  }
  if (skip && skip.length > 0) {
    checks = checks.filter((c) => !skip.includes(c.id));
  }
  return checks;
}
