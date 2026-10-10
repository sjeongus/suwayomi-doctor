# Suwayomi Doctor

A sidecar for [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server). It checks every series in your library on a schedule (weekly by default) and lists the ones whose source is broken or unsupported. Each flagged series links straight to its page in Suwayomi, where Migrate is one click away. Doctor never migrates anything itself.

It talks to Suwayomi only through its GraphQL API, and it never touches Suwayomi's database files.

## Run it

Doctor reads its settings from a `.env` file. Start from the example, which explains each value:

```sh
cp .env.example .env
```

At minimum, set `SUWAYOMI_URL` to an address where Doctor can reach Suwayomi, and `SUWAYOMI_PUBLIC_URL` to the one your browser uses. `.env` is git-ignored, so your addresses and passwords stay out of the repository.

### With Docker Compose

There is one compose file, [`docker-compose.yml`](docker-compose.yml). It runs the published image from GitHub Container Registry by default:

```sh
docker compose up -d            # pull and run the published image
docker compose up -d --build    # or build it from this folder
```

Then open `http://<host>:4568`. Doctor keeps `doctor.db` in a Docker volume unless `DOCTOR_DATA` names a folder. It needs no access to Suwayomi's data folder.

If Suwayomi runs in Docker on the same host, the easiest way to connect is to put Doctor on Suwayomi's network and use its container name in `SUWAYOMI_URL`. The compose file has a commented-out `networks` block (and Traefik labels, if you use Traefik) to uncomment for that.

### On a NAS (Synology with Arcane, Portainer or similar)

1. **Create the project folder**, for example `/volume1/docker/suwayomi-doctor`, with an empty `data` folder inside.
2. **Add the two files.** Copy [`docker-compose.yml`](docker-compose.yml) into it as `compose.yaml` and delete its `build: .` line, since the NAS only pulls the image. Put a `.env` beside it, made from `.env.example`, with `DOCTOR_DATA=/volume1/docker/suwayomi-doctor/data` and `PUID`/`PGID` set to the folder's owner (`id` over SSH shows yours). Arcane names a project after its folder, so it shows up as **suwayomi-doctor**.
3. **Deploy** from the UI and open `http://<nas>:4568`.

**Updating:** pull the new image and redeploy the project from the UI. Your data folder is kept.

**Moving an existing database:** stop the old Doctor, copy `doctor.db` out of it (for example `docker cp suwayomi-doctor:/data/doctor.db .`), and put it in the new data folder before the first start. Doctor closes the database cleanly when it stops, so `doctor.db` alone holds everything.

### Publishing your own image

The [Docker image workflow](.github/workflows/docker.yml) runs the tests, builds the image for Intel and ARM, and publishes it as `ghcr.io/<github-user>/<repo>:latest` on every push to `main`. In a fork, set `DOCTOR_IMAGE` in `.env` to your own image. If the repository is private, make the package public (your GitHub profile → Packages → Package settings), or run `docker login ghcr.io` where Doctor runs.

### Without Docker

Needs Node.js 22.13 or newer.

```sh
npm ci
npm run build
npm start
```

`npm start` reads `.env` from the current folder and serves on port 8080 by default.

## Configuration

Every setting is an environment variable; [`.env.example`](.env.example) lists them all with explanations.

| Variable | Default | What it does |
|---|---|---|
| `SUWAYOMI_URL` | `http://localhost:4567` | How Doctor reaches Suwayomi |
| `SUWAYOMI_PUBLIC_URL` | same as `SUWAYOMI_URL` | The base address your browser uses for Suwayomi. The "Migrate in Suwayomi" links point here. |
| `SUWAYOMI_AUTH_MODE` | `none` | `none`, `basic_auth`, `simple_login` or `ui_login`, matching Suwayomi's `AUTH_MODE` |
| `SUWAYOMI_USERNAME` / `SUWAYOMI_PASSWORD` | | Only needed when auth is on |
| `SCAN_CRON` | `0 4 * * 0` | Default scan schedule (Sundays at 04:00, in `TZ`) |
| `STALE_DAYS` | `90` | Default number of days with no new chapter before an ongoing series is called stale |
| `SOURCE_CONCURRENCY` | `3` | Default number of sources checked in parallel. Each source is still checked one series at a time. |
| `REQUEST_DELAY_MS` | `2000` | Default pause between two series on the same source |
| `REFRESH_TIMEOUT_MS` | `120000` | How long to wait for a single refresh |
| `INCLUDE_LOCAL_SOURCE` | `false` | Also check series from Suwayomi's Local source |
| `DOCTOR_IMAGE` | `ghcr.io/sjeongus/suwayomi-doctor:latest` | Image Docker Compose runs |
| `TZ` | `UTC` | Time zone for the schedule |
| `DOCTOR_PORT` | `4568` | Port Docker publishes Doctor on |
| `DOCTOR_DATA` | `doctor-data` | Docker volume or host folder for `doctor.db` |
| `PUID` / `PGID` | `1000` | User and group Doctor runs as in Docker; match the owner of a host data folder |
| `PORT` / `DATA_DIR` | `8080` / `/data` | Where the server listens, and where `doctor.db` lives (inside the container) |

The schedule, stale days, concurrency and delay can also be changed in the UI under Settings. Values saved there override the environment.

Doctor also talks to two public services, both without an account: [MangaUpdates](https://www.mangaupdates.com) for scanlator hints and [AniList](https://anilist.co) for matching titles in Mihon backups.

## What it checks

| | Check | Turns broken when |
|---|---|---|
| A1 | Source can't be loaded (extension uninstalled, or the source removed from it) | Immediately |
| A2 | Extension removed from your repo (unsupported) | Immediately |
| A3 | Extension has an update | Never; this is a warning |
| B1 | Site says "not found" (HTTP 404 or 410) | On 2 scans in a row |
| B2 | Site blocks the request (403, 429, 503, Cloudflare) | On 3 scans in a row |
| B3 | Any other refresh error (parse error, timeout…) | On 2 scans in a row |
| B4 | Source lists no chapters | Immediately, if it used to list some |
| B5 | Chapter count dropped by half | Never; this is a warning |
| C1 | Ongoing series with no new chapter in `STALE_DAYS` | Never; this is a warning |

If most series on one source fail in the same scan, Doctor treats it as a site outage. Those series stay at warning until the source fails the same way on a second scan, and the page shows one banner for the whole source.

**Every scan refreshes each series in Suwayomi.** This is the same thing Suwayomi's own library update does, so if auto-download is on, any new chapters a scan finds get queued. Scans wait for Suwayomi's library update to finish if it's running. Ignored series and series on a missing source are not refreshed.

**Where to migrate.** For a broken series, Doctor looks up the series on MangaUpdates and lists the groups behind its latest releases, with links to their sites. That tells you which extension to add in Suwayomi before migrating. Broken series are looked up after each scan; any series can be looked up from its details panel. A MangaUpdates tracker on the series in Suwayomi makes the match exact; otherwise Doctor matches by title.

When a series leaves your library (for example after you migrate it), Doctor marks it **Resolved**. The **Sync** button in the header picks up changes like that right away: it re-reads your library from Suwayomi without contacting any source, so it takes seconds. Doctor also syncs on its own when you open the page.

The trash button removes a series from your Suwayomi library without migrating it. Tap it twice to confirm. Suwayomi keeps the series' downloads and read progress, so adding it back later restores everything.

## Cleaning up Mihon

Mihon's Suwayomi extension keeps its own copy of every series you add, so series you remove or migrate on the server stay in Mihon's library. Click the phone icon in Doctor's header and choose a Mihon backup (More → Settings → Data and storage → Create backup). Doctor lists the Suwayomi-extension entries that are no longer in your Suwayomi library, so you can remove them in Mihon. Entries from every other source are ignored. Doctor reads the backup in memory, keeps nothing, and changes nothing in Mihon or Suwayomi.

When an entry's title differs from the server's title for the same series, Doctor looks for something linking them: the same tracker entry, a close title, a title listed in the description, or the same author. If nothing does, it looks both titles up on AniList (no account needed), which lists a series' romaji, English, Japanese, Korean and Chinese titles together. Only those unmatched titles are sent, and you can turn the lookup off in the dialog. Anything still unmatched is listed under **Check these by hand**.

## Development

Needs Node 22.13 or newer. Doctor uses the built-in `node:sqlite`, so there are no native modules.

```sh
npm install
npm run dev:server   # API on :8080 (reads .env)
npm run dev:web      # UI on :5173, proxies /api to :8080
npm test             # health rules, scanner, Mihon, AniList and MangaUpdates tests
npm run typecheck
npm run build && npm start
```

Layout:

- `server/health/` holds the pure health rules and the error classifier.
- `server/scan/` holds the library sync, the scanner and the evaluation.
- `server/suwayomi/` holds the GraphQL client and queries.
- `server/mihon/` reads Mihon backups, finds orphaned Suwayomi entries and matches titles (locally and on AniList).
- `server/mangaupdates/` looks up who scanlates a series now.
- `server/api.ts` holds the REST and SSE endpoints the UI uses.
- `web/src/` holds the React UI. The series list is virtualized (`SeriesGrid.tsx`), so only cards near the screen are rendered.
