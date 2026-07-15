const app = document.querySelector("#app");

const STATUS_LABELS = {
  active: "actif",
  suspended: "suspendu",
  pending: "en attente",
  published: "publié",
  ignored: "ignoré"
};

const DEFAULT_EMAIL_SUBJECT_TEMPLATE = "Vos réponses aux avis Google sont prêtes - {{businessName}}";
const DEFAULT_EMAIL_BODY_TEMPLATE =
  "Bonjour {{contactName}},\n\nVous avez {{pendingReviews}} avis Google à traiter cette semaine, avec une moyenne de {{averageRating}}/5.\n\nCliquez ici pour les relire, modifier les réponses proposées et publier celles qui vous conviennent : {{loginUrl}}\n\nBonne journée,\nNotori";
let replyProfileState = {
  clientId: "",
  audit: null,
  profile: null,
  examples: []
};

function loadEmailedClientIds() {
  try {
    return JSON.parse(window.localStorage.getItem("notori:emailed-client-ids") || "[]");
  } catch {
    return [];
  }
}

const emailedClientIds = new Set(loadEmailedClientIds());

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Erreur inattendue.");
  return data;
}

function layout(content, subtitle = "Réponses aux avis Google assistées par IA") {
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <img class="brand-mark" src="/assets/notori-mark.png" alt="" aria-hidden="true" />
          <div>
            <strong>Notori</strong>
            <span>${subtitle}</span>
          </div>
        </div>
        <button class="secondary" data-action="logout">Se déconnecter</button>
      </header>
      <div id="notice-root" class="notice-root" aria-live="polite"></div>
      <section class="page">${content}</section>
    </div>
  `;
  app.querySelector("[data-action='logout']")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    renderLogin();
  });
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || "";
}

function persistEmailedClients() {
  window.localStorage.setItem("notori:emailed-client-ids", JSON.stringify([...emailedClientIds]));
}

function rememberEmailSent(clientId) {
  emailedClientIds.add(clientId);
  persistEmailedClients();
}

function forgetEmailSent(clientId) {
  emailedClientIds.delete(clientId);
  persistEmailedClients();
}

function parseEmailTemplate(client) {
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

function serializeEmailTemplate(subject, body) {
  return JSON.stringify({ subject, body });
}

function renderEmailText(template, client, pendingReviews, averageRating, totalReviews) {
  return (template || "")
    .replaceAll("{{contactName}}", client.contactName || client.businessName)
    .replaceAll("{{businessName}}", client.businessName)
    .replaceAll("{{pendingReviews}}", String(pendingReviews))
    .replaceAll("{{totalReviews}}", String(totalReviews))
    .replaceAll("{{averageRating}}", String(averageRating))
    .replaceAll("{{loginUrl}}", window.location.origin);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeTextarea(value) {
  return escapeHtml(value).replaceAll("</textarea", "&lt;/textarea");
}

function showNotice(message, type = "success") {
  const root = document.querySelector("#notice-root");
  if (!root) return;
  root.innerHTML = `
    <div class="notice ${type}">
      <span>${message}</span>
      <button class="secondary notice-close" type="button" aria-label="Fermer le message">Fermer</button>
    </div>
  `;
  root.querySelector(".notice-close")?.addEventListener("click", () => {
    root.innerHTML = "";
  });
  window.setTimeout(() => {
    if (root.querySelector(".notice")) root.innerHTML = "";
  }, 5000);
}

function confirmAction({ title, message, confirmLabel = "Confirmer" }) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">${title}</h2>
        <p class="muted">${message}</p>
        <div class="actions">
          <button type="button" data-confirm>${confirmLabel}</button>
          <button class="secondary" type="button" data-cancel>Annuler</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("[data-confirm]").focus();
    const close = (answer) => {
      modal.remove();
      resolve(answer);
    };
    modal.querySelector("[data-confirm]").addEventListener("click", () => close(true));
    modal.querySelector("[data-cancel]").addEventListener("click", () => close(false));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close(false);
    });
  });
}

function renderLogin() {
  app.innerHTML = `
    <section class="login">
      <img class="login-mark" src="/assets/notori-mark.png" alt="" aria-hidden="true" />
      <h1>Notori</h1>
      <p class="muted">Connectez-vous pour piloter vos réponses aux avis Google.</p>
      <form id="login-form">
        <label>Email
          <input name="email" type="email" autocomplete="email" required />
        </label>
        <label>Mot de passe
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Connexion</button>
        <p class="error" id="login-error"></p>
      </form>
    </section>
  `;
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/login", {
        method: "POST",
        body: Object.fromEntries(form.entries())
      });
      if (result.role === "admin") await renderAdmin();
      else await renderClient();
    } catch (error) {
      document.querySelector("#login-error").textContent = error.message;
    }
  });
}

async function renderAdmin(selectedClientId = "") {
  const { clients } = await api("/api/admin/clients");
  const activeClientId = selectedClientId || clients[0]?.id || "";
  const [{ reviews }, googleStatus, emailLogResult] = await Promise.all([
    activeClientId ? api(`/api/reviews?clientId=${activeClientId}`) : Promise.resolve({ reviews: [] }),
    activeClientId ? api(`/api/google/status?clientId=${activeClientId}`).catch(() => ({ configured: false, connected: false })) : Promise.resolve({ configured: false, connected: false }),
    activeClientId ? api(`/api/admin/email-logs/${activeClientId}`).catch(() => ({ emailLogs: [], smtpConfigured: false })) : Promise.resolve({ emailLogs: [], smtpConfigured: false })
  ]);

  layout(`
    <div class="page-head">
      <div>
        <h1>Notori</h1>
        <p class="muted">Pilotez les clients, les avis à traiter et les relances email depuis un seul écran.</p>
      </div>
      <span class="status active">${clients.length} client${clients.length > 1 ? "s" : ""}</span>
    </div>
    <div class="grid two">
      <aside class="panel">
        <h2 class="branded-title">Commerces</h2>
        <div id="clients-list">
          ${clients.map((client) => clientRow(client, activeClientId)).join("")}
        </div>
        <details class="compact-settings new-client-drawer">
          <summary>Nouveau client</summary>
          <form id="client-form">
            <label>Commerce <input name="businessName" required /></label>
            <label>Contact <input name="contactName" /></label>
            <label>Email <input name="email" type="email" required /></label>
            <label>Mot de passe temporaire <input name="password" minlength="8" autocomplete="new-password" required /></label>
            <label>Synchroniser les avis à partir du
              <input name="syncFromDate" type="date" required value="${new Date().toISOString().slice(0, 10)}" />
            </label>
            <button type="submit">Créer le client</button>
          </form>
        </details>
      </aside>
      <section>
        ${activeClientId ? adminClientPanel(clients.find((client) => client.id === activeClientId), reviews, googleStatus, emailLogResult) : "<p>Aucun client.</p>"}
      </section>
    </div>
  `);

  document.querySelectorAll("[data-client]").forEach((button) => {
    button.addEventListener("click", () => renderAdmin(button.dataset.client));
  });

  document.querySelectorAll("[data-status-client]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/admin/clients/${button.dataset.statusClient}`, {
          method: "PATCH",
          body: { status: button.dataset.nextStatus }
        });
        await renderAdmin(button.dataset.statusClient);
        showNotice("Statut client mis à jour.");
      } catch (error) {
        showNotice(error.message, "error");
      }
    });
  });

  document.querySelector("[data-sync-google]")?.addEventListener("click", async () => {
    const button = document.querySelector("[data-sync-google]");
    try {
      button.disabled = true;
      button.textContent = "Synchronisation en cours...";
      showNotice("Synchronisation Google en cours. Cela peut prendre quelques secondes.", "warning");
      const result = await api(`/api/sync-google-reviews/${activeClientId}`, { method: "POST" });
      if (result.imported > 0) forgetEmailSent(activeClientId);
      await renderAdmin(activeClientId);
      if (result.totalFound === 0) {
        showNotice("Google ne renvoie aucun nouvel avis non répondu pour cette fiche et cette date de début.", "warning");
      } else if (result.imported === 0) {
        showNotice(`${result.totalFound} avis non répondu trouvé, mais déjà présent dans l'outil.`, "warning");
      } else {
        showNotice(`${result.imported} nouvel avis non répondu importé sur ${result.totalFound} trouvé.`);
      }
    } catch (error) {
      showNotice(error.message, "error");
      if (button) {
        button.disabled = false;
        button.textContent = "Synchroniser";
      }
    }
  });

  document.querySelector("#settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "").trim();
    const body = {
      email: form.get("email"),
      syncFromDate: form.get("syncFromDate"),
      replyPolicy: form.get("replyPolicy"),
      emailTemplate: serializeEmailTemplate(form.get("emailSubjectTemplate"), form.get("emailBodyTemplate"))
    };
    if (password) body.password = password;
    try {
      await api(`/api/admin/clients/${activeClientId}`, {
        method: "PATCH",
        body
      });
      await renderAdmin(activeClientId);
      showNotice("Réglages client enregistrés.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  document.querySelector("[data-send-email]")?.addEventListener("click", async () => {
    const button = document.querySelector("[data-send-email]");
    const subject = document.querySelector("[name='emailSubject']").value;
    const body = document.querySelector("[name='emailBody']").value;
    try {
      button.disabled = true;
      button.textContent = "Envoi en cours...";
      const result = await api(`/api/admin/send-email/${activeClientId}`, {
        method: "POST",
        body: { subject, body }
      });
      rememberEmailSent(activeClientId);
      await renderAdmin(activeClientId);
      if (result.email.status === "sent") {
        showNotice("Email envoyé au client.");
      } else if (result.email.status === "failed") {
        showNotice(`L'envoi a échoué : ${result.email.error}`, "error");
      } else {
        showNotice("Email simulé et enregistré. Configurez Gmail/SMTP pour l'envoi réel.", "warning");
      }
    } catch (error) {
      showNotice(error.message, "error");
      if (button) {
        button.disabled = false;
        button.textContent = "Envoyer l'email";
      }
    }
  });

  document.querySelector("[data-delete-client]")?.addEventListener("click", async () => {
    const confirmed = await confirmAction({
      title: "Supprimer ce client ?",
      message: "Cette action supprimera définitivement le client, ses avis, son historique email, ses sessions et sa connexion Google. Elle ne peut pas être annulée.",
      confirmLabel: "Supprimer"
    });
    if (!confirmed) return;
    try {
      await api(`/api/admin/clients/${activeClientId}`, { method: "DELETE" });
      forgetEmailSent(activeClientId);
      await renderAdmin();
      showNotice("Client supprimé définitivement.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  document.querySelector("#client-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/admin/clients", {
        method: "POST",
        body: Object.fromEntries(form.entries())
      });
      await renderAdmin(result.client.id);
      showNotice("Client créé.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  wireReviewButtons(() => renderAdmin(activeClientId));
}

function clientRow(client, selectedClientId) {
  return `
    <div class="client-row">
      <button class="client-select ${client.id === selectedClientId ? "selected" : ""}" data-client="${client.id}">
        <span class="client-name">${client.businessName}</span>
        <span class="muted">${client.email}</span>
      </button>
      <div class="client-row-actions">
        <span class="status ${client.status}">${statusLabel(client.status)}</span>
      </div>
    </div>
  `;
}

function adminClientPanel(client, reviews, googleStatus, emailLogResult = { emailLogs: [], smtpConfigured: false }) {
  const pendingReviews = reviews.filter((review) => review.status === "pending");
  const historyReviews = reviews.filter((review) => review.status !== "pending");
  const pending = pendingReviews.length;
  const average = reviews.length
    ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)
    : "0.0";
  const emailTemplate = parseEmailTemplate(client);
  const emailSubject = renderEmailText(emailTemplate.subject, client, pending, average, reviews.length);
  const emailBody = renderEmailText(emailTemplate.body, client, pending, average, reviews.length);
  const lastEmail = (emailLogResult.emailLogs || [])[0];
  const nextStatus = client.status === "active" ? "suspended" : "active";
  const statusActionLabel = client.status === "active" ? "Suspendre" : "Réactiver";
  const emailAlreadySent = emailedClientIds.has(client.id);
  const googleConnectedText = googleStatus.connectedEmail || "Compte Google non connecté";
  return `
    <div class="panel cockpit-panel">
      <div class="client-hero">
        <div>
          <span class="eyebrow">Fiche client</span>
          <h2>${client.businessName}</h2>
          <p>${client.contactName || "Contact non renseigné"}</p>
        </div>
        <div class="actions">
          <span class="status ${client.status}">${statusLabel(client.status)}</span>
          <button class="${client.status === "active" ? "danger" : "secondary"}" data-status-client="${client.id}" data-next-status="${nextStatus}">
            ${statusActionLabel}
          </button>
        </div>
      </div>
      <div class="client-overview">
        <div class="overview-card google-card">
          <span>Google</span>
          <strong>${googleStatusLabel(googleStatus)}</strong>
          <p>${googleConnectedText}</p>
        </div>
        <div class="overview-card access-card">
          <span>Accès client</span>
          <strong>${client.email}</strong>
          <p>Identifiant de connexion et adresse de relance.</p>
        </div>
        <div class="overview-card sync-card">
          <span>Début de synchronisation</span>
          <strong>${formatLongDate(client.syncFromDate)}</strong>
          <p>Les avis plus anciens sont ignorés.</p>
        </div>
        <div class="overview-card focus-card">
          <span>Avis à traiter</span>
          <strong>${pending}</strong>
          <p>${reviews.length} avis synchronisés · moyenne ${average}/5</p>
        </div>
        <div class="overview-card email-card">
          <span>${lastEmail ? emailHeadingLabel(lastEmail.status) : "Dernier email"}</span>
          <strong>${lastEmail ? formatLongDateTime(lastEmail.createdAt) : "Aucun envoi"}</strong>
          <p>${lastEmail ? relativeDaysLabel(lastEmail.createdAt) : "Aucune relance n'a encore été envoyée."}</p>
        </div>
      </div>
    </div>
    <div class="panel operation-panel">
      <div class="section-header">
        <div>
          <h2 class="pen-title">Opérations</h2>
          <p class="muted">Synchronisez les nouveaux avis, relisez les réponses proposées, puis envoyez le lien de validation au client.</p>
        </div>
        <button data-sync-google>Synchroniser</button>
      </div>
      <div class="operation-block">
        <h3>Nouveaux avis à traiter</h3>
        ${
          emailAlreadySent
            ? "<p class='muted empty-state'>Email envoyé pour ce lot. Synchronisez les avis pour afficher les nouveaux avis à préparer.</p>"
            : pendingReviews.map((review) => reviewCard(review, "admin")).join("") || "<p class='muted empty-state'>Aucun avis à traiter. Synchronisez les avis pour vérifier les nouveautés Google.</p>"
        }
      </div>
      <div class="operation-block">
        <h3>Email à envoyer</h3>
        ${
          emailAlreadySent
            ? "<p class='muted empty-state'>Le dernier email vient d'être envoyé. Pour éviter un doublon, préparez un nouvel envoi après une nouvelle synchronisation.</p>"
            : `
              <p class="muted">Ce message est généré depuis l'email type du client. Vous pouvez l'ajuster ponctuellement avant l'envoi sans modifier le modèle permanent.</p>
              <label>Objet
                <input name="emailSubject" value="${emailSubject}" />
              </label>
              <label>Message
                <textarea name="emailBody">${emailBody}</textarea>
              </label>
              <div class="actions">
                <button data-send-email>Envoyer l'email</button>
              </div>
            `
        }
      </div>
    </div>
    <details class="panel section-details settings-panel">
      <summary><span class="pen-title">Réglages client</span></summary>
      <form id="settings-form">
        <div class="settings-grid">
          <div class="settings-group">
            <h3>Accès client</h3>
            <p class="muted">L'identifiant sert à la connexion du client et à l'envoi des emails de relance.</p>
            <label>Identifiant / email de connexion
              <input name="email" type="email" value="${client.email || ""}" required />
            </label>
            <label>Nouveau mot de passe temporaire
              <input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Laisser vide pour ne pas changer" />
            </label>
            <label>Date de début de synchronisation
              <input name="syncFromDate" type="date" value="${client.syncFromDate || ""}" required />
            </label>
          </div>
          <div class="settings-group">
            <h3>Prompt IA</h3>
            <p class="muted">Consignes utilisées pour générer les réponses Google du client.</p>
            <label>Ton de réponse
              <textarea name="replyPolicy">${client.replyPolicy || ""}</textarea>
            </label>
          </div>
          <div class="settings-group wide">
            <h3>Email type</h3>
            <p class="muted">Modèle permanent utilisé pour générer l'email à envoyer après synchronisation.</p>
            <label>Objet type
              <input name="emailSubjectTemplate" value="${emailTemplate.subject}" />
            </label>
            <label>Message type
              <textarea name="emailBodyTemplate">${emailTemplate.body}</textarea>
            </label>
          </div>
        </div>
        <div class="actions settings-actions">
          <button type="submit">Enregistrer les réglages</button>
        </div>
      </form>
      <div class="danger-zone">
        <div>
          <h3>Suppression définitive</h3>
          <p class="muted">Supprime le client, ses avis, ses emails, ses sessions et sa connexion Google.</p>
        </div>
        <button class="danger" type="button" data-delete-client>Supprimer le client</button>
      </div>
    </details>
    <details class="panel section-details">
      <summary>Historique des emails</summary>
      <p class="muted">Les derniers emails envoyés ou simulés pour ce client.</p>
      ${emailHistory(emailLogResult.emailLogs || [])}
    </details>
    <details class="panel section-details">
      <summary>Historique des avis répondus</summary>
      <p class="muted">Utile pour comprendre les corrections du client et affiner le ton des prochaines réponses.</p>
      ${historyReviews.map((review) => reviewCard(review, "history")).join("") || "<p class='muted'>Aucun avis répondu pour le moment.</p>"}
    </details>
  `;
}

function googleStatusLabel(status) {
  if (!status.configured) return "non configuré";
  if (!status.connected) return "à connecter";
  if (!status.googleLocationId) return "fiche à choisir";
  return "prêt";
}

function emailHistory(emailLogs) {
  if (!emailLogs.length) return "<p class='muted'>Aucun email historisé pour le moment.</p>";
  return `
    <div class="timeline">
      ${emailLogs
        .map(
          (emailLog) => `
            <div class="timeline-item">
              <div>
                <strong>${emailStatusLabel(emailLog.status)}</strong>
                <p class="muted">${formatDateTime(emailLog.createdAt)} - ${emailLog.to}</p>
                <p>${emailLog.subject}</p>
                ${emailLog.error ? `<p class="error">${emailLog.error}</p>` : ""}
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function emailStatusLabel(status) {
  return {
    sent: "Envoyé",
    failed: "Échec",
    simulated: "Simulé",
    pending: "En attente"
  }[status] || status || "Inconnu";
}

function emailHeadingLabel(status) {
  return {
    sent: "Dernier email envoyé",
    failed: "Dernier email en échec",
    simulated: "Dernier email simulé",
    pending: "Dernier email en attente"
  }[status] || "Dernier email";
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatLongDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const longDate = date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
  const time = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${longDate} à ${time}`;
}

function relativeDaysLabel(value) {
  if (!value) return "";
  const today = new Date();
  const date = new Date(value);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.max(0, Math.floor((todayStart - dateStart) / 86400000));
  if (diffDays === 0) return "aujourd'hui";
  if (diffDays === 1) return "il y a 1 jour";
  return `il y a ${diffDays} jours`;
}

function formatLongDate(value) {
  if (!value) return "non définie";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function ensureReplyProfileState(clientId) {
  if (replyProfileState.clientId === clientId) return;
  replyProfileState = {
    clientId,
    audit: null,
    profile: null,
    examples: []
  };
}

function auditTags(items = []) {
  return items.map((item) => `<span class="mini-tag">${escapeHtml(item)}</span>`).join("");
}

function questionnaireGhostReviews(audit, client) {
  const weaknesses = audit?.weaknesses?.length ? audit.weaknesses : ["l'attente", "l'accueil", "un passage en caisse"];
  const strengths = audit?.strengths?.length ? audit.strengths : ["la qualité du service", "les conseils", "l'expérience globale"];
  return [
    {
      key: "negativeReply1",
      label: "Avis négatif 1",
      rating: 1,
      text: `Très déçu par ${weaknesses[0]}. Je ne pense pas revenir.`,
      defaultAnswer:
        "Remercier le client pour son retour, reconnaître sa déception sans se justifier longuement, rester calme et proposer un échange direct si nécessaire. Ne pas promettre de compensation."
    },
    {
      key: "negativeReply2",
      label: "Avis négatif 2",
      rating: 2,
      text: `Mauvaise expérience, surtout à cause de ${weaknesses[1] || weaknesses[0]}.`,
      defaultAnswer:
        "Répondre avec un ton posé et professionnel. Montrer que le retour est entendu, éviter tout débat public, et inviter la personne à reprendre contact pour comprendre la situation."
    },
    {
      key: "negativeReply3",
      label: "Avis négatif 3",
      rating: 1,
      text: `Je trouve que le commerce ne prend pas assez en compte les clients, notamment sur ${weaknesses[2] || weaknesses[0]}.`,
      defaultAnswer:
        "Ne pas répondre sur le même ton si l'avis est dur. Rester bref, respectueux, reconnaître que l'expérience n'a pas été satisfaisante et proposer un échange direct."
    },
    {
      key: "mixedReply1",
      label: "Avis mitigé",
      rating: 3,
      text: `Expérience correcte, ${strengths[0]} est appréciable, mais ${weaknesses[0]} pourrait être amélioré.`,
      defaultAnswer:
        "Remercier pour le retour, valoriser le point positif sans en faire trop, puis indiquer que la remarque est utile pour progresser. Garder une réponse simple et constructive."
    },
    {
      key: "positiveReply1",
      label: "Avis positif",
      rating: 5,
      text: `Très bonne expérience, j'ai particulièrement apprécié ${strengths[0]} et l'accueil de l'équipe.`,
      defaultAnswer:
        "Remercier chaleureusement, mentionner naturellement le détail positif si cela sonne juste, dire que l'équipe est ravie, et inviter à revenir sans insister."
    }
  ];
}

function defaultBusinessAliases(client) {
  return [client.businessName, "notre équipe", "notre établissement", "notre commerce"].join("\n");
}

function defaultExtraGuidelines() {
  return [
    "Répondre avec une orthographe impeccable.",
    "Ne jamais inventer de détail absent de l'avis.",
    "Ne pas promettre de remboursement, geste commercial ou compensation.",
    "Adapter l'intensité de la réponse à la note et au contenu de l'avis.",
    "Varier les formulations pour éviter les réponses répétitives."
  ].join("\n");
}

function clientReplyProfilePanel(client, googleStatus) {
  ensureReplyProfileState(client.id);
  const audit = replyProfileState.audit;
  const profile = replyProfileState.profile;
  return `
    <div class="panel reply-profile-panel">
      <div class="section-header">
        <div>
          <span class="eyebrow">Profil IA</span>
          <h2 class="branded-title">Créer le style de réponse</h2>
          <p class="muted">Audit des avis, questionnaire de ton, prompt final et exemples de calibration.</p>
        </div>
        <button data-run-profile-audit>${audit ? "Relancer l'audit" : "Auditer les avis"}</button>
      </div>
      ${
        !googleStatus.connected
          ? "<p class='muted empty-state'>Connectez Google et sélectionnez votre établissement pour auditer les 100 derniers avis. En attendant, Notori peut utiliser les avis déjà synchronisés pour tester le parcours.</p>"
          : ""
      }
      ${audit ? replyAuditSummary(audit) : "<p class='muted empty-state'>Lancez l'audit pour analyser les 100 derniers avis, les étoiles, les réponses propriétaire et les sujets récurrents.</p>"}
      ${replyQuestionnaire(client, audit)}
      ${profile ? replyProfileResult(profile) : ""}
    </div>
  `;
}

function replyAuditSummary(audit) {
  return `
    <div class="audit-summary">
      <div class="audit-main">
        <strong>Analyse synthétique</strong>
        <p>${escapeHtml(audit.summary)}</p>
      </div>
      <div class="audit-stats">
        <div><span>Avis analysés</span><strong>${audit.reviewCount || 0}</strong></div>
        <div><span>Moyenne</span><strong>${audit.averageRating || 0}/5</strong></div>
        <div><span>Taux de réponse</span><strong>${audit.responseRate || 0}%</strong></div>
      </div>
      <div class="audit-tags">
        <div>
          <span>Points forts</span>
          <p>${auditTags(audit.strengths)}</p>
        </div>
        <div>
          <span>Points faibles</span>
          <p>${auditTags(audit.weaknesses)}</p>
        </div>
      </div>
      <p class="muted">${escapeHtml(audit.ownerReplyStyle || "")}</p>
    </div>
  `;
}

function replyQuestionnaire(client, audit) {
  const ghostReviews = questionnaireGhostReviews(audit, client);
  return `
    <details class="compact-settings questionnaire-drawer" ${audit ? "open" : ""}>
      <summary>Questionnaire de ton</summary>
      <form id="reply-profile-form">
        <div class="settings-grid">
          <div class="settings-group">
            <h3>Identité et vocabulaire</h3>
            <label>Quels noms peut-on utiliser pour parler de votre commerce ?
              <textarea name="businessAliases" placeholder="Ex : la jardinerie, le magasin, notre équipe, nos rayons...">${escapeTextarea(defaultBusinessAliases(client))}</textarea>
            </label>
            <label>Quel ton souhaitez-vous ?
              <select name="tone">
                <option value="humain, chaleureux, professionnel et naturel">Humain, chaleureux, professionnel</option>
                <option value="simple, direct, calme et très professionnel">Simple, direct, calme</option>
                <option value="très chaleureux, proche et naturel">Très chaleureux et proche</option>
              </select>
            </label>
            <label>Émojis
              <input name="emojiPolicy" value="Sobres, surtout dans les avis positifs ou neutres, jamais automatiques." />
            </label>
          </div>
          <div class="settings-group">
            <h3>Faiblesses connues</h3>
            <label>Y a-t-il un point faible connu que vous voulez expliquer à l'IA ?
              <textarea name="knownWeakness" placeholder="Ex : l'attente peut être longue le samedi, l'équipe est réduite en haute saison..."></textarea>
            </label>
            <label>Que voulez-vous dire aux clients quand ce sujet revient ?
              <textarea name="weaknessContext" placeholder="Expliquez simplement la réalité du terrain, sans écrire une réponse complète."></textarea>
            </label>
          </div>
          <div class="settings-group wide">
            <h3>Formules et limites</h3>
            <label>Formules à éviter
              <textarea name="mustAvoid" placeholder="Ex : Votre satisfaction est notre priorité, réponses trop corporate, promesses de remboursement...">Votre satisfaction est notre priorité. Toute formule trop froide, trop commerciale ou trop automatique.</textarea>
            </label>
            <label>Consignes spécifiques
              <textarea name="extraGuidelines" placeholder="Ex : ne pas parler de compensation, proposer un appel uniquement pour les avis très négatifs...">${escapeTextarea(defaultExtraGuidelines())}</textarea>
            </label>
          </div>
        </div>
        <div class="ghost-review-grid">
          ${ghostReviews
            .map(
              (review) => `
                <div class="ghost-review">
                  <span>${review.label} · ${review.rating}/5</span>
                  <p>${escapeHtml(review.text)}</p>
                  <label>Comment aimeriez-vous répondre ?
                    <textarea name="${review.key}" placeholder="Écrivez l'intention, le ton, ou une réponse exemple.">${escapeTextarea(review.defaultAnswer)}</textarea>
                  </label>
                </div>
              `
            )
            .join("")}
        </div>
        <div class="actions">
          <button type="submit">${replyProfileState.profile ? "Regénérer le prompt" : "Générer le prompt"}</button>
        </div>
      </form>
    </details>
  `;
}

function replyProfileResult(profile) {
  return `
    <div class="profile-result">
      <h3>Synthèse proposée</h3>
      <p class="muted">${escapeHtml(profile.summary || "")}</p>
      <label>Prompt final proposé
        <textarea id="reply-profile-prompt" class="large-textarea">${escapeTextarea(profile.prompt || "")}</textarea>
      </label>
      <div class="calibration-list">
        <h3>Calibration avec des avis exemples</h3>
        <p class="muted">Modifiez les avis si besoin, générez une réponse, puis validez le profil quand le style vous convient.</p>
        ${replyProfileState.examples.map((example, index) => calibrationCard(example, index)).join("")}
      </div>
      <div class="actions">
        <button data-save-reply-profile>Valider ce profil IA</button>
      </div>
    </div>
  `;
}

function calibrationCard(example, index) {
  return `
    <article class="calibration-card" data-calibration-index="${index}">
      <div class="review-head">
        <div>
          <h3>${escapeHtml(example.intent || `Avis exemple ${index + 1}`)}</h3>
          <span class="stars">${"★".repeat(Number(example.rating || 5))}${"☆".repeat(5 - Number(example.rating || 5))}</span>
        </div>
        <select data-example-rating>
          ${[1, 2, 3, 4, 5].map((rating) => `<option value="${rating}" ${Number(example.rating) === rating ? "selected" : ""}>${rating}/5</option>`).join("")}
        </select>
      </div>
      <label>Avis exemple
        <textarea data-example-text>${escapeTextarea(example.text || "")}</textarea>
      </label>
      <div class="actions">
        <button type="button" class="secondary" data-generate-sample-reply>Générer une réponse d'exemple</button>
      </div>
      <label>Réponse d'exemple
        <textarea data-example-reply>${escapeTextarea(example.reply || "")}</textarea>
      </label>
    </article>
  `;
}

function collectReplyProfileAnswers(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function syncCalibrationFromDom() {
  document.querySelectorAll("[data-calibration-index]").forEach((card) => {
    const index = Number(card.dataset.calibrationIndex);
    replyProfileState.examples[index] = {
      ...(replyProfileState.examples[index] || {}),
      rating: Number(card.querySelector("[data-example-rating]").value),
      text: card.querySelector("[data-example-text]").value,
      reply: card.querySelector("[data-example-reply]").value
    };
  });
}

function finalPromptWithCalibration(prompt) {
  syncCalibrationFromDom();
  const examples = replyProfileState.examples.filter((example) => example.text && example.reply);
  if (!examples.length) return prompt;
  return [
    prompt,
    "",
    "Exemples validés par le client pour calibrer le style :",
    ...examples.map(
      (example, index) =>
        [`Exemple ${index + 1} - ${example.rating}/5`, `Avis : ${example.text}`, `Réponse attendue : ${example.reply}`].join("\n")
    )
  ].join("\n\n");
}

async function renderClient() {
  const me = await api("/api/me");
  if (!me.client?.id) {
    await api("/api/logout", { method: "POST" });
    renderLogin();
    return;
  }
  const [{ reviews }, summary, googleStatus] = await Promise.all([
    api("/api/reviews"),
    api(`/api/weekly-summary?clientId=${me.client.id}`),
    api("/api/google/status").catch(() => ({ configured: false, connected: false }))
  ]);
  const googleLocationsResult = googleStatus.connected
    ? await api("/api/google/locations").catch((error) => ({ locations: [], error: error.message }))
    : { locations: [] };
  layout(`
    <h1>${me.client.businessName}</h1>
    <p class="muted">Modifiez les réponses proposées, puis publiez celles qui vous conviennent.</p>
    <div class="cards">
      <div class="metric"><span class="muted">Avis</span><strong>${summary.totalReviews}</strong></div>
      <div class="metric"><span class="muted">À traiter</span><strong>${summary.pendingReviews}</strong></div>
      <div class="metric"><span class="muted">Moyenne</span><strong>${summary.averageRating}/5</strong></div>
    </div>
    <div class="grid two">
      <aside>
        ${clientGooglePanel(googleStatus, googleLocationsResult)}
        ${clientPasswordPanel(me.client)}
      </aside>
      <section>
        ${clientReplyProfilePanel(me.client, googleStatus)}
        ${reviews.filter((review) => review.status === "pending").map((review) => reviewCard(review, "client")).join("") || "<p class='muted'>Aucun avis en attente.</p>"}
      </section>
    </div>
  `, "Votre espace de validation");
  document.querySelector("[data-run-profile-audit]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      button.textContent = "Audit en cours...";
      showNotice("Analyse des avis en cours. Cela peut prendre quelques secondes.", "warning");
      const result = await api("/api/client/reply-profile/audit", { method: "POST" });
      replyProfileState.audit = result.audit;
      replyProfileState.profile = null;
      replyProfileState.examples = [];
      await renderClient();
      showNotice("Audit des avis terminé.");
    } catch (error) {
      showNotice(error.message, "error");
      button.disabled = false;
      button.textContent = "Auditer les avis";
    }
  });
  document.querySelector("#reply-profile-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    try {
      button.disabled = true;
      button.textContent = "Génération...";
      const result = await api("/api/client/reply-profile/generate", {
        method: "POST",
        body: {
          audit: replyProfileState.audit,
          answers: collectReplyProfileAnswers(event.currentTarget)
        }
      });
      replyProfileState.profile = {
        summary: result.summary,
        prompt: result.prompt
      };
      replyProfileState.examples = result.examples || [];
      await renderClient();
      showNotice("Prompt proposé généré.");
    } catch (error) {
      showNotice(error.message, "error");
      button.disabled = false;
      button.textContent = "Générer le prompt";
    }
  });
  document.querySelectorAll("[data-generate-sample-reply]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-calibration-index]");
      const index = Number(card.dataset.calibrationIndex);
      try {
        button.disabled = true;
        button.textContent = "Génération...";
        const prompt = document.querySelector("#reply-profile-prompt")?.value || replyProfileState.profile?.prompt || "";
        const review = {
          rating: Number(card.querySelector("[data-example-rating]").value),
          text: card.querySelector("[data-example-text]").value
        };
        const result = await api("/api/client/reply-profile/sample-reply", {
          method: "POST",
          body: { prompt, review }
        });
        card.querySelector("[data-example-reply]").value = result.reply;
        replyProfileState.examples[index] = {
          ...(replyProfileState.examples[index] || {}),
          ...review,
          reply: result.reply
        };
        showNotice("Réponse d'exemple générée.");
      } catch (error) {
        showNotice(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = "Générer une réponse d'exemple";
      }
    });
  });
  document.querySelector("[data-save-reply-profile]")?.addEventListener("click", async () => {
    const button = document.querySelector("[data-save-reply-profile]");
    const prompt = document.querySelector("#reply-profile-prompt")?.value || "";
    try {
      button.disabled = true;
      button.textContent = "Validation...";
      const finalPrompt = finalPromptWithCalibration(prompt);
      await api("/api/client/reply-profile", {
        method: "PATCH",
        body: { prompt: finalPrompt }
      });
      replyProfileState.profile.prompt = finalPrompt;
      showNotice("Profil IA validé. Les prochaines réponses utiliseront ce prompt.");
      button.disabled = false;
      button.textContent = "Mettre à jour le profil IA";
    } catch (error) {
      showNotice(error.message, "error");
      button.disabled = false;
      button.textContent = "Valider ce profil IA";
    }
  });
  document.querySelector("#client-google-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/client/google-location", {
        method: "PATCH",
        body: { googleLocationId: form.get("googleLocationId") || "" }
      });
      await renderClient();
      showNotice("Établissement Google enregistré.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
  document.querySelector("#client-password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      showNotice("Les deux nouveaux mots de passe ne correspondent pas.", "error");
      return;
    }
    try {
      await api("/api/client/password", {
        method: "PATCH",
        body: {
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword")
        }
      });
      event.currentTarget.reset();
      showNotice("Mot de passe modifié.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
  wireReviewButtons(renderClient);
}

function clientGooglePanel(status, locationsResult) {
  if (!status.configured) {
    return `
      <div class="panel">
        <h2 class="branded-title">Compte Google</h2>
        <p class="muted">La connexion Google n'est pas encore activée par l'administrateur. Le bouton de connexion apparaîtra ici dès que l'accès Google sera configuré.</p>
      </div>
    `;
  }

  if (!status.connected) {
    return `
      <div class="panel">
        <h2 class="branded-title">Compte Google</h2>
        <p class="muted">Connectez le compte Google qui gère votre fiche d'établissement.</p>
        <a class="button-link" href="/api/google/start">Connecter mon compte Google</a>
      </div>
    `;
  }

  const locations = locationsResult.locations || [];
  return `
    <div class="panel">
      <h2 class="branded-title">Compte Google</h2>
      <p class="muted">Compte connecté${status.connectedEmail ? ` : ${status.connectedEmail}` : ""}.</p>
      ${locationsResult.error ? `<p class="error">${locationsResult.error}</p>` : ""}
      <form id="client-google-form">
        <label>Fiche d'établissement à utiliser
          <select name="googleLocationId" ${locations.length ? "" : "disabled"}>
            <option value="">Sélectionner un établissement</option>
            ${locations
              .map(
                (location) => `
                  <option value="${location.name}" ${status.googleLocationId === location.name ? "selected" : ""}>
                    ${location.title}${location.address ? ` - ${location.address}` : ""}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <div class="actions">
          <button type="submit" ${locations.length ? "" : "disabled"}>Enregistrer l'établissement</button>
          <a class="button-link secondary-link" href="/api/google/start">Reconnecter Google</a>
        </div>
      </form>
    </div>
  `;
}

function clientPasswordPanel(client) {
  return `
    <div class="panel">
      <h2 class="branded-title">Accès</h2>
      <label>Identifiant
        <input value="${client.email}" disabled />
      </label>
      <details class="compact-settings">
        <summary>Modifier le mot de passe</summary>
        <form id="client-password-form">
          <label>Mot de passe actuel
            <input name="currentPassword" type="password" autocomplete="current-password" required />
          </label>
          <label>Nouveau mot de passe
            <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <label>Confirmer le nouveau mot de passe
            <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <button type="submit">Valider</button>
        </form>
      </details>
    </div>
  `;
}

function reviewCard(review, mode = "client") {
  const showPublish = mode === "client";
  const showSave = mode === "admin";
  return `
    <article class="review" data-review-id="${review.id}" data-review-source="${review.source || "manual"}">
      <div class="review-head">
        <div>
          <h3>${review.author}</h3>
          <span class="stars" aria-label="Note ${review.rating} sur 5">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span>
          <span class="muted rating-text">${review.rating}/5</span>
        </div>
        <span class="status ${review.status}">${statusLabel(review.status)}</span>
      </div>
      <p>${review.text}</p>
      <label>Réponse proposée
        <textarea data-reply>${review.suggestedReply}</textarea>
      </label>
      <div class="actions">
        ${showPublish ? `<button data-publish ${review.status !== "pending" ? "disabled" : ""}>Publier</button>` : ""}
        ${showSave ? `<button class="secondary" data-save ${review.status !== "pending" ? "disabled" : ""}>Enregistrer</button>` : ""}
      </div>
    </article>
  `;
}

function wireReviewButtons(afterSave) {
  document.querySelectorAll("[data-review-id]").forEach((card) => {
    const reviewId = card.dataset.reviewId;
    const textarea = card.querySelector("[data-reply]");
    card.querySelector("[data-save]")?.addEventListener("click", async () => {
      await api(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        body: { suggestedReply: textarea.value }
      });
      await afterSave();
      showNotice("Réponse enregistrée.");
    });
    card.querySelector("[data-publish]")?.addEventListener("click", async () => {
      const isGoogleReview = card.dataset.reviewSource === "google-sync";
      const confirmed = await confirmAction({
        title: isGoogleReview ? "Publier sur Google ?" : "Valider cette publication ?",
        message: isGoogleReview
          ? "Cette réponse sera envoyée sur la fiche Google de l'établissement. Relisez bien le message avant de confirmer."
          : "Cet avis de test sera marqué comme publié dans l'outil.",
        confirmLabel: "Publier"
      });
      if (!confirmed) return;
      await api(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        body: { suggestedReply: textarea.value, status: "published" }
      });
      await afterSave();
      showNotice(isGoogleReview ? "Réponse publiée sur Google." : "Avis marqué comme publié.");
    });
    card.querySelector("[data-ignore]")?.addEventListener("click", async () => {
      await api(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        body: { status: "ignored" }
      });
      await afterSave();
      showNotice("Avis ignoré.");
    });
  });
}

async function boot() {
  try {
    const me = await api("/api/me");
    if (me.role === "admin") await renderAdmin();
    else await renderClient();
  } catch {
    renderLogin();
  }
}

boot();
