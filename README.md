# french-stream-scraper

Scraper + interface web pour sites de streaming (développé et testé sur **french-stream.one**). À partir de l'URL d'une page film, il extrait les métadonnées (titre, description, année, genres, acteurs…), les liens des lecteurs vidéo, et résout le **flux vidéo direct** (`.m3u8` / `.mp4`) quand c'est possible.

Le projet combine quatre briques dans un seul dépôt :

| Brique | Techno | Rôle |
|---|---|---|
| **CLI** | TypeScript, Playwright, cheerio, yt-dlp | scrape une page film → JSON |
| **Serveur** | Fastify, PostgreSQL (Drizzle ORM), node-cron | API + catalogue persistant + scheduler |
| **Interface web** | React 19, Vite, Tailwind 4, hls.js | scraping en un clic, catalogue, lecteur vidéo |
| **Crawler** | pool de workers Playwright | découverte + refresh automatique du catalogue |

> ⚠️ **Avertissement** — Ce projet est fourni à des fins **éducatives et techniques** (apprentissage du scraping, de Playwright, de Fastify et de Drizzle). Le scraping de sites tiers peut contrevenir à leurs conditions d'utilisation ; l'extraction de flux vidéo protégés peut être illégale selon votre juridiction. Vous êtes seul responsable de l'usage que vous en faites. Les liens directs expirent en ~12-48 h selon l'hébergeur.

## Sommaire

- [Prérequis](#prérequis)
- [Installation pas à pas](#installation-pas-à-pas)
- [Configuration (.env)](#configuration-env)
- [Démarrage](#démarrage)
- [Utilisation](#utilisation)
  - [Interface web](#interface-web)
  - [CLI](#cli)
  - [API HTTP](#api-http)
- [Scripts npm](#scripts-npm)
- [Architecture](#architecture)
- [Déploiement (systemd)](#déploiement-systemd)
- [Limites connues](#limites-connues)
- [Licence](#licence)

## Prérequis

| Outil | Version | Rôle | Obligatoire |
|---|---|---|---|
| [Node.js](https://nodejs.org) | ≥ 20 | runtime TypeScript (tsx) | ✅ |
| [PostgreSQL](https://www.postgresql.org) | ≥ 14 | catalogue, file de scrape, scheduler | ✅ |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | récent | résolution des hébergeurs propriétaires | recommandé |
| Chromium | — | installé automatiquement via Playwright | ✅ (auto) |

ffmpeg n'est pas requis (aucun remux — les flux sont relayés tels quels).

## Installation pas à pas

```bash
# 1. Cloner et installer les dépendances
git clone https://github.com/trafalgarLaw20/french-stream-scraper.git
cd french-stream-scraper
npm install

# 2. Installer le navigateur headless utilisé par le scraper
npx playwright install chromium

# 3. (Recommandé) installer yt-dlp pour la résolution des flux
brew install yt-dlp        # macOS
# ou : pip install -U yt-dlp / pipx install yt-dlp
yt-dlp --version           # vérifier

# 4. Créer la base PostgreSQL (exemple macOS/Homebrew)
createdb fss
#    — ou via psql :
#    psql -c "CREATE DATABASE fss;"

# 5. Configurer l'environnement
cp .env.example .env
#    → éditer .env : au minimum DATABASE_URL
#    (ex. local sans mot de passe : postgres://VOTRE_USER@localhost:5432/fss)

# 6. Appliquer les migrations Drizzle
npm run db:migrate

# 7. Lancer 🚀
npm run dev                # mode dev : UI sur http://localhost:5173, API sur :3000
# ou
npm run build:web && npm run ui   # mode prod locale : tout sur http://127.0.0.1:3000
```

Ouvrez ensuite l'interface : `http://127.0.0.1:3000` (ou `http://localhost:5173` en mode dev).

### Premiers pas suggérés

1. **Onglet Scraper** : collez l'URL d'une page film (ex. `https://french-stream.one/index.php?newsid=…`) → la progression s'affiche en direct (bypass Cloudflare → clic des lecteurs → résolution des flux).
2. **Onglet Admin** : lancez un job `discover` pour remplir la file d'attente, puis `metadata` puis `stream` pour peupler le catalogue.
3. **Onglet Catalogue** : parcourez les films, ouvrez une fiche, lisez un flux ou rafraîchissez les liens expirés d'un clic.

## Configuration (.env)

Copiez `.env.example` → `.env`. Variables :

| Variable | Défaut | Description |
|---|---|---|
| `DATABASE_URL` | — | Connexion PostgreSQL (obligatoire) |
| `WORKER_COUNT` | `2` | Navigateurs Playwright parallèles du crawler |
| `CRON_DISCOVER` | `0 3 * * *` | Découverte du catalogue (quotidien 3 h) |
| `CRON_METADATA` | `30 3 * * *` | Refresh métadonnées (quotidien 3 h 30) |
| `CRON_STREAM_TOP` | `0 * * * *` | Refresh flux des N plus populaires (horaire) |
| `CRON_FULL_STREAM` | `0 4 * * 6` | Refresh flux complet (samedi 4 h) |
| `STREAM_TOP_LIMIT` | `100` | N fiches populaires rafraîchies chaque heure |
| `ADMIN_API_TOKEN` | vide | Token API admin (header `X-Admin-Token`). Vide = auth désactivée |
| `HTTP_PORT` / `HTTP_HOST` | `3000` / `127.0.0.1` | Écoute du serveur HTTP |
| `DISABLE_SCHEDULER` | `0` | `1` = pas de cron au démarrage (debug) |
| `NODE_ENV` | — | `development` / `production` |

## Démarrage

```bash
npm run dev                          # dev : API :3000 + Vite hot-reload :5173
npm run build:web && npm run ui      # prod locale : build + service sur :3000
```

Le serveur sert le frontend buildé depuis `web/dist` (rebuild possible à chaud : les fichiers sont lus sur disque à chaque requête).

## Utilisation

### Interface web

Cinq onglets :

- **Scraper** — URL d'une page film → progression temps réel (SSE) → fiche complète, flux directs lisibles dans le lecteur intégré (hls.js), export JSON/CSV.
- **Batch** — plusieurs URLs d'un coup, avec délai anti-ban.
- **Catalogue** — le catalogue PostgreSQL : recherche, filtres genre/année, tri. Le détail d'un film liste ses sources ; les flux expirés sont masqués, un bouton **🔄 Rafraîchir les flux** relance la collecte pour ce film (cooldown 5 min), et l'ouverture d'une fiche dont tous les flux sont morts déclenche un rafraîchissement automatique en arrière-plan.
- **Historique** — les scrapes faits depuis l'UI (SQLite), recherche, export, suppression.
- **Admin** — état de la file, lancement des jobs (`discover`, `metadata`, `stream`, `full-stream`), historique des runs (nécessite le token admin).

### CLI

```bash
npx tsx src/cli.ts "https://french-stream.one/index.php?newsid=15126933"   # scrape complet
npx tsx src/cli.ts "<url>" --no-resolve                                    # sans résolution (rapide)
npx tsx src/cli.ts "<url>" -o result.json                                  # sortie fichier
npx tsx src/cli.ts "<url>" --headed -v                                     # navigateur visible (debug)
npx tsx src/cli.ts "<url>" -t 120000 -v                                    # timeout personnalisé
```

| Option | Description |
|---|---|
| `-o, --out <path>` | JSON dans un fichier au lieu de stdout |
| `--no-resolve` | ne pas résoudre le flux direct |
| `--headed` | navigateur visible (debug Cloudflare) |
| `--cookies <file>` | cookies Playwright (session manuelle) |
| `-t, --timeout <ms>` | timeout par page (défaut 90 000) |
| `-v, --verbose` | logs de progression sur stderr |

Sortie : JSON validé par un schéma [zod](https://zod.dev) — `titre`, `description`, `genres`, `acteurs`, `iframes[]` (`host`, `url`, `label`, `streamDirect`)…

### API HTTP

Principaux endpoints (préfixe `/api`) :

| Méthode & route | Description |
|---|---|
| `POST /api/scrape` `{url, resolveStreams?}` | lance un scrape (job SSE) |
| `GET /api/events/:jobId` | flux SSE de progression |
| `GET /api/m/movies` `?limit&cursor&q&genre&year` | catalogue paginé |
| `GET /api/m/movies/:id` · `…/streams` | fiche · sources + flux valides |
| `POST /api/m/movies/:id/refresh` · `GET` | relance/état du refresh des flux d'un film |
| `GET /api/m/genres` · `/years` · `/search?q=` | facets & recherche |
| `POST /api/admin/crawl` `{kind}` | job `discover`/`metadata`/`stream`/`full-stream` (token admin) |
| `GET /api/health` | état du serveur |

## Scripts npm

| Script | Rôle |
|---|---|
| `npm run dev` | serveur :3000 + Vite :5173 (hot reload) |
| `npm run ui` | démarre le serveur (sert `web/dist`) |
| `npm run build:web` | build le frontend React |
| `npm run scrape` | CLI de scrape |
| `npm run build` | compile le scraper → `dist/` |
| `npm run typecheck` | vérification TypeScript (projet complet) |
| `npm run db:migrate` | applique les migrations Drizzle |
| `npm run db:generate` | génère une migration depuis `pg/schema` |
| `npm run db:studio` | explorateur de base (Drizzle Studio) |
| `npm run discover` / `npm run crawl` | découverte / crawl manuels |

## Architecture

```
src/                 — cœur du scrape
├── cli.ts           — CLI (commander)
├── fetcher.ts       — Playwright stealth + contournement Cloudflare/interstitiel
├── parser.ts        — cheerio : métadonnées (JSON-LD/OG + sélecteurs thème)
├── players.ts       — clic des lecteurs (.player-option/.version-option) → iframes
├── resolver.ts      — orchestration résolution (dédup hôte+langue+chemin)
├── langue.ts        — détection VOSTFR / VF-QC / VF-FR depuis le label
├── extractors/      — yt-dlp → interception réseau → scan DOM
└── schema.ts        — schémas zod

server/src/          — Fastify : routes API, jobs SSE, refresh à la demande
web/                 — frontend React (composants, api, types)
pg/                  — schéma Drizzle + migrations + repositories
crawler/             — pool de workers + découverte du catalogue
scheduler/           — cron jobs (discover / metadata / stream-top / full-stream)
parser/              — parsing partagé films/séries (cheerio)
systemd/             — unités de déploiement Linux (+ timer backup)
tests/               — scripts de diagnostic manuels (dump HTML, players, résolution)
```

Documentation complémentaire : [`ARCHITECTURE.md`](ARCHITECTURE.md) (design détaillé) et [`OPS.md`](OPS.md) (déploiement, sauvegardes, monitoring).

## Déploiement (systemd)

Voir [`OPS.md`](OPS.md) pour le guide complet : installation sous `/opt/fss`, unités `systemd/fss.service` (serveur) et `fss-backup.timer` (dump `pg_dump` quotidien à 2 h).

## Limites connues

- **Cloudflare varie** : le contournement (stealth maison + simulation humaine) fonctionne généralement, mais peut échouer si CF renforce ses règles → `--headed` ou `--cookies`.
- **Passerelles multi-hébergeurs (kakaflix.lol → playmogo.com…)** : protégées par un challenge Cloudflare gourmand, ces sources restent souvent non résolues ; l'URL d'iframe est néanmoins conservée.
- **Lecture de certains flux (vidzy)** : le CDN lie le token du flux à l'User-Agent qui l'a généré — la lecture directe dans un navigateur peut être bloquée (son sans image / 403) alors que le lien est valide. Un lien de secours « ouvrir dans un onglet » est proposé sous le lecteur.
- **Séries** : métadonnées et épisodes scrapés, mais la résolution des flux **par épisode** n'est pas encore implémentée.
- **Expiration** : les liens `.m3u8` expirent en ~12 h (uqload) à ~48 h (vidzy) → utiliser le refresh à la demande ou le cron horaire.
- **DRM Widevine / contenus payants** : sans clés de déchiffrement, `streamDirect` reste `null`.

## Licence

[MIT](LICENSE) — usage à vos risques et périls, voir l'avertissement en tête de README.
