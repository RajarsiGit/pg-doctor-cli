import { CheckResult, Severity } from '../types';

const SEVERITY_BADGE: Record<Severity, string> = {
  ok: '✅ OK',
  info: 'ℹ️ INFO',
  warning: '⚠️ WARNING',
  critical: '🛑 CRITICAL',
};

export function renderMarkdownReport(results: CheckResult[], targetLabel: string): string {
  const lines: string[] = [];

  lines.push(`# pg-doctor report — ${targetLabel}`);
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Check | Status | Summary |');
  lines.push('|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.title} | ${SEVERITY_BADGE[r.severity]} | ${escapeCell(r.summary)} |`);
  }
  lines.push('');

  for (const result of results) {
    lines.push(`## ${result.title}`);
    lines.push('');
    lines.push(`**Status:** ${SEVERITY_BADGE[result.severity]}`);
    lines.push('');
    lines.push(result.summary);
    lines.push('');

    if (result.error) {
      lines.push(`> Error: ${result.error}`);
      lines.push('');
    }

    if (result.rows && result.rows.length > 0 && result.columns) {
      lines.push(`| ${result.columns.map((c) => c.header).join(' | ')} |`);
      lines.push(`| ${result.columns.map(() => '---').join(' | ')} |`);
      for (const row of result.rows) {
        lines.push(`| ${result.columns.map((c) => escapeCell(String(row[c.key] ?? ''))).join(' | ')} |`);
      }
      lines.push('');
    }

    if (result.recommendation) {
      lines.push(`**Recommendation:** ${result.recommendation}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
