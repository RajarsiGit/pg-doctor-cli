import chalk from 'chalk';
import { Command } from 'commander';
import * as fs from 'fs';
import ora from 'ora';
import { Pool } from 'pg';
import { allChecks, selectChecks } from './checks';
import { resolveConnection } from './config';
import { renderMarkdownReport } from './report/markdown';
import { renderTerminalReport } from './report/terminal';
import { runChecks, exitCodeFor } from './runner';
import { CheckOptions } from './types';
import { describeTarget } from './utils/target';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json');

const program = new Command();

program
  .name('pg-doctor')
  .description('Portable Postgres diagnostics: bloat, long-running queries, locks, connections, replication lag.')
  .version(pkg.version);

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function commonOptions(cmd: Command): Command {
  return cmd
    .option('-c, --connection-string <string>', 'Postgres connection string (or set DATABASE_URL / PG* env vars)')
    .option('-p, --profile <name>', 'Named profile from .pgdoctorrc.json (default: "default" if a config file exists)')
    .option('--config <path>', 'Path to a .pgdoctorrc.json config file')
    .option('-f, --format <format>', 'Output format: terminal | markdown', 'terminal')
    .option('-o, --output <file>', 'Write report to a file instead of stdout')
    .option('--only <ids>', 'Comma-separated check ids to run (see "pg-doctor list")')
    .option('--skip <ids>', 'Comma-separated check ids to skip')
    .option('--long-query-seconds <n>', 'Threshold for long-running queries', '300')
    .option('--bloat-warn-pct <n>', 'Dead-tuple percentage that triggers a bloat warning', '20')
    .option('--bloat-critical-pct <n>', 'Dead-tuple percentage that triggers a critical bloat flag', '40')
    .option('--bloat-min-bytes <n>', 'Ignore tables smaller than this many bytes for bloat checks', String(10 * 1024 * 1024))
    .option('--conn-warn-pct <n>', 'Connection usage percentage that triggers a warning', '75')
    .option('--conn-critical-pct <n>', 'Connection usage percentage that triggers a critical flag', '90')
    .option('--timeout <ms>', 'Connect and statement timeout in ms', '10000')
    .option('--ssl', 'Connect using SSL')
    .option('--insecure', 'Connect using SSL without verifying the server certificate')
    .option('--strict', 'Exit with a non-zero code on warnings too, not just critical findings');
}

async function runCheckCommand(opts: Record<string, any>) {
  const timeoutMs = Number(opts.timeout);
  let pool: Pool | undefined;

  try {
    const connectionConfig = resolveConnection(
      {
        connectionString: opts.connectionString,
        profile: opts.profile,
        configPath: opts.config,
        ssl: opts.ssl,
        noSslVerify: opts.insecure,
      },
      timeoutMs
    );

    const checks = selectChecks(parseList(opts.only), parseList(opts.skip));

    const checkOptions: CheckOptions = {
      longQuerySeconds: Number(opts.longQuerySeconds),
      bloatWarnPct: Number(opts.bloatWarnPct),
      bloatCriticalPct: Number(opts.bloatCriticalPct),
      bloatMinBytes: Number(opts.bloatMinBytes),
      connWarnPct: Number(opts.connWarnPct),
      connCriticalPct: Number(opts.connCriticalPct),
      statementTimeoutMs: timeoutMs,
    };

    const target = describeTarget(connectionConfig);
    const spinner = ora(`Connecting to ${target}...`).start();

    pool = new Pool(connectionConfig);
    pool.on('error', (err) => {
      spinner.warn(`Idle client error: ${err.message}`);
    });

    // Fail fast with a clear message if we can't connect at all.
    await pool.query('SELECT 1');
    spinner.text = `Running ${checks.length} check(s) against ${target}...`;

    const results = await runChecks(pool, checks, checkOptions);
    spinner.stop();

    const output =
      opts.format === 'markdown' ? renderMarkdownReport(results, target) : renderTerminalReport(results, target);

    if (opts.output) {
      fs.writeFileSync(opts.output, output + '\n', 'utf-8');
      console.log(`Report written to ${opts.output}`);
    } else {
      console.log(output);
    }

    process.exitCode = exitCodeFor(results, Boolean(opts.strict));
  } catch (err) {
    console.error(chalk.red(`pg-doctor: ${(err as Error).message}`));
    process.exitCode = 3;
  } finally {
    if (pool) await pool.end().catch(() => undefined);
  }
}

commonOptions(program.command('check', { isDefault: true }).description('Run diagnostic checks against a Postgres instance')).action(
  runCheckCommand
);

program
  .command('list')
  .description('List available diagnostic checks')
  .action(() => {
    console.log('Available checks:\n');
    for (const check of allChecks) {
      console.log(`  ${chalk.bold(check.id.padEnd(14))} ${check.title}`);
    }
  });

program.parseAsync(process.argv);
