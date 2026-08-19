# Architecture — French Stream Scraper

Document de référence décrivant l'architecture cible du système de scraping
automatisé, stockage PostgreSQL et exposition API REST pour application mobile.

## 1. Vision d'ensemble

Le système scrape quotidiennement l'intégralité du catalogue de
`french-stream.one` (films + séries + épisodes), stocke les métadonnées et les
flux vidéo dans PostgreSQL, et expose une API REST consommée par une application
mobile Expo / React Native séparée.

### Principes

- **Réutilisation du code existant** : `src/scrapeMovie()` (Playwright + stealth)
  reste le cœur du scrape 1-URL. Le crawler n'est qu'un wrapper qui orchestre.
- **Séparation des préoccupations** : scraper (backend Fastify) ≠ app mobile
  (repo Expo séparé). Communication exclusivement via REST JSON.
- **Persistance normalisée** : PostgreSQL avec schéma relationnel (Drizzle ORM),
  pas de blob JSON opaque.
- **Robustesse Cloudflare** : Playwright reste l'outil principal pour le bypass
  CF, le clic des lecteurs et la résolution des flux directs.

## 2. Composants

```
┌─────────────────────────────────────────────────────────────┐
│  Daemon systemd : app web "scraper" (Fastify)                │
│                                                               │
│   ┌───────────────┐  ┌───────────────┐  ┌────────────────┐   │
│   │  UI admin     │  │  REST /api/m  │  │  Admin /api    │   │
│   │  (React+Vite) │  │  (pour Expo)  │  │  (runs, crawl) │   │
│   └───────────────┘  └───────────────┘  └────────────────┘   │
│                                                               │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  Scheduler (node-cron intégré)                       │   │
│   │   • 03h00 discover                                   │   │
│   │   • 03h30 metadata                                   │   │
│   │   • */1h stream-top-100                              │   │
│   │   • sam 04h00 full-stream                            │   │
│   └──────────────┬──────────────────────────────────────┘   │
│                  │ enfile                                    │
│                  ▼                                            │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  Crawler (pool de P=2 workers Playwright)            │   │
│   │   - bouclent sur url_queue (FOR UPDATE SKIP LOCKED)  │   │
│   │   - modes : discover / metadata / full               │   │
│   │   - réutilise src/scrapeMovie() + nouveau scrapeSeries│   │
│   └──────────────┬──────────────────────────────────────┘   │
│                  │ upsert                                     │
│                  ▼                                            │
│             PostgreSQL 16 (Drizzle ORM)                       │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ HTTPS + JSON
                          │
┌─────────────────────────────────────────────────────────────┐
│  App perso mobile (Expo / React Native) — repo séparé        │
│   └─ Lit uniquement via REST, n'écrit jamais dans la DB      │
└─────────────────────────────────────────────────────────────┘
```

## 3. Stack technique

| Bloc | Techno | Rôle |
|---|---|---|
| Runtime | Node.js 20+ | Process unique |
| Web framework | Fastify (existant) | UI admin + API REST |
| Frontend admin | React 19 + Vite + Tailwind (existant) | Scraper / Batch / Historique |
| Scraping | `playwright-extra` + `puppeteer-extra-plugin-stealth` | Bypass CF, clics, intercept réseau |
| HTML parsing | cheerio | Extraction métadonnées |
| DB | PostgreSQL 16 | Persistance normalisée |
| ORM | Drizzle ORM + drizzle-kit | Schemas typés + migrations |
| Validation | zod | Schémas entrants/sortants |
| Scheduler | node-cron | Jobs quotidiens / horaires |
| Déploiement | systemd | Daemon Linux |
| Logs | pino (via Fastify) | Structurés vers journald |

## 4. Schéma PostgreSQL (résumé)

### Entités principales

- `movies` — fiche film, métadonnées + FTS vector
- `series` — fiche série
- `seasons` — saisons d'une série
- `episodes` — épisodes d'une saison

### Référentiels

- `actors`, `directors`, `genres`, `countries`
- Tables N-N : `movie_actors`, `movie_directors`, `movie_genres`,
  `movie_countries`, `series_genres`, `series_actors`, `series_creators`

### Streams (polymorphes sur movies + episodes)

- `stream_sources` — URLs iframe stables (`entity_kind`, `entity_id`)
- `stream_direct` — `.m3u8` / `.mp4` résolus, avec `expires_at`

### Files de travail

- `url_queue` — URLs à scraper (status : pending / running / done / error / stale)
- `scrape_runs` — audit des runs (discover / metadata / stream)

### Index clés

- `movies(fts)` GIN pour full-text search
- `movies(annee)`, `movies(titre)`
- `stream_direct(source_id) WHERE valid` — seuls les streams non expirés
- `url_queue(status)` — claim rapide par workers

Détail SQL complet dans `pg/schema/`.

## 5. Workflow de scraping

### Phase 1 — Découverte (`discover`)

1. Essayer `https://french-stream.one/sitemap.xml` et `sitemap_index.xml`
2. Si absent/incomplet, parcourir les pages paginées :
   - `/films/page/N` jusqu'à page vide
   - `/series/page/N` idem
   - `/genre/<g>/page/N` pour chaque genre
3. Sélecteur (à valider sur le site) : probablement `.movie-item a` ou `.poster a`
4. Upsert dans `url_queue` avec `kind` deviné depuis le path

### Phase 2 — Métadonnées (`metadata`)

- Workers prennent les URLs `pending` ou `stale`
- Appellent `scrapeMovie()` ou `scrapeSeries()` avec `resolveStreams: false`
- Calculent `meta_hash` → skip upsert si inchangé
- Temps : ~15-30 s / fiche (CF + parse)

### Phase 3 — Résolution streams (`full` ou `stream-top`)

- Workers prennent les URLs dont `last_stream_at` est trop vieux
- Appellent `scrapeMovie()` avec `resolveStreams: true`
- Temps : ~60-90 s / fiche

### Gestion des erreurs

- Backoff exponentiel : si 3× CF détecté sur une URL → sleep 60 s, retry max 5
- Au 5ᵗʓ échec : `status=error` dans `url_queue`, on continue
- Pas de crash du pool sur erreur individuelle

## 6. Scheduler

Jobs `node-cron` intégrés au process Fastify (pas de timer systemd externe) :

| Cron | Job | Description |
|---|---|---|
| `0 3 * * *` | `discover` | Rescanne le catalogue (nouveautés) |
| `30 3 * * *` | `metadata` | Refresh meta de toutes les fiches (skip si `meta_hash` identique) |
| `0 * * * *` | `stream-top-100` | Refresh `.m3u8` des 100 fiches les plus populaires |
| `0 4 * * 6` | `full-stream` | Refresh `.m3u8` de tout le catalogue (1×/semaine) |

**Mutex** : un seul job à la fois. Si un nouveau déclenche alors que le
précédent tourne encore → log + skip.

**Déclenchement manuel** : `POST /api/admin/crawl` (protégé par token) ou
commande Ace-style : `npm run crawl -- --mode=metadata`.

## 7. API REST pour mobile

End-points légers optimisés Expo (compression gzip + ETag + cursor pagination) :

```
GET /api/m/home                    — top 20 + 6 genres + 10 nouveautés (1 seul call)
GET /api/m/movies?cursor=…&limit=20&genre=…&year=…&q=…
GET /api/m/movies/:id              — fiche détaillée (sans streams direct)
GET /api/m/movies/:id/streams      — iframes + stream_direct valides
GET /api/m/series?cursor=…
GET /api/m/series/:id              — fiche + saisons + nombres d'épisodes
GET /api/m/series/:id/seasons/:n   — liste des épisodes
GET /api/m/episodes/:id/streams
GET /api/m/search?q=…&kind=movie|series
GET /api/m/genres · /api/m/years   — facets pour filtres UI
```

**Spécificités mobile** :

- Cursor pagination (pas offset) pour rester rapide au scroll profond
- Compression gzip / brotli
- ETag + `If-None-Match` → 304 sur listes stables
- CORS : `*` si usage local, sinon whitelist
- Chaque call `GET /api/m/movies/:id` incrémente `popularity` → alimente le
  `stream-top-100` horaire

## 8. Arborescence du repo

```
scraper/
├── src/                          (existant — scrape 1 URL)
│   ├── fetcher.ts
│   ├── parser.ts
│   ├── players.ts
│   ├── resolver.ts
│   ├── schema.ts
│   ├── index.ts
│   └── cli.ts
├── server/src/                   (existant — UI Fastify actuelle)
│   ├── server.ts
│   ├── routes.ts                 → à splitter en plusieurs modules
│   ├── db.ts                     → à remplacer par pg/client.ts
│   └── jobs.ts                   → à conserver pour UI ad hoc
├── crawler/                      ⭐ nouveau
│   ├── discover.ts
│   ├── pool.ts
│   ├── worker.ts
│   └── modes.ts
├── pg/                           ⭐ nouveau
│   ├── client.ts
│   ├── schema/
│   ├── migrations/
│   └── repos/
├── scheduler/                    ⭐ nouveau
│   ├── index.ts
│   └── jobs.ts
├── parser/                       ⭐ nouveau (refactor de src/parser.ts)
│   ├── movie.ts
│   ├── series.ts
│   └── shared.ts
├── server/src/routes/            ⭐ refactor : un fichier par domaine
│   ├── scrape.ts
│   ├── catalog.ts                (API mobile)
│   ├── admin.ts
│   └── history.ts
├── scripts/                      ⭐ nouveau
│   ├── migrate-sqlite-to-pg.ts
│   └── run-job.ts
├── systemd/
│   └── fss.service
├── drizzle.config.ts
├── .env.example
└── ARCHITECTURE.md               (ce document)
```

## 9. Configuration (variables d'environnement)

```dotenv
# .env.example
DATABASE_URL=postgres://fss:****@localhost:5432/fss
WORKER_COUNT=2
CRON_DISCOVER=0 3 * * *
CRON_METADATA=30 3 * * *
CRON_STREAM_TOP=0 * * * *
CRON_FULL_STREAM=0 4 * * 6
STREAM_TOP_LIMIT=100
ADMIN_API_TOKEN=change-me-please
HTTP_PORT=3000
HTTP_HOST=127.0.0.1
NODE_ENV=production
```

## 10. Déploiement (systemd)

`/etc/systemd/system/fss.service` :

```ini
[Unit]
Description=French Stream Scraper (UI + API + scheduler)
After=network.target postgresql.service

[Service]
Type=simple
User=fss
WorkingDirectory=/opt/fss
EnvironmentFile=/opt/fss/.env
ExecStart=/usr/bin/node dist/server/src/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Commandes :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fss
journalctl -u fss -f
```

Backup quotidien via cron root :

```bash
0 2 * * *  pg_dump -U fss fss | gzip > /var/backups/fss-$(date +\%F).sql.gz
```

## 11. Plan de livraison

| # | Sprint | Sortie | Durée estimée |
|---|---|---|---|
| 1 | PG + Drizzle + migration SQLite | DB prête, historique migré | ~1 j |
| 2 | Parser séries (`scrapeSeries()`) | Épisodes détectés | ~1-2 j |
| 3 | Crawler découverte (sitemap + pages) | `url_queue` peuplée | ~1 j |
| 4 | Worker pool (P=2 Playwright) | DB remplie | ~1-2 j |
| 5 | Scheduler (node-cron + 4 jobs) | Fraîcheur garantie | ~0.5 j |
| 6 | API REST mobile (`/api/m/*`) | Expo peut consommer | ~1 j |
| 7 | systemd + ops (unit, backups) | Déploiement reproductible | ~0.5 j |

**Total réaliste** : 5 à 8 jours de travail effectif. MVP utilisable (DB
alimentée + API mobile) = fin sprint 6.

## 12. Risques et mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| Cloudflare renforce → bypass casse | Moyenne | Pool réduit, délais aléatoires, `cookieFile` optionnel, alerting |
| Ban IP si trop agressif | Élevée | Max 2 workers, backoff, `WORKER_COUNT=2` |
| Structure HTML du site change | Moyenne | Parser multi-sélecteurs + tests sur fixtures |
| Streams expirent entre 2 crawls | Certaine | `expires_at`, API filtre `WHERE expires_at > now()`, refresh horaire top 100 |
| Volume catalogue sous-estimé | Moyenne | Pagination curseur, `meta_hash` pour skip upsert |
| Machine locale = pas de redondance | Faible | `pg_dump` quotidien + restart systemd auto |

## 13. Évolutions futures possibles (hors scope MVP)

- Proxy rotatif résidentiel si ban récurrent
- GraphQL si besoins en requêtes composites
- UI web client (PWA) comme 3ᵉ consommateur de l'API REST
- Dashboard Grafana pour monitoring avancé
- Migration vers AdonisJS si la UI admin devient complexe

## 14. Notes légales / éthiques

- Usage **personnel et local** uniquement
- Pas de redistribution publique des flux `.m3u8` (ils expirent en ~48 h)
- Respect d'un taux de requêtes raisonnable (≤ 2 workers, délais aléatoires)
- `User-Agent` indique un navigateur standard (déjà le cas dans `fetcher.ts`)
