export type AuthMode = 'none' | 'basic_auth' | 'simple_login' | 'ui_login';

export interface Config {
  port: number;
  dataDir: string;
  suwayomiUrl: string;
  suwayomiPublicUrl: string;
  authMode: AuthMode;
  username: string;
  password: string;
  /** Defaults for settings the UI can override (stored in the settings table). */
  defaults: {
    scanCron: string;
    staleDays: number;
    sourceConcurrency: number;
    delayMs: number;
  };
  includeLocalSource: boolean;
  refreshTimeoutMs: number;
}

const AUTH_MODES: AuthMode[] = ['none', 'basic_auth', 'simple_login', 'ui_login'];

function int(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return Math.floor(n);
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const suwayomiUrl = stripSlash(env.SUWAYOMI_URL ?? 'http://localhost:4567');
  const authMode = (env.SUWAYOMI_AUTH_MODE ?? 'none').toLowerCase() as AuthMode;
  if (!AUTH_MODES.includes(authMode)) {
    throw new Error(`SUWAYOMI_AUTH_MODE must be one of ${AUTH_MODES.join(', ')}, got "${authMode}"`);
  }
  return {
    port: int('PORT', 8080, env),
    dataDir: env.DATA_DIR ?? './data',
    suwayomiUrl,
    suwayomiPublicUrl: stripSlash(env.SUWAYOMI_PUBLIC_URL || suwayomiUrl),
    authMode,
    username: env.SUWAYOMI_USERNAME ?? '',
    password: env.SUWAYOMI_PASSWORD ?? '',
    defaults: {
      scanCron: env.SCAN_CRON || '0 4 * * 0',
      staleDays: int('STALE_DAYS', 90, env),
      sourceConcurrency: Math.max(1, int('SOURCE_CONCURRENCY', 3, env)),
      delayMs: int('REQUEST_DELAY_MS', 2000, env),
    },
    includeLocalSource: env.INCLUDE_LOCAL_SOURCE === 'true',
    refreshTimeoutMs: int('REFRESH_TIMEOUT_MS', 120_000, env),
  };
}
