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

app.put("/api/content", async (req, res) => {
  const payload = req.body;
  if (!isContentPayload(payload)) {
    return res.status(400).json({ error: "Invalid content payload." });
  }

  const normalizedPayload = normalizeContentRecord(payload);

  try {
    const collection = await getCollection();
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
