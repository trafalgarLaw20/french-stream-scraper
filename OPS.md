# Operations — Guide de déploiement

Ce document décrit l'installation, la configuration et l'exploitation du
scraper en daemon systemd sur une machine Linux.

## 1. Pré-requis

| Composant | Version | Rôle |
|---|---|---|
| Node.js | ≥ 20 | Runtime |
| PostgreSQL | ≥ 14 | Stockage (testé avec 17) |
| Chromium (Playwright) | via `npx playwright install chromium` | Bypass Cloudflare |
| libs système | `libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2` | Dépendances Playwright |

Sur Debian/Ubuntu :

```bash
sudo apt update
sudo apt install -y curl ca-certificates postgresql postgresql-contrib \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

## 2. Installation du code

```bash
# Utilisateur dédié
sudo useradd --system --create-home --home /opt/fss --shell /bin/bash fss
sudo -u fss -i

# Clone + deps
cd /opt/fss
git clone <repo-url> .
npm ci
npx playwright install chromium
```

## 3. Base de données PostgreSQL

```bash
# En tant qu'utilisateur postgres
sudo -u postgres psql <<'EOF'
CREATE USER fss WITH PASSWORD 'CHANGE_MOT_DE_PASSE_FORT';
CREATE DATABASE fss OWNER fss;
EOF
```

Configurer le `.env` :

```bash
cp .env.example .env
nano .env
# Ajuster DATABASE_URL, ADMIN_API_TOKEN, etc.
```

Appliquer les migrations Drizzle :

```bash
npm run db:migrate
```

## 4. Build du frontend (optionnel)

L'UI admin Fastify (Scraper / Batch / Historique) n'est pas indispensable en
prod, mais elle peut servir pour déclencher manuellement des crawls.

```bash
npm run build:web
# → web/dist/ servi par Fastify sur /  (SPA)
```

## 5. Dossiers attendus

```bash
sudo mkdir -p /var/backups/fss
sudo chown -u fss:fss /var/backups/fss

mkdir -p /opt/fss/data/backups
```

## 6. Installation systemd

```bash
sudo cp systemd/fss.service /etc/systemd/system/
sudo cp systemd/fss-backup.service systemd/fss-backup.timer /etc/systemd/system/

# Éditer les chemins si tu n'as pas installé dans /opt/fss
sudo nano /etc/systemd/system/fss.service

sudo systemctl daemon-reload
sudo systemctl enable --now fss.service fss-backup.timer
```

## 7. Vérification

```bash
systemctl status fss
journalctl -u fss -f --since "1 minute ago"
curl http://127.0.0.1:3000/api/m/health
# → {"ok":true,"ts":...}

curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     http://127.0.0.1:3000/api/admin/status
# → {"currentJob":null,"queue":{...},"staleReset":0}
```

## 8. Opérations courantes

### Démarrer / arrêter / redémarrer

```bash
sudo systemctl start fss
sudo systemctl stop fss
sudo systemctl restart fss
```

### Logs (temps réel)

```bash
journalctl -u fss -f
# ou avec filtre :
journalctl -u fss -f -g "scheduler|job:"
```

### Déclencher manuellement un job

```bash
# Discover le catalogue complet (~4 heures)
curl -X POST -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"kind":"discover"}' \
     http://127.0.0.1:3000/api/admin/crawl
# → 202 {"ran":true,"message":"job \"discover\" démarré en arrière-plan"}
```

Kinds valides : `discover`, `metadata`, `stream`, `full-stream`.

### Suivre l'avancement d'un job

```bash
watch -n 5 'curl -s -H "X-Admin-Token: $ADMIN_API_TOKEN" \
              http://127.0.0.1:3000/api/admin/status | jq'
```

### Historique des runs

```bash
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     'http://127.0.0.1:3000/api/admin/runs?limit=10' | jq
```

## 9. Backups

Le timer `fss-backup.timer` déclenche `pg_dump` tous les jours à **02:00** (avant
les jobs cron du scheduler à 03:00). Les dumps sont écrits dans
`/var/backups/fss/fss-AAAA-MM-JJ.sql.gz` avec rotation 14 jours.

```bash
# Vérifier le timer
systemctl list-timers fss-backup

# Backup manuel
sudo -u fss /usr/bin/pg_dump --no-owner --clean --if-exists -Z 6 -d fss \
  > /var/backups/fss/fss-manuel-$(date +%F).sql.gz

# Restauration
sudo -u postgres createdb fss_restore
sudo -u postgres pg_restore -d fss_restore -1 /var/backups/fss/fss-AAAA-MM-JJ.sql.gz
```

## 10. Mises à jour

```bash
sudo systemctl stop fss
cd /opt/fss
sudo -u fss git pull
sudo -u fss npm ci
sudo -u fss npm run db:migrate     # applique les nouvelles migrations
sudo -u fss npm run build:web      # si l'UI a changé
sudo systemctl start fss
journalctl -u fss -f --since "1 minute ago"
```

## 11. En cas de blocage Cloudflare

Si le scraper se fait bannir (taux d'erreur > 50 % sur un run), procédure :

1. **Arrêter le daemon** : `sudo systemctl stop fss`
2. **Attendre ~1 heure** (le blocage CF est généralement temporaire)
3. **Lancer une session manuelle headed** pour valider un cookie :
   ```bash
   # En local (pas en systemd), ouvrir un navigateur visible
   sudo -u fss npx tsx tests/dump-html.ts https://french-stream.one/ \
     --headed
   ```
4. Si persistant, **passer `WORKER_COUNT=1`** dans `.env` et augmenter les délais
   dans `crawler/discover.ts` et `crawler/worker.ts`.
5. Si toujours : envisager un proxy rotatif (cf. ARCHITECTURE.md §13).

## 12. Monitoring minimaliste

```bash
# Évolution de la queue
watch -n 30 "psql -d fss -c \"SELECT status, count(*) FROM url_queue GROUP BY status;\""

# Derniers runs
psql -d fss -c "
  SELECT id, kind, started_at, finished_at,
         EXTRACT(EPOCH FROM (COALESCE(finished_at, now()) - started_at))::int AS sec,
         total, ok, errors
  FROM scrape_runs ORDER BY id DESC LIMIT 10;
"

# Top 20 films les plus populaires (ceux rafraîchis en priorité par stream-top)
psql -d fss -c "
  SELECT id, titre, popularity
  FROM movies ORDER BY popularity DESC LIMIT 20;
"
```

## 13. Troubleshooting

| Symptôme | Diagnostic | Solution |
|---|---|---|
| `journalctl -u fss` montre `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL down | `sudo systemctl start postgresql` |
| Jobs en `error` (5 tentatives) | Site结构 changé ou ban CF | `psql -c "SELECT url, last_error FROM url_queue WHERE status='error' LIMIT 5;"` puis investiguer |
| `currentJob` bloqué > 30 min | Worker crash sans reset | `POST /api/admin/status` déclenche `resetStale()` automatique au prochain check |
| Mémoire qui gonfle | Fuite Playwright | `Restart=on-failure` redémarre ; sinon `sudo systemctl restart fss` |
| Frontend 404 | `web/dist` absent | `npm run build:web` |

## 14. Désinstallation

```bash
sudo systemctl disable --now fss fss-backup.timer
sudo rm /etc/systemd/system/fss{,-backup.service,-backup.timer}
sudo systemctl daemon-reload
sudo userdel -r fss
sudo -u postgres dropdb fss
sudo rm -rf /var/backups/fss
```

## 15. Sécurité

- **Exposer l'API sur internet** : NE PAS faire `HTTP_HOST=0.0.0.0` sans
  reverse-proxy (nginx/caddy) + TLS + authentification forte.
- **`ADMIN_API_TOKEN`** : générer avec `openssl rand -hex 32`. Ne JAMAIS committer.
- **`DATABASE_URL`** : utiliser un utilisateur PostgreSQL dédié avec droits
  limités à la DB `fss` uniquement.
- **Playwright + sandbox** : le service systemd tourne avec `--no-sandbox` car
  Chromium a du mal avec `ProtectSystem=strict`. Vérifier que l'utilisateur
  `fss` n'a pas de droits sudo.
