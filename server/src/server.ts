import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { registerRoutes } from "./routes.js";
import { startScheduler } from "../../scheduler/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(__dirname, "../../web/dist");
const PORT = Number(process.env.HTTP_PORT ?? process.env.PORT ?? 3000);
const HOST = process.env.HTTP_HOST ?? "127.0.0.1";
const ENABLE_SCHEDULER = (process.env.DISABLE_SCHEDULER ?? "0") !== "1";

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: "info" } });

  await app.register(fastifyCors, { origin: true });
  // Compression gzip/brotli pour les endpoints mobiles /api/m/*
  await app.register(fastifyCompress, { threshold: 512 });

  await registerRoutes(app);

  if (existsSync(WEB_DIST)) {
    // Pas de `wildcard: false` : les routes statiques seraient figées au
    // démarrage et tout rebuild de web/dist (nouveaux assets hashés) serait
    // servi via le fallback SPA → HTML renvoyé à la place du JS → page blanche.
    // Le wildcard sert les fichiers à la demande depuis le disque.
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: "/",
    });
    app.setNotFoundHandler(async (_req, reply) => {
      return reply.sendFile("index.html");
    });
    app.log.info(`Frontend servi depuis ${WEB_DIST}`);
  } else {
    app.log.warn(`Frontend non build (${WEB_DIST} absent). Lance 'npm run build:web' ou 'npm run dev'.`);
  }

  if (ENABLE_SCHEDULER) {
    startScheduler();
    app.log.info("Scheduler démarré (cron jobs enregistrés)");
  } else {
    app.log.warn("Scheduler DÉSACTIVÉ (DISABLE_SCHEDULER=1)");
  }

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n  Scraper UI →  http://${HOST}:${PORT}\n`);
  } catch (e) {
    app.log.error((e as Error).message);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
