import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import { ensureDb, loadDb, saveDb, isSupabaseConfigured } from "./storage.js";

const PORT = Number(process.env.PORT || 4173);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@agentpilotavis.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || "Agent Pilot Avis";
const APP_BASE_URL = process.env.APP_BASE_URL || `http://127.0.0.1:${PORT}`;

function getMockGoogleReviews() {
  return [
    {
      googleReviewId: "google_demo_1",
      locationId: "demo-location",
      author: "Sophie L.",
      rating: 5,
      text: "Très bonne adresse, personnel souriant et cuisine généreuse.",
      answered: false,
      createdAt: "2026-07-01T09:15:00.000Z"
    },
    {
      googleReviewId: "google_demo_2",
      locationId: "demo-location",
      author: "Nicolas R.",
      rating: 2,
      text: "Déçu par l'attente, nous avons patienté presque 40 minutes avant d'être servis.",
      answered: false,
      createdAt: "2026-07-01T19:40:00.000Z"
    },
    {
      googleReviewId: "google_demo_3",
      locationId: "demo-location",
      author: "Amina D.",
      rating: 4,
      text: "Bonne expérience dans l'ensemble, les desserts étaient excellents.",
      answered: true,
      createdAt: "2026-06-30T12:20:00.000Z"
    }
  ];
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const attempted = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === attempted.length && timingSafeEqual(expected, attempted);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")[1];
}

async function getSession(req) {
  const token = getCookie(req, "session");
  if (!token) return null;
  const db = await loadDb();
  const session = db.sessions.find((item) => item.token === token);
  if (!session || new Date(session.expiresAt) < new Date()) return null;
  return session;
}

async function createSession(role, userId) {
  const db = await loadDb();
  const token = randomBytes(32).toString("hex");
  db.sessions.push({
    token,
    role,
    userId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
  });
  await saveDb(db);
  return token;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function publicClient(client) {
  if (!client) return null;
  return {
    id: client.id,
    businessName: client.businessName,
    contactName: client.contactName,
    email: client.email,
    status: client.status,
    googleLocationId: client.googleLocationId,
    syncFromDate: client.syncFromDate,
    replyPolicy: client.replyPolicy,
    emailTemplate: client.emailTemplate,
    createdAt: client.createdAt
  };
}

async function fetchUnansweredGoogleReviews(client) {
  const googleReviews = getMockGoogleReviews();
  const locationId = client.googleLocationId || "demo-location";
  const fromDate = client.syncFromDate ? new Date(`${client.syncFromDate}T00:00:00.000Z`) : null;
  return googleReviews.filter((review) => {
    const reviewDate = new Date(review.createdAt);
    return review.locationId === locationId && !review.answered && (!fromDate || reviewDate >= fromDate);
  });
}

function getClientSummary(db, clientId) {
  const reviews = db.reviews.filter((review) => review.clientId === clientId);
  const pending = reviews.filter((review) => review.status === "pending");
  const average = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
  return {
    totalReviews: reviews.length,
    pendingReviews: pending.length,
    averageRating: Number(average.toFixed(1))
  };
}

function renderEmailTemplate(client, summary) {
  const loginUrl = APP_BASE_URL;
  return (client.emailTemplate || "")
    .replaceAll("{{contactName}}", client.contactName || client.businessName)
    .replaceAll("{{businessName}}", client.businessName)
    .replaceAll("{{pendingReviews}}", String(summary.pendingReviews))
    .replaceAll("{{totalReviews}}", String(summary.totalReviews))
    .replaceAll("{{averageRating}}", String(summary.averageRating))
    .replaceAll("{{loginUrl}}", loginUrl);
}

export async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.email === ADMIN_EMAIL && body.password === ADMIN_PASSWORD) {
      const token = await createSession("admin", "admin");
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `session=${token}; HttpOnly; Path=/; SameSite=Lax`
      });
      res.end(JSON.stringify({ role: "admin" }));
      return;
    }

    const db = await loadDb();
    const client = db.clients.find((item) => item.email.toLowerCase() === String(body.email || "").toLowerCase());
    if (!client || !verifyPassword(body.password || "", client.passwordHash)) {
      json(res, 401, { error: "Identifiants incorrects." });
      return;
    }
    if (client.status !== "active") {
      json(res, 403, { error: "Votre accès est suspendu." });
      return;
    }
    const token = await createSession("client", client.id);
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": `session=${token}; HttpOnly; Path=/; SameSite=Lax`
    });
    res.end(JSON.stringify({ role: "client" }));
    return;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const token = getCookie(req, "session");
    const db = await loadDb();
    db.sessions = db.sessions.filter((item) => item.token !== token);
    await saveDb(db);
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const session = await getSession(req);
  if (!session) {
    json(res, 401, { error: "Non connecté." });
    return;
  }

  const db = await loadDb();

  if (url.pathname === "/api/me") {
    if (session.role === "admin") {
      json(res, 200, { role: "admin", email: ADMIN_EMAIL });
      return;
    }
    const client = db.clients.find((item) => item.id === session.userId);
    if (!client) {
      json(res, 401, { error: "Session client expirée." });
      return;
    }
    json(res, 200, { role: "client", client: publicClient(client) });
    return;
  }

  if (url.pathname === "/api/admin/clients") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });

    if (req.method === "GET") {
      json(res, 200, { clients: db.clients.map(publicClient) });
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const client = {
        id: `client_${randomBytes(8).toString("hex")}`,
        businessName: body.businessName || "Nouveau commerce",
        contactName: body.contactName || "",
        email: body.email,
        passwordHash: hashPassword(body.password || randomBytes(8).toString("hex")),
        status: "active",
        googleLocationId: body.googleLocationId || "",
        syncFromDate: body.syncFromDate || new Date().toISOString().slice(0, 10),
        replyPolicy:
          body.replyPolicy ||
          "Ton professionnel, chaleureux et naturel. Répondre en français. Remercier le client, rester court, ne jamais être agressif. Pour un avis négatif, reconnaître le problème, s'excuser si nécessaire et proposer un échange direct.",
        emailTemplate:
          body.emailTemplate ||
          "Bonjour {{contactName}},\n\nVous avez {{pendingReviews}} avis Google à traiter cette semaine, avec une moyenne de {{averageRating}}/5.\n\nCliquez ici pour les relire, modifier les réponses proposées et publier celles qui vous conviennent : {{loginUrl}}\n\nBonne journée,\nAgent Pilot Avis",
        createdAt: new Date().toISOString()
      };
      db.clients.push(client);
      await saveDb(db);
      json(res, 201, { client: publicClient(client) });
      return;
    }
  }

  if (url.pathname.startsWith("/api/admin/clients/") && req.method === "PATCH") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });
    const clientId = url.pathname.split("/").at(-1);
    const body = await readBody(req);
    const client = db.clients.find((item) => item.id === clientId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    if (body.status) client.status = body.status;
    if (body.googleLocationId !== undefined) client.googleLocationId = body.googleLocationId;
    if (body.syncFromDate !== undefined) client.syncFromDate = body.syncFromDate;
    if (body.replyPolicy !== undefined) client.replyPolicy = body.replyPolicy;
    if (body.emailTemplate !== undefined) client.emailTemplate = body.emailTemplate;
    await saveDb(db);
    json(res, 200, { client: publicClient(client) });
    return;
  }

  if (url.pathname.startsWith("/api/sync-google-reviews/") && req.method === "POST") {
    const clientId = url.pathname.split("/").at(-1);
    if (session.role !== "admin" && session.userId !== clientId) {
      return json(res, 403, { error: "Accès refusé." });
    }
    const client = db.clients.find((item) => item.id === clientId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    if (client.status !== "active") return json(res, 403, { error: "Ce compte client est suspendu." });

    const googleReviews = await fetchUnansweredGoogleReviews(client);
    let imported = 0;
    for (const googleReview of googleReviews) {
      const alreadyImported = db.reviews.some((review) => review.googleReviewId === googleReview.googleReviewId);
      if (alreadyImported) continue;
      db.reviews.push({
        id: `review_${randomBytes(8).toString("hex")}`,
        googleReviewId: googleReview.googleReviewId,
        clientId: client.id,
        author: googleReview.author || "Client Google",
        rating: Number(googleReview.rating || 5),
        text: googleReview.text || "",
        suggestedReply: await generateSuggestedReply(client, googleReview),
        status: "pending",
        publishedReply: "",
        source: "google-sync",
        createdAt: googleReview.createdAt || new Date().toISOString()
      });
      imported += 1;
    }
    await saveDb(db);
    json(res, 200, { imported, totalFound: googleReviews.length });
    return;
  }

  if (url.pathname.startsWith("/api/admin/email-preview/") && req.method === "GET") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });
    const clientId = url.pathname.split("/").at(-1);
    const client = db.clients.find((item) => item.id === clientId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    const summary = getClientSummary(db, clientId);
    json(res, 200, {
      subject: `Vos réponses aux avis Google sont prêtes - ${client.businessName}`,
      body: renderEmailTemplate(client, summary),
      summary
    });
    return;
  }

  if (url.pathname.startsWith("/api/admin/send-email/") && req.method === "POST") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });
    const clientId = url.pathname.split("/").at(-1);
    const client = db.clients.find((item) => item.id === clientId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    if (client.status !== "active") return json(res, 403, { error: "Ce compte client est suspendu." });
    const body = await readBody(req);
    const summary = getClientSummary(db, clientId);
    const emailLog = {
      id: `email_${randomBytes(8).toString("hex")}`,
      clientId,
      to: client.email,
      subject: body.subject || `Vos réponses aux avis Google sont prêtes - ${client.businessName}`,
      body: body.body || renderEmailTemplate(client, summary),
      status: "pending",
      createdAt: new Date().toISOString()
    };
    if (isSmtpConfigured()) {
      try {
        await sendSmtpEmail({
          to: emailLog.to,
          subject: emailLog.subject,
          body: emailLog.body
        });
        emailLog.status = "sent";
        emailLog.sentAt = new Date().toISOString();
      } catch (error) {
        emailLog.status = "failed";
        emailLog.error = error.message;
      }
    } else {
      emailLog.status = "simulated";
    }
    db.emailLogs.push(emailLog);
    await saveDb(db);
    json(res, 200, { email: emailLog });
    return;
  }

  if (url.pathname === "/api/reviews" && req.method === "GET") {
    const clientId = session.role === "admin" ? url.searchParams.get("clientId") : session.userId;
    const reviews = db.reviews.filter((review) => !clientId || review.clientId === clientId);
    json(res, 200, { reviews });
    return;
  }

  if (url.pathname === "/api/admin/reviews" && req.method === "POST") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });
    const body = await readBody(req);
    const review = {
      id: `review_${randomBytes(8).toString("hex")}`,
      clientId: body.clientId,
      author: body.author || "Client Google",
      rating: Number(body.rating || 5),
      text: body.text || "",
      suggestedReply:
        body.suggestedReply ||
        (await generateSuggestedReply(
          db.clients.find((client) => client.id === body.clientId),
          { text: body.text || "", rating: Number(body.rating || 5), author: body.author || "Client Google" }
        )),
      status: "pending",
      publishedReply: "",
      createdAt: new Date().toISOString()
    };
    db.reviews.push(review);
    await saveDb(db);
    json(res, 201, { review });
    return;
  }

  if (url.pathname.startsWith("/api/reviews/") && req.method === "PATCH") {
    const reviewId = url.pathname.split("/").at(-1);
    const body = await readBody(req);
    const review = db.reviews.find((item) => item.id === reviewId);
    if (!review) return json(res, 404, { error: "Avis introuvable." });
    if (session.role !== "admin" && review.clientId !== session.userId) {
      return json(res, 403, { error: "Accès refusé." });
    }
    const owner = db.clients.find((item) => item.id === review.clientId);
    if (!owner || owner.status !== "active") {
      return json(res, 403, { error: "Ce compte client est suspendu." });
    }
    if (body.suggestedReply !== undefined) review.suggestedReply = body.suggestedReply;
    if (body.status === "published") {
      review.status = "published";
      review.publishedReply = review.suggestedReply;
      review.publishedAt = new Date().toISOString();
    }
    if (body.status === "ignored") review.status = "ignored";
    await saveDb(db);
    json(res, 200, { review });
    return;
  }

  if (url.pathname === "/api/weekly-summary" && req.method === "GET") {
    const clientId = session.role === "admin" ? url.searchParams.get("clientId") : session.userId;
    json(res, 200, getClientSummary(db, clientId));
    return;
  }

  json(res, 404, { error: "Route introuvable." });
}

async function generateSuggestedReply(client, review) {
  if (!OPENAI_API_KEY || !client) {
    return suggestReply(review.text || "", Number(review.rating || 5), client?.replyPolicy || "");
  }

  const sensitiveWarning = detectSensitiveReview(review.text || "")
    ? "\n\nAttention : cet avis semble sensible. La réponse doit rester très prudente et mentionner qu'une vérification humaine est nécessaire."
    : "";

  const prompt = [
    `Commerce : ${client.businessName}`,
    `Auteur de l'avis : ${review.author || "Client Google"}`,
    `Note : ${Number(review.rating || 5)}/5`,
    `Avis : ${review.text || ""}`,
    "",
    "Prompt personnalisé du client :",
    client.replyPolicy || "",
    sensitiveWarning,
    "",
    "Rédige uniquement la réponse proposée à publier sur Google. Ne mets pas de guillemets, pas de titre, pas d'explication."
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: prompt,
        temperature: 0.4,
        max_output_tokens: 350
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`OpenAI indisponible, fallback local utilisé: ${errorText}`);
      return suggestReply(review.text || "", Number(review.rating || 5), client.replyPolicy || "");
    }

    const data = await response.json();
    const text = extractOpenAIText(data);
    return text || suggestReply(review.text || "", Number(review.rating || 5), client.replyPolicy || "");
  } catch (error) {
    console.warn(`OpenAI indisponible, fallback local utilisé: ${error.message}`);
    return suggestReply(review.text || "", Number(review.rating || 5), client.replyPolicy || "");
  }
}

function extractOpenAIText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function detectSensitiveReview(text) {
  const lower = text.toLowerCase();
  return [
    "intoxication",
    "malade",
    "vol",
    "discrimination",
    "raciste",
    "plainte",
    "avocat",
    "tribunal",
    "sécurité",
    "agression",
    "harcèlement",
    "insulte"
  ].some((word) => lower.includes(word));
}

function isSmtpConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

async function sendSmtpEmail({ to, subject, body }) {
  const socket = tlsConnect({
    host: SMTP_HOST,
    port: SMTP_PORT,
    servername: SMTP_HOST
  });

  let buffer = "";
  const readResponse = () =>
    new Promise((resolve, reject) => {
      const onData = (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\r\n").filter(Boolean);
        const lastLine = lines.at(-1);
        if (lastLine && /^\d{3} /.test(lastLine)) {
          socket.off("data", onData);
          const response = buffer;
          buffer = "";
          resolve(response);
        }
      };
      socket.on("data", onData);
      socket.once("error", reject);
    });

  const command = async (line, expectedCodes = ["250"]) => {
    socket.write(`${line}\r\n`);
    const response = await readResponse();
    if (!expectedCodes.some((code) => response.startsWith(code))) {
      throw new Error(`Erreur SMTP après "${line}": ${response.trim()}`);
    }
    return response;
  };

  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  const greeting = await readResponse();
  if (!greeting.startsWith("220")) throw new Error(`Erreur SMTP: ${greeting.trim()}`);

  await command(`EHLO localhost`, ["250"]);
  await command(`AUTH PLAIN ${Buffer.from(`\0${SMTP_USER}\0${SMTP_PASS}`).toString("base64")}`, ["235"]);
  await command(`MAIL FROM:<${SMTP_USER}>`);
  await command(`RCPT TO:<${to}>`, ["250", "251"]);
  await command("DATA", ["354"]);

  const message = [
    `From: ${encodeMailHeader(SMTP_FROM_NAME)} <${SMTP_USER}>`,
    `To: <${to}>`,
    `Subject: ${encodeMailHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body
  ]
    .join("\r\n")
    .replace(/^\./gm, "..");

  socket.write(`${message}\r\n.\r\n`);
  const dataResponse = await readResponse();
  if (!dataResponse.startsWith("250")) throw new Error(`Erreur SMTP envoi: ${dataResponse.trim()}`);
  await command("QUIT", ["221"]);
  socket.end();
}

function encodeMailHeader(value) {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function suggestReply(text, rating, replyPolicy = "") {
  const shortPolicy = replyPolicy ? `\n\nRègles de ton appliquées : ${replyPolicy}` : "";
  if (rating >= 4) {
    return `Bonjour, merci beaucoup pour votre avis positif. Nous sommes ravis de lire votre retour et espérons vous revoir très bientôt.${shortPolicy}`;
  }
  if (rating === 3) {
    return `Bonjour, merci pour votre retour. Nous prenons votre remarque en compte afin d'améliorer l'expérience de nos clients.${shortPolicy}`;
  }
  return `Bonjour, merci d'avoir pris le temps de partager votre expérience. Nous sommes désolés que celle-ci n'ait pas été à la hauteur de vos attentes et restons disponibles pour échanger avec vous.${shortPolicy}`;
}

export async function initApi() {
  await ensureDb();
}

export function getStorageLabel() {
  return isSupabaseConfigured() ? "Supabase" : "local";
}
