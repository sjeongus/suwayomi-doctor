import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Cron } from 'croner';
import { registerApi } from './api.js';
import { loadConfig } from './config.js';
import { nowSec, openDb } from './db.js';
import { ScanlatorHints } from './mangaupdates/hints.js';
import { Scanner } from './scan/scanner.js';
import { syncLibrary } from './scan/sync.js';
import type { Settings } from './shared/api-types.js';
import { loadSettings } from './store.js';
import { SuwayomiClient } from './suwayomi/client.js';

// Outside Docker (npm run dev / npm start), read .env the way Compose does. Variables already set win.
if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const db = openDb(config.dataDir);
const client = new SuwayomiClient(config);

let settings: Settings = loadSettings(db, config.defaults);
const hints = new ScanlatorHints(db, client);
const scanner = new Scanner(db, client, config, () => settings, () => hints.fillBroken());

let job: Cron | null = null;
function schedule(): void {
  job?.stop();
  job = new Cron(settings.scanCron, { protect: true }, () => {
    console.log('[cron] starting weekly scan');
    scanner.start('cron');
  });
  const next = job.nextRun();
  console.log(`[cron] "${settings.scanCron}" next run: ${next?.toString() ?? 'never'}`);
}
schedule();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

registerApi(app, {
  db,
  config,
  client,
  scanner,
  hints,
  settings: () => settings,
  updateSettings: (patch) => {
    const cronChanged = patch.scanCron !== undefined && patch.scanCron !== settings.scanCron;
    settings = { ...settings, ...patch };
    if (cronChanged) schedule();
    return settings;
  },
  nextScanAt: () => {
    const next = job?.nextRun();
    return next ? Math.floor(next.getTime() / 1000) : null;
  },
});

app.get('/healthz', async () => ({ ok: true }));

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`Suwayomi Doctor listening on :${config.port}, watching ${config.suwayomiUrl}`);

// Mirror the library at startup so the UI has data before the first scan.
syncLibrary(db, client, { includeLocalSource: config.includeLocalSource, settings, now: nowSec() })
  .then((r) => console.log(`[sync] ${r.series} series in library`))
  .catch((err) => console.error(`[sync] initial sync failed: ${(err as Error).message}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scanner.cancel();
    job?.stop();
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
