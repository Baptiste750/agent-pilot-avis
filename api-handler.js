import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import { ensureDb, loadDb, saveDb, isSupabaseConfigured, deleteClientCascade } from "./storage.js";

const PORT = Number(process.env.PORT || 4173);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@agentpilotavis.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || "Notori";
const APP_BASE_URL = process.env.APP_BASE_URL || `http://127.0.0.1:${PORT}`;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${APP_BASE_URL.replace(/\/$/, "")}/api/google/callback`;
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/userinfo.email";
const DEFAULT_EMAIL_SUBJECT_TEMPLATE = "Vos réponses aux avis Google sont prêtes - {{businessName}}";
const DEFAULT_EMAIL_BODY_TEMPLATE =
  "Bonjour {{contactName}},\n\nVous avez {{pendingReviews}} avis Google à traiter cette semaine, avec une moyenne de {{averageRating}}/5.\n\nCliquez ici pour les relire, modifier les réponses proposées et publier celles qui vous conviennent : {{loginUrl}}\n\nBonne journée,\nNotori";

function getMockGoogleReviews() {
  return [
    {
      googleReviewId: "google_demo_1",
      locationId: "demo-location",
      author: "Sophie L.",
      rating: 5,
      text: "Très bonne adresse, personnel souriant et cuisine généreuse.",
      answered: false,
      ownerReply: "",
      createdAt: "2026-07-01T09:15:00.000Z"
    },
    {
      googleReviewId: "google_demo_2",
      locationId: "demo-location",
      author: "Nicolas R.",
      rating: 2,
      text: "Déçu par l'attente, nous avons patienté presque 40 minutes avant d'être servis.",
      answered: false,
      ownerReply: "",
      createdAt: "2026-07-01T19:40:00.000Z"
    },
    {
      googleReviewId: "google_demo_3",
      locationId: "demo-location",
      author: "Amina D.",
      rating: 4,
      text: "Bonne expérience dans l'ensemble, les desserts étaient excellents.",
      answered: true,
      ownerReply: "Bonjour Amina, merci pour votre retour. Nous sommes ravis que vous ayez apprécié votre expérience et nos desserts.",
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

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
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

function canAccessClient(session, clientId) {
  return session.role === "admin" || session.userId === clientId;
}

async function fetchUnansweredGoogleReviews(db, client) {
  if (isGoogleConfigured()) {
    const googleLocation = await resolveGoogleLocationForReviews(db, client);
    if (!googleLocation) {
      throw new Error("La fiche Google du client n'est pas sélectionnée ou doit être resélectionnée.");
    }
    return fetchRealGoogleReviews(db, client, googleLocation);
  }

  const googleReviews = getMockGoogleReviews();
  const locationId = client.googleLocationId || "demo-location";
  const fromDate = client.syncFromDate ? new Date(`${client.syncFromDate}T00:00:00.000Z`) : null;
  return googleReviews.filter((review) => {
    const reviewDate = new Date(review.createdAt);
    return review.locationId === locationId && !review.answered && (!fromDate || reviewDate >= fromDate);
  });
}

function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function getGoogleToken(db, clientId) {
  return db.googleTokens?.find((token) => token.clientId === clientId || token.id === clientId) || null;
}

function parseGoogleLocationId(value) {
  const match = String(value || "").match(/accounts\/([^/]+)\/locations\/([^/]+)/);
  if (!match) return null;
  return { accountId: match[1], locationId: match[2], name: `accounts/${match[1]}/locations/${match[2]}` };
}

function googleLocationIdFromName(name) {
  return String(name || "").split("/").filter(Boolean).at(-1) || "";
}

function starRatingToNumber(starRating) {
  return { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[starRating] || Number(starRating) || 5;
}

async function googleRequest(db, clientId, url, options = {}) {
  const accessToken = await getGoogleAccessToken(db, clientId);
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Erreur Google ${response.status}: ${text}`);
  }
  if (response.status === 204) return {};
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function googleReviewIdFromName(name) {
  return String(name || "").split("/").filter(Boolean).at(-1) || "";
}

async function getGoogleAccessToken(db, clientId) {
  const token = getGoogleToken(db, clientId);
  if (!token?.refreshToken) throw new Error("Google Business Profile n'est pas encore connecté.");

  if (token.accessToken && token.expiresAt && new Date(token.expiresAt).getTime() > Date.now() + 60_000) {
    return token.accessToken;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: token.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Impossible de rafraîchir Google: ${data.error_description || data.error || "erreur inconnue"}`);

  token.accessToken = data.access_token;
  token.expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  token.updatedAt = new Date().toISOString();
  await saveDb(db);
  return token.accessToken;
}

async function fetchGoogleEmail(accessToken) {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return "";
    const data = await response.json().catch(() => ({}));
    return data.email || "";
  } catch {
    return "";
  }
}

function fullGoogleLocationName(accountName, locationName) {
  if (parseGoogleLocationId(locationName)) return locationName;
  if (!accountName || !locationName) return locationName || "";
  return `${accountName}/${locationName}`;
}

async function listGoogleLocations(db, clientId) {
  const accountsData = await googleRequest(db, clientId, "https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
  const accounts = accountsData.accounts || [];
  const locations = [];

  for (const account of accounts) {
    if (!account.name) continue;
    const data = await googleRequest(
      db,
      clientId,
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress`
    );
    for (const location of data.locations || []) {
      const name = fullGoogleLocationName(account.name, location.name);
      locations.push({
        name,
        title: location.title || location.name,
        accountName: account.accountName || account.name,
        address: formatGoogleAddress(location.storefrontAddress)
      });
    }
  }

  return locations.sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

async function resolveGoogleLocationForReviews(db, client) {
  const parsed = parseGoogleLocationId(client.googleLocationId || "");
  if (parsed) return parsed;

  const storedLocationId = googleLocationIdFromName(client.googleLocationId);
  if (!storedLocationId) return null;

  const locations = await listGoogleLocations(db, client.id);
  const match = locations.find((location) => googleLocationIdFromName(location.name) === storedLocationId);
  if (!match) return null;

  client.googleLocationId = match.name;
  return parseGoogleLocationId(match.name);
}

function formatGoogleAddress(address) {
  if (!address) return "";
  return [
    ...(address.addressLines || []),
    [address.postalCode, address.locality].filter(Boolean).join(" "),
    address.administrativeArea,
    address.regionCode
  ]
    .filter(Boolean)
    .join(", ");
}

async function fetchRealGoogleReviews(db, client, googleLocation) {
  const data = await googleRequest(
    db,
    client.id,
    `https://mybusiness.googleapis.com/v4/accounts/${googleLocation.accountId}/locations/${googleLocation.locationId}/reviews?pageSize=50&orderBy=updateTime desc`
  );
  const fromDate = client.syncFromDate ? new Date(`${client.syncFromDate}T00:00:00.000Z`) : null;
  return (data.reviews || [])
    .filter((review) => !review.reviewReply?.comment)
    .filter((review) => {
      const createdAt = review.createTime || review.updateTime || new Date().toISOString();
      return !fromDate || new Date(createdAt) >= fromDate;
    })
    .map((review) => ({
      googleReviewId: review.reviewId || googleReviewIdFromName(review.name),
      googleReviewName: review.name,
      locationId: googleLocation.name,
      author: review.reviewer?.displayName || "Client Google",
      rating: starRatingToNumber(review.starRating),
      text: review.comment || "",
      answered: Boolean(review.reviewReply?.comment),
      createdAt: review.createTime || review.updateTime || new Date().toISOString()
    }));
}

async function fetchGoogleReviewsForAudit(db, client, limit = 100) {
  if (isGoogleConfigured() && client.googleLocationId && getGoogleToken(db, client.id)) {
    const googleLocation = await resolveGoogleLocationForReviews(db, client);
    if (!googleLocation) {
      throw new Error("La fiche Google du client doit être sélectionnée avant de lancer l'audit.");
    }

    const reviews = [];
    let pageToken = "";
    while (reviews.length < limit) {
      const params = new URLSearchParams({
        pageSize: "50",
        orderBy: "updateTime desc"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await googleRequest(
        db,
        client.id,
        `https://mybusiness.googleapis.com/v4/accounts/${googleLocation.accountId}/locations/${googleLocation.locationId}/reviews?${params}`
      );
      reviews.push(
        ...(data.reviews || []).map((review) => ({
          googleReviewId: review.reviewId || googleReviewIdFromName(review.name),
          author: review.reviewer?.displayName || "Client Google",
          rating: starRatingToNumber(review.starRating),
          text: review.comment || "",
          answered: Boolean(review.reviewReply?.comment),
          ownerReply: review.reviewReply?.comment || "",
          createdAt: review.createTime || review.updateTime || new Date().toISOString()
        }))
      );
      pageToken = data.nextPageToken || "";
      if (!pageToken || !(data.reviews || []).length) break;
    }
    return reviews.slice(0, limit);
  }

  const storedReviews = db.reviews
    .filter((review) => review.clientId === client.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((review) => ({
      googleReviewId: review.googleReviewId || review.id,
      author: review.author || "Client Google",
      rating: Number(review.rating || 5),
      text: review.text || "",
      answered: review.status === "published" || Boolean(review.publishedReply),
      ownerReply: review.publishedReply || "",
      createdAt: review.createdAt || new Date().toISOString()
    }));

  return storedReviews.length ? storedReviews : getMockGoogleReviews().slice(0, limit);
}

async function replyToGoogleReview(db, owner, review, comment) {
  const googleLocation = parseGoogleLocationId(owner.googleLocationId || "");
  if (!googleLocation || !review.googleReviewId) return;
  await googleRequest(
    db,
    owner.id,
    `https://mybusiness.googleapis.com/v4/accounts/${googleLocation.accountId}/locations/${googleLocation.locationId}/reviews/${review.googleReviewId}/reply`,
    { method: "PUT", body: { comment } }
  );
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

function parseEmailTemplateSetting(client) {
  const rawTemplate = client.emailTemplate || "";
  if (rawTemplate.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawTemplate);
      return {
        subject: parsed.subject || DEFAULT_EMAIL_SUBJECT_TEMPLATE,
        body: parsed.body || DEFAULT_EMAIL_BODY_TEMPLATE
      };
    } catch {
      return {
        subject: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
        body: rawTemplate || DEFAULT_EMAIL_BODY_TEMPLATE
      };
    }
  }

  return {
    subject: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
    body: rawTemplate || DEFAULT_EMAIL_BODY_TEMPLATE
  };
}

function renderEmailText(template, client, summary) {
  const loginUrl = APP_BASE_URL;
  return (template || "")
    .replaceAll("{{contactName}}", client.contactName || client.businessName)
    .replaceAll("{{businessName}}", client.businessName)
    .replaceAll("{{pendingReviews}}", String(summary.pendingReviews))
    .replaceAll("{{totalReviews}}", String(summary.totalReviews))
    .replaceAll("{{averageRating}}", String(summary.averageRating))
    .replaceAll("{{loginUrl}}", loginUrl);
}

function renderEmailSubject(client, summary) {
  return renderEmailText(parseEmailTemplateSetting(client).subject, client, summary);
}

function renderEmailTemplate(client, summary) {
  return renderEmailText(parseEmailTemplateSetting(client).body, client, summary);
}

function ratingDistribution(reviews) {
  return [1, 2, 3, 4, 5].reduce((acc, rating) => {
    acc[rating] = reviews.filter((review) => Number(review.rating) === rating).length;
    return acc;
  }, {});
}

function findThemeMatches(reviews, dictionary) {
  return Object.entries(dictionary)
    .map(([theme, words]) => ({
      theme,
      count: reviews.filter((review) => words.some((word) => `${review.text} ${review.ownerReply || ""}`.toLowerCase().includes(word))).length
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function fallbackAudit(client, reviews) {
  const total = reviews.length;
  const average = total ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / total : 0;
  const answered = reviews.filter((review) => review.answered || review.ownerReply).length;
  const positiveThemes = findThemeMatches(reviews, {
    accueil: ["accueil", "souriant", "sympa", "gentil", "aimable"],
    service: ["service", "rapide", "efficace", "conseil", "professionnel"],
    qualité: ["qualité", "excellent", "parfait", "super", "beau", "bon"],
    choix: ["choix", "rayon", "variété", "stock", "produit"],
    prix: ["prix", "tarif", "cher", "abordable"]
  });
  const negativeThemes = findThemeMatches(
    reviews.filter((review) => Number(review.rating) <= 3 || /attente|cher|déçu|accueil|caisse|problème|mauvais/i.test(review.text || "")),
    {
      attente: ["attente", "attendre", "long", "retard"],
      accueil: ["accueil", "désagréable", "souriant", "froid", "impoli"],
      prix: ["prix", "cher", "tarif", "caisse"],
      service: ["service", "conseil", "erreur", "problème"],
      disponibilité: ["stock", "disponible", "rupture", "manque"]
    }
  );
  const strengths = positiveThemes.length ? positiveThemes.map((item) => item.theme) : ["qualité de l'expérience client", "satisfaction globale"];
  const weaknesses = negativeThemes.length ? negativeThemes.map((item) => item.theme) : ["points d'amélioration peu récurrents"];
  return {
    source: isGoogleConfigured() ? "google" : "local",
    reviewCount: total,
    averageRating: Number(average.toFixed(1)),
    responseRate: total ? Math.round((answered / total) * 100) : 0,
    distribution: ratingDistribution(reviews),
    strengths,
    weaknesses,
    ownerReplyStyle: answered
      ? "Les réponses existantes donnent une base de ton, mais doivent rester plus variées, plus naturelles et mieux adaptées à la note."
      : "La fiche répond peu ou pas aux avis : le futur prompt doit installer un ton clair, stable et humain.",
    summary: `${client.businessName} présente une moyenne de ${Number(average.toFixed(1))}/5 sur ${total} avis analysé${total > 1 ? "s" : ""}. Les points forts les plus visibles concernent ${strengths.slice(0, 2).join(" et ")}, tandis que les sujets à surveiller sont ${weaknesses.slice(0, 2).join(" et ")}. Le taux de réponse propriétaire est d'environ ${total ? Math.round((answered / total) * 100) : 0} %, ce qui servira de base pour améliorer la régularité et la qualité des réponses.`,
    questionnaireAngles: [...new Set([...strengths, ...weaknesses])].slice(0, 6)
  };
}

function compactReviewsForAi(reviews) {
  return reviews.slice(0, 100).map((review) => ({
    rating: Number(review.rating || 5),
    text: String(review.text || "").slice(0, 700),
    ownerReply: String(review.ownerReply || "").slice(0, 500),
    answered: Boolean(review.answered || review.ownerReply),
    createdAt: review.createdAt
  }));
}

function extractJsonObject(text) {
  const source = String(text || "").trim();
  try {
    return JSON.parse(source);
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function buildAudit(client, reviews) {
  const fallback = fallbackAudit(client, reviews);
  if (!OPENAI_API_KEY || !reviews.length) return fallback;

  const prompt = [
    "Analyse les 100 derniers avis Google d'un commerce pour préparer un prompt de réponses aux avis.",
    "Tu dois répondre uniquement en JSON valide, sans markdown.",
    "Format attendu :",
    '{"summary":"court paragraphe en français","strengths":["..."],"weaknesses":["..."],"ownerReplyStyle":"...","questionnaireAngles":["..."]}',
    "",
    `Commerce : ${client.businessName}`,
    `Statistiques calculées : ${JSON.stringify({
      reviewCount: fallback.reviewCount,
      averageRating: fallback.averageRating,
      responseRate: fallback.responseRate,
      distribution: fallback.distribution
    })}`,
    `Avis : ${JSON.stringify(compactReviewsForAi(reviews))}`,
    "",
    "Contraintes : la synthèse doit être courte, utile pour le client, mentionner points forts, points faibles et qualité/fréquence des réponses propriétaire."
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
        temperature: 0.2,
        max_output_tokens: 1200
      })
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    const parsed = extractJsonObject(extractOpenAIText(data));
    if (!parsed) return fallback;
    return {
      ...fallback,
      summary: parsed.summary || fallback.summary,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6) : fallback.strengths,
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.slice(0, 6) : fallback.weaknesses,
      ownerReplyStyle: parsed.ownerReplyStyle || fallback.ownerReplyStyle,
      questionnaireAngles: Array.isArray(parsed.questionnaireAngles) ? parsed.questionnaireAngles.slice(0, 8) : fallback.questionnaireAngles
    };
  } catch {
    return fallback;
  }
}

function defaultCalibrationReviews(audit, client) {
  const weak = audit.weaknesses?.[0] || "l'attente";
  const strong = audit.strengths?.[0] || "l'accueil";
  return [
    { rating: 5, text: `Très bonne expérience chez ${client.businessName}, ${strong} au rendez-vous et équipe agréable.`, intent: "positif avec commentaire" },
    { rating: 5, text: "5 étoiles, rien à redire.", intent: "positif sans détail" },
    { rating: 4, text: `Très bien dans l'ensemble, mais petit point à améliorer sur ${weak}.`, intent: "mitigé positif" },
    { rating: 4, text: "Bonne expérience, je recommande.", intent: "positif court" },
    { rating: 3, text: `Correct, mais j'ai trouvé que ${weak} pouvait être mieux géré.`, intent: "mitigé constructif" },
    { rating: 3, text: "Avis partagé, il y a du bon mais aussi quelques détails à revoir.", intent: "mitigé vague" },
    { rating: 2, text: `Déçu par mon passage, notamment à cause de ${weak}.`, intent: "négatif précis" },
    { rating: 1, text: "Mauvaise expérience, je ne pense pas revenir.", intent: "négatif général" },
    { rating: 2, text: "Accueil froid et problème au moment de payer.", intent: "négatif accueil/caisse" },
    { rating: 1, text: "Très déçu, aucun sens du client.", intent: "négatif agressif" }
  ];
}

function fallbackReplyPrompt(client, audit, answers = {}) {
  const businessAliases = String(answers.businessAliases || client.businessName)
    .split("\n")
    .flatMap((line) => line.split(","))
    .map((line) => line.trim())
    .filter(Boolean);
  const aliases = businessAliases.length ? businessAliases : [client.businessName, "notre équipe", "l'établissement"];
  const tone = answers.tone || "humain, chaleureux, professionnel et naturel";
  const responseLength = answers.responseLength || "2 à 4 phrases maximum";
  return [
    "Objectif :",
    `Répondre aux avis Google de ${client.businessName} avec un ton ${tone}.`,
    "",
    "Contexte du commerce :",
    answers.businessType ? `* Type d'activité : ${answers.businessType}` : "",
    answers.businessTypeDetail ? `* Précision métier : ${answers.businessTypeDetail}` : "",
    answers.companySize ? `* Taille de la structure : ${answers.companySize}` : "",
    answers.structureDetails ? `* Taille concrète et lieux : ${answers.structureDetails}` : "",
    answers.employeeCount ? `* Nombre d'employés : ${answers.employeeCount}` : "",
    answers.locationCount ? `* Nombre d'établissements : ${answers.locationCount}` : "",
    answers.customerFacingTeam ? `* Équipe en contact client : ${answers.customerFacingTeam}` : "",
    answers.customerTypes ? `* Type de clientèle : ${answers.customerTypes}` : "",
    answers.positioning ? `* Positionnement : ${answers.positioning}` : "",
    answers.claimedStrengths ? `* Points forts revendiqués : ${answers.claimedStrengths}` : "",
    answers.operationalConstraints ? `* Contraintes ou réalités du terrain : ${answers.operationalConstraints}` : "",
    "",
    "Style général :",
    "* Toujours commencer par : Bonjour [prénom],",
    "* Remercier systématiquement la personne, même si l'avis contient uniquement une note sans commentaire.",
    "* Écrire comme une vraie personne, pas comme un message automatique.",
    "* Rester simple, naturel et direct.",
    `* Faire des réponses courtes : ${responseLength}.`,
    "* Varier les formulations d'une réponse à l'autre.",
    "* Adapter l'intensité de la réponse à la note et au contenu de l'avis.",
    "* Ne jamais inventer de détail absent de l'avis.",
    "* Garder une orthographe impeccable et un ton respectueux.",
    answers.styleWords ? `* Les réponses doivent sonner : ${answers.styleWords}.` : "",
    "",
    "Vocabulaire à varier :",
    ...aliases.map((alias) => `* ${alias}`),
    "",
    "Points forts à valoriser naturellement :",
    ...(audit.strengths || []).map((item) => `* ${item}`),
    answers.claimedStrengths ? `* Points forts déclarés par le client : ${answers.claimedStrengths}` : "",
    "",
    "Points faibles à traiter avec tact :",
    ...(audit.weaknesses || []).map((item) => `* ${item}`),
    answers.knownWeakness ? `* Contexte fourni par le client : ${answers.knownWeakness}` : "",
    answers.weaknessContext ? `* Intention à transmettre : ${answers.weaknessContext}` : "",
    "",
    "Avis positifs : remercier chaleureusement, mentionner un détail naturel si utile, inviter à revenir sans insister.",
    "Avis 4 étoiles : remercier, rester positif et demander simplement ce qui pourrait être amélioré si cela semble naturel.",
    "Avis mitigés : rester ouvert, constructif et inviter la personne à préciser son retour.",
    "Avis négatifs : reconnaître la déception sans se justifier longuement, ne jamais accuser le client, ne jamais promettre de compensation, proposer un échange direct si nécessaire.",
    "",
    answers.emojiPolicy ? `Émojis : ${answers.emojiPolicy}` : "Émojis : sobres, surtout sur les avis positifs ou neutres, jamais automatiques.",
    answers.mustAvoid ? `Formules à éviter : ${answers.mustAvoid}` : "Formules à éviter : votre satisfaction est notre priorité, toute formule trop froide, corporate ou automatique.",
    answers.forbiddenPromises ? `Promesses interdites : ${answers.forbiddenPromises}` : "Promesses interdites : ne pas promettre de remboursement, geste commercial ou compensation si ce n'est pas certain.",
    answers.extraGuidelines ? `Consignes spécifiques du client : ${answers.extraGuidelines}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateReplyProfile(client, audit, answers = {}) {
  const fallbackPrompt = fallbackReplyPrompt(client, audit, answers);
  const fallbackExamples = defaultCalibrationReviews(audit, client);
  if (!OPENAI_API_KEY) {
    return {
      summary: `Le prompt proposé reprend les forces identifiées (${(audit.strengths || []).slice(0, 2).join(", ")}) et encadre les sujets sensibles (${(audit.weaknesses || []).slice(0, 2).join(", ")}).`,
      prompt: fallbackPrompt,
      examples: fallbackExamples
    };
  }

  const input = [
    "Crée un prompt opérationnel en français pour un agent IA qui répond aux avis Google.",
    "Réponds uniquement en JSON valide, sans markdown.",
    "Format : {\"summary\":\"...\",\"prompt\":\"...\",\"examples\":[{\"rating\":5,\"text\":\"...\",\"intent\":\"...\"}]}",
    "",
    "Contraintes indispensables du prompt :",
    "- orthographe impeccable, ton correct, humain, professionnel et naturel",
    "- commencer par Bonjour [prénom],",
    "- remercier systématiquement",
    "- réponses courtes, 2 à 4 phrases",
    "- varier les formulations",
    "- ne jamais inventer de détail",
    "- avis négatifs : calme, respectueux, non défensif, pas de promesse commerciale",
    "- intégrer le style des anciennes réponses si pertinent, mais corriger les défauts",
    "- exploiter le profil du commerce pour adapter le vocabulaire, les exemples, les limites et les formulations",
    "- prévoir les cas : 5 étoiles avec/sans commentaire, 4 étoiles, 3 étoiles, négatifs, agressifs, problème caisse/prix/accueil",
    "",
    "Les exemples doivent contenir exactement 10 avis crédibles : au moins 3 négatifs, au moins 2 mitigés, au moins 3 positifs, inspirés des forces/faiblesses de l'audit.",
    "",
    `Commerce : ${client.businessName}`,
    `Audit : ${JSON.stringify(audit)}`,
    `Réponses questionnaire : ${JSON.stringify(answers)}`,
    "",
    "Le prompt final doit être détaillé, prêt à copier dans un champ système, avec listes de règles et exemples d'intention."
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
        input,
        temperature: 0.35,
        max_output_tokens: 3500
      })
    });
    if (!response.ok) throw new Error("OpenAI unavailable");
    const data = await response.json();
    const parsed = extractJsonObject(extractOpenAIText(data));
    if (!parsed?.prompt) throw new Error("Invalid profile JSON");
    return {
      summary: parsed.summary || "Prompt proposé à partir de l'audit et du questionnaire.",
      prompt: parsed.prompt,
      examples: Array.isArray(parsed.examples) && parsed.examples.length ? parsed.examples.slice(0, 10) : fallbackExamples
    };
  } catch {
    return {
      summary: `Le prompt proposé reprend les forces identifiées (${(audit.strengths || []).slice(0, 2).join(", ")}) et encadre les sujets sensibles (${(audit.weaknesses || []).slice(0, 2).join(", ")}).`,
      prompt: fallbackPrompt,
      examples: fallbackExamples
    };
  }
}

async function generateSampleReply(client, prompt, review) {
  if (!OPENAI_API_KEY) {
    return suggestReply(review.text || "", Number(review.rating || 5), prompt || client.replyPolicy || "");
  }

  const input = [
    `Commerce : ${client.businessName}`,
    "Prompt de style à respecter :",
    prompt || client.replyPolicy || "",
    "",
    `Note : ${Number(review.rating || 5)}/5`,
    `Avis : ${review.text || ""}`,
    "",
    "Rédige uniquement la réponse Google proposée. Pas de titre, pas d'explication."
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
        input,
        temperature: 0.35,
        max_output_tokens: 350
      })
    });
    if (!response.ok) throw new Error("OpenAI unavailable");
    const data = await response.json();
    return extractOpenAIText(data) || suggestReply(review.text || "", Number(review.rating || 5), prompt || client.replyPolicy || "");
  } catch {
    return suggestReply(review.text || "", Number(review.rating || 5), prompt || client.replyPolicy || "");
  }
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

  if (url.pathname === "/api/google/callback" && req.method === "GET") {
    const expectedState = getCookie(req, "google_oauth_state");
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!expectedState || state !== expectedState || !code) {
      redirect(res, `${APP_BASE_URL}?google=error`);
      return;
    }
    const clientId = state.split(":")[0];

    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: GOOGLE_REDIRECT_URI
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error_description || data.error || "Erreur OAuth Google.");

      const db = await loadDb();
      const client = db.clients.find((item) => item.id === clientId);
      if (!client) throw new Error("Client introuvable pour la connexion Google.");

      const existing = getGoogleToken(db, client.id);
      const token = existing || { id: client.id, clientId: client.id, createdAt: new Date().toISOString() };
      token.clientId = client.id;
      token.accessToken = data.access_token || token.accessToken || "";
      token.refreshToken = data.refresh_token || token.refreshToken || "";
      token.expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
      token.scope = data.scope || GOOGLE_SCOPE;
      token.connectedEmail = (await fetchGoogleEmail(token.accessToken)) || token.connectedEmail || "";
      token.updatedAt = new Date().toISOString();
      if (!existing) db.googleTokens.push(token);
      await saveDb(db);

      res.writeHead(302, {
        location: `${APP_BASE_URL}?google=connected`,
        "set-cookie": "google_oauth_state=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
      });
      res.end();
    } catch (error) {
      console.error(error);
      redirect(res, `${APP_BASE_URL}?google=error`);
    }
    return;
  }

  const session = await getSession(req);
  if (!session) {
    json(res, 401, { error: "Non connecté." });
    return;
  }

  const db = await loadDb();

  if (url.pathname === "/api/google/status" && req.method === "GET") {
    const clientId = session.role === "admin" ? url.searchParams.get("clientId") : session.userId;
    if (!clientId || !canAccessClient(session, clientId)) return json(res, 403, { error: "Accès refusé." });
    const client = db.clients.find((item) => item.id === clientId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    const token = getGoogleToken(db, clientId);
    json(res, 200, {
      configured: isGoogleConfigured(),
      connected: Boolean(token?.refreshToken),
      connectedEmail: token?.connectedEmail || "",
      scope: token?.scope || "",
      googleLocationId: client.googleLocationId || ""
    });
    return;
  }

  if (url.pathname === "/api/google/start" && req.method === "GET") {
    if (session.role !== "client") return json(res, 403, { error: "Seul le client peut connecter son compte Google." });
    if (!isGoogleConfigured()) return json(res, 400, { error: "GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET ne sont pas configurés." });
    const state = `${session.userId}:${randomBytes(24).toString("hex")}`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GOOGLE_SCOPE);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);
    res.writeHead(302, {
      location: authUrl.toString(),
      "set-cookie": `google_oauth_state=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/google/locations" && req.method === "GET") {
    const clientId = session.role === "admin" ? url.searchParams.get("clientId") : session.userId;
    if (!clientId || !canAccessClient(session, clientId)) return json(res, 403, { error: "Accès refusé." });
    const locations = await listGoogleLocations(db, clientId);
    json(res, 200, { locations });
    return;
  }

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

  if (url.pathname === "/api/client/google-location" && req.method === "PATCH") {
    if (session.role !== "client") return json(res, 403, { error: "Accès refusé." });
    const body = await readBody(req);
    const client = db.clients.find((item) => item.id === session.userId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    client.googleLocationId = body.googleLocationId || "";
    await saveDb(db);
    json(res, 200, { client: publicClient(client) });
    return;
  }

  if (url.pathname === "/api/client/password" && req.method === "PATCH") {
    if (session.role !== "client") return json(res, 403, { error: "Accès refusé." });
    const body = await readBody(req);
    const client = db.clients.find((item) => item.id === session.userId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    if (!verifyPassword(body.currentPassword || "", client.passwordHash)) {
      return json(res, 400, { error: "Mot de passe actuel incorrect." });
    }
    if (String(body.newPassword || "").length < 8) {
      return json(res, 400, { error: "Le nouveau mot de passe doit contenir au moins 8 caractères." });
    }
    const currentToken = getCookie(req, "session");
    client.passwordHash = hashPassword(body.newPassword);
    db.sessions = db.sessions.filter((item) => item.userId !== client.id || item.token === currentToken);
    await saveDb(db);
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/client/reply-profile/audit" && req.method === "POST") {
    if (session.role !== "client") return json(res, 403, { error: "Accès refusé." });
    const client = db.clients.find((item) => item.id === session.userId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    try {
      const reviews = await fetchGoogleReviewsForAudit(db, client, 100);
      const audit = await buildAudit(client, reviews);
      json(res, 200, {
        audit,
        reviews: compactReviewsForAi(reviews).slice(0, 12)
      });
    } catch (error) {
      json(res, 500, { error: error.message || "Impossible de lancer l'audit des avis." });
    }
    return;
  }

  if (url.pathname === "/api/client/reply-profile/generate" && req.method === "POST") {
    if (session.role !== "client") return json(res, 403, { error: "Accès refusé." });
    const client = db.clients.find((item) => item.id === session.userId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    const body = await readBody(req);
    const audit = body.audit || fallbackAudit(client, await fetchGoogleReviewsForAudit(db, client, 100));
    const profile = await generateReplyProfile(client, audit, body.answers || {});
    json(res, 200, profile);
    return;
  }

  if (url.pathname === "/api/client/reply-profile/sample-reply" && req.method === "POST") {
    if (session.role !== "client") return json(res, 403, { error: "Accès refusé." });
    const client = db.clients.find((item) => item.id === session.userId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    const body = await readBody(req);
    const reply = await generateSampleReply(client, body.prompt || client.replyPolicy || "", body.review || {});
    json(res, 200, { reply });
    return;
  }

  if (url.pathname === "/api/client/reply-profile" && req.method === "PATCH") {
    if (session.role !== "client") return json(res, 403, { error: "Accès refusé." });
    const client = db.clients.find((item) => item.id === session.userId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    const body = await readBody(req);
    const prompt = String(body.prompt || "").trim();
    if (prompt.length < 200) return json(res, 400, { error: "Le prompt final est trop court pour être enregistré." });
    client.replyPolicy = prompt;
    await saveDb(db);
    json(res, 200, { client: publicClient(client) });
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
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) {
        return json(res, 400, { error: "Email client obligatoire." });
      }
      if (db.clients.some((item) => item.email.toLowerCase() === email)) {
        return json(res, 400, { error: "Un client utilise déjà cet email." });
      }
      if (String(body.password || "").length < 8) {
        return json(res, 400, { error: "Le mot de passe temporaire doit contenir au moins 8 caractères." });
      }
      const client = {
        id: `client_${randomBytes(8).toString("hex")}`,
        businessName: body.businessName || "Nouveau commerce",
        contactName: body.contactName || "",
        email,
        passwordHash: hashPassword(body.password),
        status: "active",
        googleLocationId: body.googleLocationId || "",
        syncFromDate: body.syncFromDate || new Date().toISOString().slice(0, 10),
        replyPolicy:
          body.replyPolicy ||
          "Ton professionnel, chaleureux et naturel. Répondre en français. Remercier le client, rester court, ne jamais être agressif. Pour un avis négatif, reconnaître le problème, s'excuser si nécessaire et proposer un échange direct.",
        emailTemplate:
          body.emailTemplate ||
          JSON.stringify({
            subject: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
            body: DEFAULT_EMAIL_BODY_TEMPLATE
          }),
        createdAt: new Date().toISOString()
      };
      db.clients.push(client);
      await saveDb(db);
      json(res, 201, { client: publicClient(client) });
      return;
    }
  }

  if (url.pathname.startsWith("/api/admin/clients/") && req.method === "DELETE") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });
    const clientId = url.pathname.split("/").at(-1);
    const client = db.clients.find((item) => item.id === clientId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    await deleteClientCascade(clientId);
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname.startsWith("/api/admin/clients/") && req.method === "PATCH") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });
    const clientId = url.pathname.split("/").at(-1);
    const body = await readBody(req);
    const client = db.clients.find((item) => item.id === clientId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    if (body.status) client.status = body.status;
    if (body.email !== undefined) {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return json(res, 400, { error: "Email client obligatoire." });
      const emailAlreadyUsed = db.clients.some((item) => item.id !== client.id && item.email.toLowerCase() === email);
      if (emailAlreadyUsed) return json(res, 400, { error: "Un autre client utilise déjà cet email." });
      client.email = email;
    }
    if (body.password !== undefined && String(body.password || "").trim()) {
      const password = String(body.password || "");
      if (password.length < 8) {
        return json(res, 400, { error: "Le nouveau mot de passe doit contenir au moins 8 caractères." });
      }
      client.passwordHash = hashPassword(password);
      db.sessions = db.sessions.filter((item) => item.userId !== client.id);
    }
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
    if (isGoogleConfigured() && client.googleLocationId && !getGoogleToken(db, client.id)) {
      return json(res, 400, { error: "Le client doit d'abord connecter son compte Google." });
    }

    try {
      const googleReviews = await fetchUnansweredGoogleReviews(db, client);
      let imported = 0;
      const existingGoogleReviewIds = new Set(db.reviews.map((review) => review.googleReviewId).filter(Boolean));
      for (const googleReview of googleReviews) {
        const alreadyImported = existingGoogleReviewIds.has(googleReview.googleReviewId);
        if (alreadyImported) continue;
        existingGoogleReviewIds.add(googleReview.googleReviewId);
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
    } catch (error) {
      console.error(error);
      json(res, 500, { error: error.message || "Erreur pendant la synchronisation Google." });
    }
    return;
  }

  if (url.pathname.startsWith("/api/admin/email-preview/") && req.method === "GET") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });
    const clientId = url.pathname.split("/").at(-1);
    const client = db.clients.find((item) => item.id === clientId);
    if (!client) return json(res, 404, { error: "Client introuvable." });
    const summary = getClientSummary(db, clientId);
    json(res, 200, {
      subject: renderEmailSubject(client, summary),
      body: renderEmailTemplate(client, summary),
      summary
    });
    return;
  }

  if (url.pathname.startsWith("/api/admin/email-logs/") && req.method === "GET") {
    if (session.role !== "admin") return json(res, 403, { error: "Accès refusé." });
    const clientId = url.pathname.split("/").at(-1);
    const emailLogs = db.emailLogs
      .filter((emailLog) => emailLog.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);
    json(res, 200, { emailLogs, smtpConfigured: isSmtpConfigured() });
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
      subject: body.subject || renderEmailSubject(client, summary),
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
      if (review.source === "google-sync" && review.googleReviewId && isGoogleConfigured()) {
        await replyToGoogleReview(db, owner, review, review.suggestedReply);
      }
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

function suggestReply(text, rating) {
  if (rating >= 4) {
    return "Bonjour, merci beaucoup pour votre avis positif. Nous sommes ravis de lire votre retour et espérons vous revoir très bientôt.";
  }
  if (rating === 3) {
    return "Bonjour, merci pour votre retour. Nous prenons votre remarque en compte afin d'améliorer l'expérience de nos clients.";
  }
  return "Bonjour, merci d'avoir pris le temps de partager votre expérience. Nous sommes désolés que celle-ci n'ait pas été à la hauteur de vos attentes et restons disponibles pour échanger avec vous.";
}

export async function initApi() {
  await ensureDb();
}

export function getStorageLabel() {
  return isSupabaseConfigured() ? "Supabase" : "local";
}
