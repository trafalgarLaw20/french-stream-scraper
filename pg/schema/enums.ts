import { pgEnum } from "drizzle-orm/pg-core";

export const entityKindEnum = pgEnum("entity_kind", ["movie", "episode"]);

export const urlKindEnum = pgEnum("url_kind", ["movie", "series", "episode"]);

export const queueStatusEnum = pgEnum(
  "queue_status",
  ["pending", "running", "done", "error", "stale"],
);

export const runKindEnum = pgEnum(
  "run_kind",
  ["discover", "metadata", "stream", "full-stream"],
);

export const streamProtocolEnum = pgEnum("stream_protocol", ["hls", "mp4"]);
