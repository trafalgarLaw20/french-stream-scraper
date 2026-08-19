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

Fonctionne sur **macOS, Linux et Windows**. Les étapes 1, 2, 6 et 7 sont identiques partout ; les étapes 3 à 5 (yt-dlp, PostgreSQL, configuration) sont détaillées par plateforme.

> 💡 **Utilisateurs Windows** : vous pouvez suivre ce guide directement sous Windows (PowerShell) — ou via [WSL2](https://learn.microsoft.com/windows/wsl/install) où les instructions Linux s'appliquent telles quelles. Les commandes shell ci-dessous sont en syntaxe Unix ; l'équivalent PowerShell est indiqué quand il diffère (`cp` → `copy`, etc.).

### 1. Cloner et installer les dépendances (toutes plateformes)

```bash
git clone https://github.com/trafalgarLaw20/french-stream-scraper.git
cd french-stream-scraper
npm install
```

### 2. Installer le navigateur du scraper (toutes plateformes)

```bash
npx playwright install chromium
```

**Linux uniquement** — si Chromium ne se lance pas au premier scrape, installez les bibliothèques système (une seule fois, peut nécessiter sudo) :

```bash
# Debian/Ubuntu (automatique) :
npx playwright install-deps chromium

# Arch Linux & dérivées (pacman — npx playwright install-deps ne gère pas pacman) :
sudo pacman -S --needed nss atk at-spi2-atk cups libdrm libxkbcommon \
  libxcomposite libxdamage libxfixes libxrandr mesa alsa-lib pango cairo

# équivalent manuel (Debian/Ubuntu) :
# sudo apt install libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
#   libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
#   libgbm1 libasound2 libpango-1.0-0 libcairo2
```

### 3. Installer yt-dlp (recommandé)

C'est le seul moyen fiable de résoudre les hébergeurs propriétaires (Dood, Voe…). Sans lui, le scraper replie sur l'interception réseau (couverture plus faible).

| Plateforme | Commande |
|---|---|
| **macOS** | `brew install yt-dlp` |
| **Linux (Debian/Ubuntu)** | `sudo apt install yt-dlp` *(si le paquet est ancien, préférez pip)* |
| **Linux (Arch & dérivées — Manjaro, EndeavourOS, Garuda…)** | `sudo pacman -S yt-dlp` |
| **Linux (Fedora/RHEL)** | `sudo dnf install yt-dlp` |
| **Linux (universel)** | `pipx install yt-dlp` ou `python3 -m pip install --user yt-dlp` |
| **Windows (PowerShell)** | `winget install yt-dlp.yt-dlp` — ou téléchargez [`yt-dlp.exe`](https://github.com/yt-dlp/yt-dlp/releases/latest) et placez-le dans le `PATH` |

Vérifier ensuite : `yt-dlp --version` (doit afficher un numéro de version depuis n'importe quel terminal).

### 4. Installer PostgreSQL et créer la base

**macOS (Homebrew)** :

```bash
brew install postgresql@16
brew services start postgresql@16
createdb fss
```

**Linux (Debian/Ubuntu)** :

```bash
sudo apt install postgresql
sudo systemctl enable --now postgresql
sudo -u postgres createdb fss
# autoriser votre utilisateur Linux sur la base (auth peer) :
sudo -u postgres psql -c "CREATE ROLE \"$USER\" LOGIN;" 2>/dev/null || true
```

**Linux (Arch & dérivées — Manjaro, EndeavourOS…)** :

```bash
sudo pacman -S postgresql
# Sur Arch, la base doit être initialisée avant le premier démarrage :
sudo -u postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
sudo -u postgres createdb fss
# autoriser votre utilisateur Linux sur la base (auth peer) :
sudo -u postgres psql -c "CREATE ROLE \"$USER\" LOGIN;" 2>/dev/null || true
```

**Windows** :

1. Installez PostgreSQL via [l'installateur officiel](https://www.postgresql.org/download/windows/) (EDB) — notez le mot de passe du superutilisateur `postgres` choisi pendant l'installation.
2. Ouvrez **SQL Shell (psql)** (menu Démarrer) ou mettez `C:\Program Files\PostgreSQL\16\bin` dans le `PATH`, puis :

```powershell
psql -U postgres -c "CREATE DATABASE fss;"
```

### 5. Configurer l'environnement

```bash
cp .env.example .env        # macOS / Linux
copy .env.example .env      # Windows (PowerShell)
```

Éditez `.env` — au minimum `DATABASE_URL` :

| Plateforme | Exemple de DATABASE_URL |
|---|---|
| macOS (Homebrew) | `postgres://VOTRE_USER_MAC@localhost:5432/fss` — votre nom d'utilisateur macOS (`whoami`), généralement sans mot de passe |
| Linux (Debian/Ubuntu/Arch — auth peer) | `postgres://VOTRE_USER_LINUX@localhost:5432/fss` (souvent sans mot de passe en local) |
| Windows | `postgres://postgres:VOTRE_MOT_DE_PASSE@localhost:5432/fss` — le mot de passe choisi pendant l'installateur PostgreSQL |

### 6. Appliquer les migrations Drizzle (toutes plateformes)

```bash
npm run db:migrate
```

### 7. Lancer 🚀

```bash
npm run dev                              # mode dev : UI sur http://localhost:5173, API sur :3000
# ou
npm run build:web && npm run ui          # mode prod locale : tout sur http://127.0.0.1:3000
```

Ouvrez ensuite l'interface : `http://127.0.0.1:3000` (ou `http://localhost:5173` en mode dev).

> **Note Windows** : le projet dépend de `better-sqlite3` (historique UI) — des binaires précompilés sont fournis pour Windows, aucune toolchain C++ n'est normalement nécessaire. Si `npm install` échoue sur ce module, installez [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (charge de travail « Desktop development with C++ ») puis relancez `npm install`.

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
