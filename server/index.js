import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { MongoClient } from "mongodb";

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
const allowedOrigins = rawOrigins ? rawOrigins.split(",").map((origin) => origin.trim()).filter(Boolean) : null;

app.use(
  cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ["GET", "PUT", "OPTIONS"],
  })
);
app.use(express.json({ limit: "1mb" }));

const client = new MongoClient(mongoUri);
let collectionPromise;

function getCollection() {
  if (!collectionPromise) {
    collectionPromise = client.connect().then(() => client.db(mongoDbName).collection(collectionName));
  }
  return collectionPromise;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidContentPayload(payload) {
  if (!isObject(payload)) return false;
  if (typeof payload.phase !== "string") return false;
  if (!Array.isArray(payload.todaysTasks)) return false;
  if (typeof payload.todaysTasksDate !== "string") return false;
  if (!Array.isArray(payload.taskHistory)) return false;
  return true;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "dashboard-display-api",
    now: new Date().toISOString(),
  });
});

app.get("/api/content", async (_req, res) => {
  try {
    const collection = await getCollection();
    const doc = await collection.findOne({ key: contentKey });

    if (!doc) {
      return res.json({
        content: null,
        updatedAt: null,
      });
    }

    return res.json({
      content: doc.content,
      updatedAt: doc.updatedAt ?? null,
    });
  } catch (error) {
    console.error("Failed to load dashboard content:", error);
    return res.status(500).json({ error: "Failed to load dashboard content." });
  }
});

app.put("/api/content", async (req, res) => {
  const nextContent = req.body;

  if (!isValidContentPayload(nextContent)) {
    return res.status(400).json({ error: "Invalid content payload." });
  }

  try {
    const collection = await getCollection();
    const updatedAt = new Date().toISOString();

    await collection.updateOne(
      { key: contentKey },
      {
        $set: {
          content: nextContent,
          updatedAt,
        },
      },
      { upsert: true }
    );

    return res.json({
      ok: true,
      updatedAt,
    });
  } catch (error) {
    console.error("Failed to save dashboard content:", error);
    return res.status(500).json({ error: "Failed to save dashboard content." });
  }
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

process.on("SIGTERM", async () => {
  try {
    await client.close();
  } finally {
    process.exit(0);
  }
});
