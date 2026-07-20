import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConnectionProfile, PgDoctorConfig } from './types';

const CONFIG_FILENAME = '.pgdoctorrc.json';

export interface ResolveConnectionArgs {
  connectionString?: string;
  profile?: string;
  configPath?: string;
  ssl?: boolean;
  noSslVerify?: boolean;
}

function readConfigFile(filePath: string): PgDoctorConfig | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return parsed as PgDoctorConfig;
  } catch (err) {
    throw new Error(`Failed to parse config file at ${filePath}: ${(err as Error).message}`);
  }
}

function loadConfig(explicitPath?: string): PgDoctorConfig | undefined {
  if (explicitPath) {
    return readConfigFile(path.resolve(explicitPath));
  }
  const cwdConfig = path.resolve(process.cwd(), CONFIG_FILENAME);
  const homeConfig = path.join(os.homedir(), CONFIG_FILENAME);
  return readConfigFile(cwdConfig) ?? readConfigFile(homeConfig);
}

function profileToPgConfig(profile: ConnectionProfile) {
  if (profile.connectionString) {
    return { connectionString: profile.connectionString, ssl: profile.ssl };
  }
  return {
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: profile.password,
    ssl: profile.ssl,
  };
}

function envConnectionConfig() {
  const { DATABASE_URL, PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } = process.env;
  if (DATABASE_URL) {
    return { connectionString: DATABASE_URL };
  }
  if (PGHOST || PGDATABASE || PGUSER) {
    return {
      host: PGHOST,
      port: PGPORT ? Number(PGPORT) : undefined,
      database: PGDATABASE,
      user: PGUSER,
      password: PGPASSWORD,
    };
  }
  return undefined;
}

export interface PgClientConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  statement_timeout?: number;
  connectionTimeoutMillis?: number;
}

export function resolveConnection(args: ResolveConnectionArgs, statementTimeoutMs: number): PgClientConfig {
  let base: PgClientConfig | undefined;

  if (args.connectionString) {
    base = { connectionString: args.connectionString };
  } else {
    const config = loadConfig(args.configPath);
    const profileName = args.profile ?? 'default';
    const profile = config?.profiles?.[profileName];

    if (profile) {
      base = profileToPgConfig(profile);
    } else if (args.profile) {
      throw new Error(
        `Profile "${args.profile}" not found in config file. Available profiles: ${
          config ? Object.keys(config.profiles ?? {}).join(', ') || '(none)' : '(no config file found)'
        }`
      );
    } else {
      base = envConnectionConfig();
    }
  }

  if (!base) {
    throw new Error(
      'No Postgres connection info found. Pass --connection-string, set DATABASE_URL / PGHOST+PGUSER+PGDATABASE, ' +
        'or define a profile in .pgdoctorrc.json.'
    );
  }

  if (args.noSslVerify) {
    base.ssl = { rejectUnauthorized: false };
  } else if (args.ssl) {
    base.ssl = true;
  }

  return {
    ...base,
    statement_timeout: statementTimeoutMs,
    connectionTimeoutMillis: statementTimeoutMs,
  };
}
