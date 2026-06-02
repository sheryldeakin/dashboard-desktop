import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { MongoClient } from "mongodb";
import {
  SCHEMA_VERSION,
  createDefaultContent,
  isContentPayload,
  normalizeContentRecord,
} from "./lib/content-schema.js";

dotenv.config();

const app = express();

const port = Number(process.env.PORT || 4000);
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || "dashboard_display";
const collectionName = process.env.MONGODB_COLLECTION || "dashboard_content";
const contentKey = process.env.CONTENT_KEY || "main";

if (!mongoUri) {
  console.error("Missing MONGODB_URI environment variable.");
  process.exit(1);
}

const rawOrigins = process.env.CORS_ORIGINS?.trim();
const allowedOrigins = rawOrigins
  ? rawOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : null;

app.use(
  cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ["GET", "PUT", "POST", "OPTIONS"],
  })
);
app.use(express.json({ limit: "1mb" }));

const client = new MongoClient(mongoUri);
let collectionPromise;

function getCollection() {
  if (!collectionPromise) {
    collectionPromise = client
      .connect()
      .then(() => client.db(mongoDbName).collection(collectionName))
      .catch((error) => {
        collectionPromise = null;
        throw error;
      });
  }
  return collectionPromise;
}

function contentHasChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

async function readNormalizedContent(collection) {
  const doc = await collection.findOne({ key: contentKey });
  if (!doc) {
    return {
      exists: false,
      content: createDefaultContent(),
      updatedAt: null,
      changed: false,
    };
  }

  const normalized = normalizeContentRecord(doc.content);
  return {
    exists: true,
    content: normalized,
    updatedAt: doc.updatedAt ?? null,
    changed: contentHasChanged(normalized, doc.content),
  };
}

async function saveContentDocument(collection, content, updatedAt = new Date().toISOString()) {
  await collection.updateOne(
    { key: contentKey },
    {
      $set: {
        content,
        updatedAt,
      },
    },
    { upsert: true }
  );
  return updatedAt;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "dashboard-display-api",
    schemaVersion: SCHEMA_VERSION,
    now: new Date().toISOString(),
  });
});

app.get("/api/content/schema", async (_req, res) => {
  try {
    const collection = await getCollection();
    const normalized = await readNormalizedContent(collection);
    res.json({
      schemaVersion: SCHEMA_VERSION,
      contentExists: normalized.exists,
      migrationRecommended: normalized.changed,
    });
  } catch (error) {
    console.error("Failed to load schema info:", error);
    res.status(500).json({ error: "Failed to load schema info." });
  }
});

app.get("/api/content", async (_req, res) => {
  try {
    const collection = await getCollection();
    const normalized = await readNormalizedContent(collection);

    if (normalized.exists && normalized.changed) {
      const updatedAt = await saveContentDocument(collection, normalized.content);
      return res.json({
        content: normalized.content,
        updatedAt,
        schemaVersion: SCHEMA_VERSION,
        migrated: true,
      });
    }

    return res.json({
      content: normalized.content,
      updatedAt: normalized.updatedAt,
      schemaVersion: SCHEMA_VERSION,
      migrated: false,
    });
  } catch (error) {
    console.error("Failed to load dashboard content:", error);
    return res.status(500).json({ error: "Failed to load dashboard content." });
  }
});

// Merge workSessions append-only (union by id). The frontend's save paths
// can carry a stale snapshot (workSessions isn't surfaced in any UI state, so
// the client's view lags the importer); without this union, every /todo save
// would clobber whatever entries the hourly importer added since page load.
// Other top-level arrays stay REPLACE semantics — they're user-editable so
// the user can legitimately delete from them.
function mergeWorkSessions(existing, incoming) {
  const map = new Map();
  for (const e of existing || []) {
    if (e && e.id) map.set(e.id, e);
  }
  // Incoming wins on id collision so the client can update an entry it owns.
  for (const e of incoming || []) {
    if (e && e.id) map.set(e.id, e);
  }
  return [...map.values()];
}

// dailyTop3History is also append-only — entries get added at midnight rollover
// and never replaced. Union by date. Same reasoning as workSessions: client's
// snapshot can be stale relative to a rollover that fired elsewhere.
function mergeDailyTop3History(existing, incoming) {
  const map = new Map();
  for (const e of existing || []) {
    if (e && e.date) map.set(e.date, e);
  }
  for (const e of incoming || []) {
    if (e && e.date) map.set(e.date, e);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
}

// Heartbeats: merge by key, incoming overrides for that task. Without this, a
// /todo save (which doesn't know about heartbeats) would wipe the field every
// time a script PUT'd its heartbeat just before. Same data-loss class as the
// workSessions clobber we fixed earlier.
function mergeHeartbeats(existing, incoming) {
  return { ...(existing || {}), ...(incoming || {}) };
}

// dailyTop3: per-slot merge using slot.updatedAt as the last-write-wins signal.
// Without this, the same partial-deploy clobber class as workSessions hits Top 3:
// an old client PUTs without updatedAt on slots → looks like "empty wins" if we
// took the incoming wholesale → today's Top 3 wiped. Rule per slot:
//   - if incoming has no updatedAt AND existing does, keep existing
//     (covers old-client and stale-snapshot writes)
//   - else newer updatedAt wins
//   - else (both null) incoming wins (first-write)
// If dates differ, take incoming wholesale (rollover happened on the client side).
function isoToMs(s) {
  if (typeof s !== "string") return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function mergeDailyTop3(existing, incoming) {
  if (!incoming || typeof incoming !== "object") return existing;
  if (!existing || typeof existing !== "object") return incoming;
  if (incoming.date && existing.date && incoming.date !== existing.date) {
    return incoming;
  }
  const eSlots = Array.isArray(existing.slots) ? existing.slots : [];
  const iSlots = Array.isArray(incoming.slots) ? incoming.slots : [];
  const merged = [];
  for (let s = 0; s < 3; s++) {
    const eS = eSlots[s] || {};
    const iS = iSlots[s] || {};
    const eAt = isoToMs(eS.updatedAt);
    const iAt = isoToMs(iS.updatedAt);
    if (iAt === null && eAt !== null) merged.push(eS);
    else if (eAt === null && iAt !== null) merged.push(iS);
    else if ((iAt || 0) >= (eAt || 0)) merged.push(iS);
    else merged.push(eS);
  }
  return {
    date: incoming.date || existing.date,
    slots: merged,
    updatedAt: incoming.updatedAt || existing.updatedAt,
  };
}

app.put("/api/content", async (req, res) => {
  const payload = req.body;
  if (!isContentPayload(payload)) {
    return res.status(400).json({ error: "Invalid content payload." });
  }

  try {
    const collection = await getCollection();
    const existing = await readNormalizedContent(collection);

    // workSessions / dailyTop3History / scheduledTaskHeartbeats / dailyTop3:
    // all merged so background writers (importer, sync scripts) and stale
    // client snapshots can't clobber each other. Everything else: client wins.
    const mergedPayload = {
      ...payload,
      workSessions: mergeWorkSessions(
        existing.content.workSessions,
        payload.workSessions,
      ),
      dailyTop3History: mergeDailyTop3History(
        existing.content.dailyTop3History,
        payload.dailyTop3History,
      ),
      scheduledTaskHeartbeats: mergeHeartbeats(
        existing.content.scheduledTaskHeartbeats,
        payload.scheduledTaskHeartbeats,
      ),
      dailyTop3: mergeDailyTop3(
        existing.content.dailyTop3,
        payload.dailyTop3,
      ),
    };
    const normalizedPayload = normalizeContentRecord(mergedPayload);
    const updatedAt = await saveContentDocument(collection, normalizedPayload);

    return res.json({
      ok: true,
      updatedAt,
      schemaVersion: SCHEMA_VERSION,
    });
  } catch (error) {
    console.error("Failed to save dashboard content:", error);
    return res.status(500).json({ error: "Failed to save dashboard content." });
  }
});

app.post("/api/content/migrate", async (_req, res) => {
  try {
    const collection = await getCollection();
    const normalized = await readNormalizedContent(collection);
    const updatedAt = await saveContentDocument(collection, normalized.content);

    return res.json({
      ok: true,
      migrated: normalized.changed || !normalized.exists,
      updatedAt,
      schemaVersion: SCHEMA_VERSION,
    });
  } catch (error) {
    console.error("Failed to migrate dashboard content:", error);
    return res.status(500).json({ error: "Failed to migrate dashboard content." });
  }
});

const server = app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

process.on("SIGTERM", async () => {
  try {
    server.close();
    await client.close();
  } finally {
    process.exit(0);
  }
});
