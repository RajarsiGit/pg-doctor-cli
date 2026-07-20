import chalk from 'chalk';
import Table from 'cli-table3';
import { CheckResult, Severity } from '../types';

const SEVERITY_STYLE: Record<Severity, { label: string; color: (s: string) => string }> = {
  ok: { label: 'OK', color: chalk.green },
  info: { label: 'INFO', color: chalk.cyan },
  warning: { label: 'WARN', color: chalk.yellow },
  critical: { label: 'CRIT', color: chalk.red },
};

export function renderTerminalReport(results: CheckResult[], targetLabel: string): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`\npg-doctor report — ${targetLabel}`));
  lines.push(chalk.dim(new Date().toISOString()));
  lines.push('');

  for (const result of results) {
    const style = SEVERITY_STYLE[result.severity];
    lines.push(`${style.color(chalk.bold(`[${style.label}]`))} ${chalk.bold(result.title)}`);
    lines.push(`  ${result.summary}`);

    if (result.error) {
      lines.push(chalk.red(`  Error: ${result.error}`));
    }

    if (result.rows && result.rows.length > 0 && result.columns) {
      const table = new Table({
        head: result.columns.map((c) => chalk.bold(c.header)),
        style: { head: [], border: [] },
      });
      for (const row of result.rows) {
        table.push(result.columns.map((c) => String(row[c.key] ?? '')));
      }
      lines.push(table.toString());
    }

    if (result.recommendation) {
      lines.push(chalk.dim(`  → ${result.recommendation}`));
    }

    lines.push('');
  }

  const counts = tally(results);
  lines.push(
    chalk.bold('Summary: ') +
      `${chalk.green(`${counts.ok} ok`)}, ${chalk.yellow(`${counts.warning} warning`)}, ${chalk.red(
        `${counts.critical} critical`
      )}`
  );

  return lines.join('\n');
}

function tally(results: CheckResult[]) {
  return results.reduce(
    (acc, r) => {
      acc[r.severity] = (acc[r.severity] ?? 0) + 1;
      return acc;
    },
    { ok: 0, info: 0, warning: 0, critical: 0 } as Record<Severity, number>
  );
}
