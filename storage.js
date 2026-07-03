import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "data");
const DB_FILE = join(DATA_DIR, "db.json");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const DEFAULT_REPLY_POLICY =
  "Ton professionnel, chaleureux et naturel. Répondre en français. Remercier le client, rester court, ne jamais être agressif. Pour un avis négatif, reconnaître le problème, s'excuser si nécessaire et proposer un échange direct.";

const DEFAULT_EMAIL_TEMPLATE =
  "Bonjour {{contactName}},\n\nVous avez {{pendingReviews}} avis Google à traiter cette semaine, avec une moyenne de {{averageRating}}/5.\n\nCliquez ici pour les relire, modifier les réponses proposées et publier celles qui vous conviennent : {{loginUrl}}\n\nBonne journée,\nAgent Pilot Avis";

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export async function ensureDb() {
  if (isSupabaseConfigured()) {
    await ensureSupabaseSeed();
    return;
  }
  await ensureLocalDb();
}

export async function loadDb() {
  if (isSupabaseConfigured()) return loadSupabaseDb();
  return loadLocalDb();
}

export async function saveDb(db) {
  if (isSupabaseConfigured()) {
    await saveSupabaseDb(db);
    return;
  }
  await saveLocalDb(db);
}

async function ensureLocalDb() {
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(DB_FILE)) return;
  await saveLocalDb(createSeedDb());
}

async function loadLocalDb() {
  await ensureLocalDb();
  const db = normalizeDb(JSON.parse(await readFile(DB_FILE, "utf8")));
  await saveLocalDb(db);
  return db;
}

async function saveLocalDb(db) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(normalizeDb(db), null, 2));
}

async function ensureSupabaseSeed() {
  const clients = await supabaseSelect("clients", "id=eq.client_demo");
  if (clients.length) return;
  const seed = createSeedDb();
  await saveSupabaseDb(seed);
}

async function loadSupabaseDb() {
  const [clients, reviews, sessions, emailLogs, googleTokens] = await Promise.all([
    supabaseSelect("clients"),
    supabaseSelect("reviews"),
    supabaseSelect("sessions"),
    supabaseSelect("email_logs"),
    supabaseSelect("google_tokens").catch(() => [])
  ]);

  return normalizeDb({
    clients: clients.map(clientFromRow),
    reviews: reviews.map(reviewFromRow),
    sessions: sessions.map(sessionFromRow),
    emailLogs: emailLogs.map(emailLogFromRow),
    googleTokens: googleTokens.map(googleTokenFromRow)
  });
}

async function saveSupabaseDb(db) {
  const normalized = normalizeDb(db);
  await Promise.all([
    upsertRows("clients", normalized.clients.map(clientToRow)),
    upsertRows("reviews", normalized.reviews.map(reviewToRow)),
    upsertRows("email_logs", normalized.emailLogs.map(emailLogToRow)),
    upsertRows("google_tokens", normalized.googleTokens.map(googleTokenToRow)),
    syncSessionRows(normalized.sessions)
  ]);
}

async function syncSessionRows(sessions) {
  const existing = await supabaseSelect("sessions");
  const keep = new Set(sessions.map((session) => session.token));
  const toDelete = existing.filter((session) => !keep.has(session.token)).map((session) => session.token);
  await Promise.all([
    upsertRows("sessions", sessions.map(sessionToRow)),
    ...toDelete.map((token) => supabaseDelete("sessions", `token=eq.${encodeURIComponent(token)}`))
  ]);
}

async function upsertRows(table, rows) {
  if (!rows.length) return;
  await supabaseRequest(`${table}?on_conflict=${table === "sessions" ? "token" : "id"}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: rows
  });
}

async function supabaseSelect(table, query = "select=*") {
  return supabaseRequest(`${table}?${query}`);
}

async function supabaseDelete(table, query) {
  await supabaseRequest(`${table}?${query}`, { method: "DELETE" });
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Erreur Supabase ${response.status}: ${text}`);
  }

  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function createSeedDb() {
  const now = new Date().toISOString();
  return {
    clients: [
      {
        id: "client_demo",
        businessName: "Restaurant Demo",
        contactName: "Camille Martin",
        email: "client@demo.fr",
        passwordHash: hashPassword("demo123"),
        status: "active",
        googleLocationId: "",
        syncFromDate: "2026-07-01",
        replyPolicy: DEFAULT_REPLY_POLICY,
        emailTemplate: DEFAULT_EMAIL_TEMPLATE,
        createdAt: now
      }
    ],
    reviews: [
      {
        id: "review_1",
        clientId: "client_demo",
        author: "Laura P.",
        rating: 5,
        text: "Super accueil, service rapide et plats excellents. Nous reviendrons.",
        suggestedReply:
          "Bonjour Laura, merci beaucoup pour votre avis. Nous sommes ravis que l'accueil, le service et les plats vous aient plu. Au plaisir de vous revoir prochainement.",
        status: "pending",
        publishedReply: "",
        createdAt: now
      },
      {
        id: "review_2",
        clientId: "client_demo",
        author: "Mehdi B.",
        rating: 3,
        text: "Bon repas mais attente un peu longue samedi soir.",
        suggestedReply:
          "Bonjour Mehdi, merci pour votre retour. Nous sommes heureux que le repas vous ait plu et nous sommes désolés pour l'attente samedi soir. Votre remarque va nous aider à mieux organiser le service lors des périodes chargées.",
        status: "pending",
        publishedReply: "",
        createdAt: now
      }
    ],
    sessions: [],
    emailLogs: [],
    googleTokens: []
  };
}

function normalizeDb(db) {
  const normalized = {
    clients: db.clients || [],
    reviews: db.reviews || [],
    sessions: db.sessions || [],
    emailLogs: db.emailLogs || [],
    googleTokens: db.googleTokens || []
  };

  for (const client of normalized.clients) {
    client.syncFromDate ||= new Date().toISOString().slice(0, 10);
    client.replyPolicy ||= DEFAULT_REPLY_POLICY;
    client.emailTemplate ||= DEFAULT_EMAIL_TEMPLATE;
    client.status ||= "active";
    client.googleLocationId ||= "";
  }

  return normalized;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function clientToRow(client) {
  return {
    id: client.id,
    business_name: client.businessName,
    contact_name: client.contactName,
    email: client.email,
    password_hash: client.passwordHash,
    status: client.status,
    google_location_id: client.googleLocationId,
    sync_from_date: client.syncFromDate,
    reply_policy: client.replyPolicy,
    email_template: client.emailTemplate,
    created_at: client.createdAt
  };
}

function clientFromRow(row) {
  return {
    id: row.id,
    businessName: row.business_name,
    contactName: row.contact_name,
    email: row.email,
    passwordHash: row.password_hash,
    status: row.status,
    googleLocationId: row.google_location_id,
    syncFromDate: row.sync_from_date,
    replyPolicy: row.reply_policy,
    emailTemplate: row.email_template,
    createdAt: row.created_at
  };
}

function reviewToRow(review) {
  return {
    id: review.id,
    google_review_id: review.googleReviewId || null,
    client_id: review.clientId,
    author: review.author,
    rating: review.rating,
    text: review.text,
    suggested_reply: review.suggestedReply,
    status: review.status,
    published_reply: review.publishedReply || "",
    source: review.source || "manual",
    created_at: review.createdAt,
    published_at: review.publishedAt || null
  };
}

function reviewFromRow(row) {
  return {
    id: row.id,
    googleReviewId: row.google_review_id,
    clientId: row.client_id,
    author: row.author,
    rating: row.rating,
    text: row.text,
    suggestedReply: row.suggested_reply,
    status: row.status,
    publishedReply: row.published_reply,
    source: row.source,
    createdAt: row.created_at,
    publishedAt: row.published_at
  };
}

function sessionToRow(session) {
  return {
    token: session.token,
    role: session.role,
    user_id: session.userId,
    expires_at: session.expiresAt
  };
}

function sessionFromRow(row) {
  return {
    token: row.token,
    role: row.role,
    userId: row.user_id,
    expiresAt: row.expires_at
  };
}

function emailLogToRow(emailLog) {
  return {
    id: emailLog.id,
    client_id: emailLog.clientId,
    recipient: emailLog.to,
    subject: emailLog.subject,
    body: emailLog.body,
    status: emailLog.status,
    error: emailLog.error || null,
    created_at: emailLog.createdAt,
    sent_at: emailLog.sentAt || null
  };
}

function emailLogFromRow(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    to: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at
  };
}

function googleTokenToRow(token) {
  return {
    id: token.id || "primary",
    access_token: token.accessToken || "",
    refresh_token: token.refreshToken || "",
    expires_at: token.expiresAt || null,
    scope: token.scope || "",
    connected_email: token.connectedEmail || "",
    created_at: token.createdAt || new Date().toISOString(),
    updated_at: token.updatedAt || new Date().toISOString()
  };
}

function googleTokenFromRow(row) {
  return {
    id: row.id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scope: row.scope,
    connectedEmail: row.connected_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
