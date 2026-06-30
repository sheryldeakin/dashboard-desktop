import { execFile } from "child_process";
import compression from "compression";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fs from "fs/promises";
import { MongoClient } from "mongodb";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
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

// gzip responses. With 600+ workSessions (each carrying token data) plus
// thousands of taskHistory / pomodoroHistory entries, /api/content can hit
// 1MB+ uncompressed. compression drops it ~5–10× and is required because
// Railway doesn't auto-gzip at the edge — it's app-side or nothing.
app.use(compression());

// 1mb was hit a few times in dev as the document grew. Bumped to 5mb so
// PUTs don't silently fail; the real fix (history collection split) is
// deferred per memory note.
app.use(express.json({ limit: "5mb" }));

// MongoClient is a long-lived singleton. If its internal topology gets
// wedged (e.g., the cluster does a primary failover the driver doesn't
// recover from cleanly — which took down /api/content for 45+ min on
// 2026-06-11), every subsequent operation hangs for 30s then throws
// MongoServerSelectionError. The driver doesn't always self-heal, so we
// detect persistent connection errors and rebuild the client.
let client = new MongoClient(mongoUri);
let collectionPromise;
let lastRebuildMs = 0;
const REBUILD_THROTTLE_MS = 10000;

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

// True for the error classes the driver throws when it can't talk to the
// cluster. Used by withCollection to decide whether a rebuild is warranted.
function isConnectionError(err) {
  if (!err || !err.name) return false;
  return (
    err.name === "MongoServerSelectionError" ||
    err.name === "MongoNetworkError" ||
    err.name === "MongoNotConnectedError" ||
    err.name === "MongoTopologyClosedError" ||
    err.name === "MongoExpiredSessionError"
  );
}

async function rebuildClient(reason) {
  // Throttle so a sustained outage doesn't spin in a rebuild loop.
  const since = Date.now() - lastRebuildMs;
  if (since < REBUILD_THROTTLE_MS) {
    throw new Error(`MongoClient rebuild throttled (last rebuild ${since}ms ago): ${reason}`);
  }
  lastRebuildMs = Date.now();
  console.warn(`Rebuilding MongoClient: ${reason}`);
  const stale = client;
  client = new MongoClient(mongoUri);
  collectionPromise = null;
  // Best-effort close of the stale client; don't block the rebuild on it.
  stale.close(true).catch((err) => {
    console.warn("Stale MongoClient close failed (ignored):", err?.message);
  });
}

// Runs `fn(collection)` against a fresh-enough collection. On a connection
// error, rebuilds the client once and retries. Routes should use this
// instead of getCollection() directly so a wedged client self-heals
// rather than locking the service up.
async function withCollection(fn) {
  try {
    const collection = await getCollection();
    return await fn(collection);
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    try {
      await rebuildClient(`${error.name}: ${error.message}`);
    } catch (rebuildErr) {
      // Throttled or rebuild itself failed — surface the original error
      // so callers don't see the rebuild noise instead.
      console.error("Client rebuild failed:", rebuildErr?.message);
      throw error;
    }
    const collection = await getCollection();
    return await fn(collection);
  }
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
    const normalized = await withCollection((collection) => readNormalizedContent(collection));
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
    const payload = await withCollection(async (collection) => {
      const normalized = await readNormalizedContent(collection);
      if (normalized.exists && normalized.changed) {
        const updatedAt = await saveContentDocument(collection, normalized.content);
        return {
          content: normalized.content,
          updatedAt,
          schemaVersion: SCHEMA_VERSION,
          migrated: true,
        };
      }
      return {
        content: normalized.content,
        updatedAt: normalized.updatedAt,
        schemaVersion: SCHEMA_VERSION,
        migrated: false,
      };
    });
    return res.json(payload);
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
function mergeWorkSessions(existing, incoming, deletes, validProjectIds, projectMoves) {
  const map = new Map();
  for (const e of existing || []) {
    if (e && e.id) map.set(e.id, e);
  }
  // Incoming wins on id collision so the client can update an entry it owns.
  // EXCEPT for two cases of importer-stale-snapshot revert:
  //   1. aiSummary: import script's GET happens before backfill fills it,
  //      then import's PUT carries the still-empty summary and overwrites.
  //      Rule: if existing has a non-empty summary, keep it against empty
  //      incoming.
  //   2. projectId: same shape with reclassify scripts. Import's PUT has
  //      the stale project assignment; reclassify moved it; merge would
  //      revert. Rule: preserve existing projectId if it points to a
  //      currently-valid project. If existing projectId is invalid
  //      (project was deleted), let incoming win — that's how the orphan-
  //      recovery scripts repair sessions pointing at dead ids.
  //   Explicit overrides via `workSessionProjectMoves: {sessionId: pid}`
  //   bypass the projectId guard so reclassify scripts can still move
  //   sessions deliberately.
  const moves = (projectMoves && typeof projectMoves === "object" && !Array.isArray(projectMoves))
    ? projectMoves : {};
  const validPids = validProjectIds instanceof Set ? validProjectIds : new Set();
  for (const e of incoming || []) {
    if (!e || !e.id) continue;
    const cur = map.get(e.id);
    let next = e;
    if (cur) {
      // (1) aiSummary preserve.
      const curSum = (cur.aiSummary || "").trim();
      const inSum = (e.aiSummary || "").trim();
      if (curSum && !inSum) {
        next = { ...next, aiSummary: cur.aiSummary };
      }
      // (2) projectId preserve — only when existing is still valid AND
      // there's no explicit move override for this id.
      const moveTarget = moves[e.id];
      if (typeof moveTarget === "string" && moveTarget) {
        next = { ...next, projectId: moveTarget };
      } else if (
        cur.projectId &&
        validPids.has(cur.projectId) &&
        e.projectId !== cur.projectId
      ) {
        next = { ...next, projectId: cur.projectId };
      }
    }
    map.set(e.id, next);
  }
  // Explicit deletes — used by cleanup scripts to remove specific entries
  // (e.g., headless `claude -p` artifacts that got imported as workSessions).
  // Applied last so a delete wins over both existing and incoming.
  if (Array.isArray(deletes)) {
    for (const id of deletes) {
      if (typeof id === "string" && id) map.delete(id);
    }
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

// Heartbeats: per-key newest-timestamp-wins. The naive spread version was
// vulnerable to a stale-snapshot clobber: a long-open /home tab autosaves
// with pristineRef-loaded heartbeats from when the tab opened (could be
// 30+ min ago). A fresh script-written heartbeat (e.g. sync-top3 at 22:10)
// would get overwritten by the autosave's stale 21:40 value, and the
// "stale" banner would re-trigger on the dashboard within minutes.
// Fix: only let an incoming value overwrite existing if it's actually
// newer. Same class as the dailyTop3 per-slot updatedAt fix.
/* Chat-links (pinned claude.ai/code remote URLs etc.) — preserve
   existing if the client didn't send the field. ChatsCard always
   sends the FULL chatLinks array when it changes, so an absent
   field on PUT means "this writer doesn't know about chatLinks" not
   "wipe them." Without this, an unrelated PUT (e.g. from a sync
   script that pre-dates this field) silently clobbers all chat links.
   See new-fields-must-merge-on-put memory. */
function mergeChatLinks(existing, incoming) {
  if (!Array.isArray(incoming)) return existing || [];
  return incoming;
}

/* Vault snapshot fields. REPLACE semantics with a "missing field means
   preserve" guard — most PUTs (every /todo save, every Settings save,
   every workSession importer push) don't carry these fields. Without
   the guard, the sync-vault.py snapshot would get wiped on the next
   unrelated PUT. Same shape as mergeChatLinks. */
function preserveIfMissing(existing, incoming) {
  return incoming === undefined ? (existing ?? null) : incoming;
}

function preserveArrayIfMissing(existing, incoming) {
  if (incoming === undefined) return existing || [];
  return Array.isArray(incoming) ? incoming : [];
}

// Projects: union by id with last-write-wins on name/color. Without this,
// stale client snapshots (e.g. a /todo tab open since before the importer
// auto-created Bambu Logger) silently drop newly-added projects, which
// then orphans every workSession that referenced the dropped id. Frontend
// can delete a project via `projectDeletes: [pid…]` — applied last so a
// delete wins. Names are preserved verbatim from incoming so renames
// through /settings still propagate.
function mergeProjects(existing, incoming, deletes) {
  if (!Array.isArray(incoming)) return existing || [];
  const map = new Map();
  for (const e of existing || []) {
    if (e && e.id) map.set(e.id, e);
  }
  for (const e of incoming) {
    if (e && e.id) map.set(e.id, e);
  }
  if (Array.isArray(deletes)) {
    for (const id of deletes) {
      if (typeof id === "string" && id) map.delete(id);
    }
  }
  return [...map.values()];
}

function mergeHeartbeats(existing, incoming) {
  const e = existing && typeof existing === "object" ? existing : {};
  const i = incoming && typeof incoming === "object" ? incoming : {};
  const out = { ...e };
  for (const [key, val] of Object.entries(i)) {
    const iMs = isoToMs(val);
    if (iMs === null) continue; // malformed incoming → skip, don't pollute
    const eMs = isoToMs(out[key]);
    if (eMs === null || iMs > eMs) {
      out[key] = val;
    }
  }
  return out;
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
    const updatedAt = await withCollection(async (collection) => {
      const existing = await readNormalizedContent(collection);

      // workSessions / dailyTop3History / scheduledTaskHeartbeats / dailyTop3:
      // all merged so background writers (importer, sync scripts) and stale
      // client snapshots can't clobber each other. Everything else: client wins.
      // Build validProjectIds from the post-merge projects set so newly-
      // added projects in this PUT are considered valid (avoids "newly
      // created project not in validPids → projectId preservation fails").
      const postMergeProjects = mergeProjects(
        existing.content.projects,
        payload.projects,
        payload.projectDeletes,
      );
      const validProjectIds = new Set(postMergeProjects.map((p) => p.id));
      const mergedPayload = {
        ...payload,
        workSessions: mergeWorkSessions(
          existing.content.workSessions,
          payload.workSessions,
          payload.workSessionDeletes,
          validProjectIds,
          payload.workSessionProjectMoves,
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
        chatLinks: mergeChatLinks(
          existing.content.chatLinks,
          payload.chatLinks,
        ),
        manualSyncTriggers: mergeHeartbeats(
          existing.content.manualSyncTriggers,
          payload.manualSyncTriggers,
        ),
        projects: postMergeProjects,
        // Vault snapshots: preserve existing if this PUT didn't carry the
        // field (typical: every non-vault-sync PUT). Only sync-vault.py
        // sets these, and it's the authoritative writer.
        dailyNote: preserveIfMissing(existing.content.dailyNote, payload.dailyNote),
        inbox: preserveArrayIfMissing(existing.content.inbox, payload.inbox),
        recentVaultEdits: preserveArrayIfMissing(existing.content.recentVaultEdits, payload.recentVaultEdits),
      };
      const normalizedPayload = normalizeContentRecord(mergedPayload);
      return await saveContentDocument(collection, normalizedPayload);
    });

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
    const result = await withCollection(async (collection) => {
      const normalized = await readNormalizedContent(collection);
      const updatedAt = await saveContentDocument(collection, normalized.content);
      return {
        ok: true,
        migrated: normalized.changed || !normalized.exists,
        updatedAt,
        schemaVersion: SCHEMA_VERSION,
      };
    });
    return res.json(result);
  } catch (error) {
    console.error("Failed to migrate dashboard content:", error);
    return res.status(500).json({ error: "Failed to migrate dashboard content." });
  }
});

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const CHATS_LIVE_WINDOW_MS = 30 * 60 * 1000;
const CHATS_LIVE_TEXT_LIMIT = 240;

function projectLabelFromCwd(cwd) {
  if (!cwd) return "unknown";
  const normalized = String(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || "unknown";
}

function extractTextFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const part = content[i];
    if (part && part.type === "text" && typeof part.text === "string") {
      return part.text;
    }
  }
  return "";
}

function clipText(text) {
  if (!text) return "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= CHATS_LIVE_TEXT_LIMIT) return trimmed;
  return `${trimmed.slice(0, CHATS_LIVE_TEXT_LIMIT - 1)}…`;
}

async function summarizeSessionFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n");
  let sessionId = "";
  let cwd = "";
  let entrypoint = "";
  let model = "";
  let gitBranch = "";
  let firstTimestamp = "";
  let lastTimestamp = "";
  let lastUserText = "";
  let lastAssistantText = "";
  let userMessages = 0;
  let assistantMessages = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let tokensCacheRead = 0;
  let tokensCacheCreate = 0;

  for (const line of lines) {
    if (!line) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.sessionId && !sessionId) sessionId = evt.sessionId;
    if (evt.cwd && !cwd) cwd = evt.cwd;
    if (evt.entrypoint && !entrypoint) entrypoint = evt.entrypoint;
    if (evt.gitBranch && !gitBranch) gitBranch = evt.gitBranch;
    if (evt.timestamp) {
      if (!firstTimestamp || evt.timestamp < firstTimestamp) firstTimestamp = evt.timestamp;
      if (!lastTimestamp || evt.timestamp > lastTimestamp) lastTimestamp = evt.timestamp;
    }
    if (evt.type === "assistant" && evt.message) {
      assistantMessages += 1;
      if (evt.message.model && !model) model = evt.message.model;
      const text = extractTextFromContent(evt.message.content);
      if (text) lastAssistantText = text;
      const usage = evt.message.usage;
      if (usage) {
        tokensIn += Number(usage.input_tokens || 0);
        tokensOut += Number(usage.output_tokens || 0);
        tokensCacheRead += Number(usage.cache_read_input_tokens || 0);
        tokensCacheCreate += Number(usage.cache_creation_input_tokens || 0);
      }
    } else if (evt.type === "user" && evt.message) {
      userMessages += 1;
      const text = extractTextFromContent(evt.message.content);
      if (text) lastUserText = text;
    }
  }

  return {
    sessionId,
    cwd,
    entrypoint,
    model,
    gitBranch,
    projectLabel: projectLabelFromCwd(cwd),
    firstTimestamp,
    lastTimestamp,
    messageCount: userMessages + assistantMessages,
    userMessages,
    assistantMessages,
    lastUserText: clipText(lastUserText),
    lastAssistantText: clipText(lastAssistantText),
    tokens: {
      input: tokensIn,
      output: tokensOut,
      cacheRead: tokensCacheRead,
      cacheCreation: tokensCacheCreate,
    },
  };
}

app.get("/api/chats-live", async (_req, res) => {
  try {
    const cutoff = Date.now() - CHATS_LIVE_WINDOW_MS;
    let projectDirs = [];
    try {
      projectDirs = await fs.readdir(CLAUDE_PROJECTS_DIR);
    } catch (err) {
      if (err.code === "ENOENT") {
        return res.json({ sessions: [], cutoffMs: CHATS_LIVE_WINDOW_MS });
      }
      throw err;
    }

    const recentFiles = [];
    await Promise.all(
      projectDirs.map(async (dir) => {
        const dirPath = path.join(CLAUDE_PROJECTS_DIR, dir);
        let entries;
        try {
          entries = await fs.readdir(dirPath);
        } catch {
          return;
        }
        await Promise.all(
          entries.map(async (entry) => {
            if (!entry.endsWith(".jsonl")) return;
            const filePath = path.join(dirPath, entry);
            try {
              const stat = await fs.stat(filePath);
              if (stat.mtimeMs >= cutoff) {
                recentFiles.push({ filePath, mtimeMs: stat.mtimeMs });
              }
            } catch {}
          }),
        );
      }),
    );

    const summaries = await Promise.all(
      recentFiles.map(async ({ filePath, mtimeMs }) => {
        try {
          const summary = await summarizeSessionFile(filePath);
          return { ...summary, mtimeMs };
        } catch (err) {
          console.warn("chats-live: failed to read", filePath, err.message);
          return null;
        }
      }),
    );

    const now = Date.now();
    const sessions = summaries
      .filter((s) => s && s.entrypoint !== "sdk-cli" && s.sessionId)
      .map((s) => {
        const lastMs = s.lastTimestamp ? Date.parse(s.lastTimestamp) : s.mtimeMs;
        const idleMs = Number.isFinite(lastMs) ? Math.max(0, now - lastMs) : null;
        return { ...s, idleMs, idleMinutes: idleMs == null ? null : Math.round(idleMs / 60000) };
      })
      .sort((a, b) => {
        const at = a.lastTimestamp ? Date.parse(a.lastTimestamp) : a.mtimeMs;
        const bt = b.lastTimestamp ? Date.parse(b.lastTimestamp) : b.mtimeMs;
        return bt - at;
      });

    return res.json({ sessions, cutoffMs: CHATS_LIVE_WINDOW_MS, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Failed to list live chats:", error);
    return res.status(500).json({ error: "Failed to list live chats." });
  }
});

// POST /api/focus-terminal — brings the terminal window matching the
// given cwd to the foreground via a PowerShell + Win32 P/Invoke shell-
// out. Best-effort: matches by cwd leaf-folder substring in the window
// title. Multi-tab terminal windows (Windows Terminal with tabs) may
// match the wrong tab — that's a documented limitation, not a bug.
// Endpoint is unauthenticated; safe because the API is bound to
// localhost-origin requests via the existing CORS allowlist.
const FOCUS_TERMINAL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$needle = $args[0]
if (-not $needle) { Write-Output "NO_NEEDLE"; exit 1 }

Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  using System.Text;
  public class Win32Focus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  }
"@

$candidates = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and ($_.MainWindowTitle.ToLower().Contains($needle.ToLower()))
} | Sort-Object { $_.MainWindowTitle.Length }

if (-not $candidates) { Write-Output "NO_MATCH"; exit 0 }

$target = $candidates | Select-Object -First 1
$handle = $target.MainWindowHandle
$title  = $target.MainWindowTitle

if ([Win32Focus]::IsIconic($handle)) { [Win32Focus]::ShowWindowAsync($handle, 9) | Out-Null }

$fg = [Win32Focus]::GetForegroundWindow()
$fgThread = [Win32Focus]::GetWindowThreadProcessId($fg, [ref]([uint32]0))
$curThread = [Win32Focus]::GetCurrentThreadId()
[Win32Focus]::AttachThreadInput($curThread, $fgThread, $true) | Out-Null
[Win32Focus]::BringWindowToTop($handle) | Out-Null
[Win32Focus]::SetForegroundWindow($handle) | Out-Null
[Win32Focus]::AttachThreadInput($curThread, $fgThread, $false) | Out-Null

Write-Output "OK:$title"
`;

function focusNeedleFromCwd(cwd) {
  if (!cwd) return "";
  const normalized = String(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || "";
}

app.post("/api/focus-terminal", async (req, res) => {
  try {
    const cwd = typeof req.body?.cwd === "string" ? req.body.cwd : "";
    const needle = focusNeedleFromCwd(cwd);
    if (!needle) {
      return res.status(400).json({ error: "Missing or unrecognized cwd." });
    }
    if (process.platform !== "win32") {
      return res.status(501).json({ error: "Focus only implemented on Windows." });
    }

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", FOCUS_TERMINAL_SCRIPT, needle],
      { timeout: 5000, windowsHide: true },
    );

    const trimmed = stdout.trim();
    if (trimmed.startsWith("OK:")) {
      return res.json({ matched: true, windowTitle: trimmed.slice(3), needle });
    }
    if (trimmed === "NO_MATCH") {
      return res.json({
        matched: false,
        needle,
        reason: `No terminal window found containing "${needle}" in its title.`,
      });
    }
    return res.json({ matched: false, needle, reason: trimmed || "Unknown result." });
  } catch (error) {
    console.error("Focus terminal failed:", error);
    return res.status(500).json({ error: error.message || "Focus request failed." });
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
