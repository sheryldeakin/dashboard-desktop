import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { SCHEMA_VERSION, normalizeContentRecord } from "../lib/content-schema.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || "dashboard_display";
const collectionName = process.env.MONGODB_COLLECTION || "dashboard_content";
const contentKey = process.env.CONTENT_KEY || "main";
const migrateAllKeys = process.env.MIGRATE_ALL_KEYS === "true";

if (!mongoUri) {
  console.error("Missing MONGODB_URI environment variable.");
  process.exit(1);
}

function changed(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

async function run() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const collection = client.db(mongoDbName).collection(collectionName);
  const query = migrateAllKeys ? {} : { key: contentKey };

  const docs = await collection.find(query).toArray();
  if (docs.length === 0) {
    console.log("No documents matched migration query.");
    await client.close();
    return;
  }

  let changedCount = 0;
  for (const doc of docs) {
    const normalized = normalizeContentRecord(doc.content);
    if (!changed(normalized, doc.content)) continue;
    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          content: normalized,
          updatedAt: new Date().toISOString(),
        },
      }
    );
    changedCount += 1;
  }

  console.log(
    `Migration complete. Schema v${SCHEMA_VERSION}. Updated ${changedCount} of ${docs.length} document(s).`
  );
  await client.close();
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
