const app = document.querySelector("#app");

const STATUS_LABELS = {
  active: "actif",
  suspended: "suspendu",
  pending: "en attente",
  published: "publié",
  ignored: "ignoré"
};

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
          <strong>Notori</strong>
          <span>${subtitle}</span>
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
        <h2>Commerces</h2>
        <div id="clients-list">
          ${clients.map((client) => clientRow(client, activeClientId)).join("")}
        </div>
        <h3>Nouveau client</h3>
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
        button.textContent = "Synchroniser les avis Google non répondus";
      }
    }
  });

  document.querySelector("#settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/admin/clients/${activeClientId}`, {
        method: "PATCH",
        body: {
          syncFromDate: form.get("syncFromDate")
        }
      });
      await renderAdmin(activeClientId);
      showNotice("Réglages client enregistrés.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  document.querySelector("#access-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "").trim();
    const body = {
      email: form.get("email")
    };
    if (password) body.password = password;
    try {
      await api(`/api/admin/clients/${activeClientId}`, {
        method: "PATCH",
        body
      });
      await renderAdmin(activeClientId);
      showNotice(password ? "Identifiant et mot de passe client mis à jour." : "Identifiant client mis à jour.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  document.querySelector("[data-save-email-template]")?.addEventListener("click", async () => {
    const body = document.querySelector("[name='emailBody']").value;
    try {
      await api(`/api/admin/clients/${activeClientId}`, {
        method: "PATCH",
        body: { emailTemplate: body }
      });
      await renderAdmin(activeClientId);
      showNotice("Ce message devient le nouvel email type du client.");
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

  document.querySelector("#policy-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/admin/clients/${activeClientId}`, {
        method: "PATCH",
        body: { replyPolicy: form.get("replyPolicy") }
      });
      await renderAdmin(activeClientId);
      showNotice("Prompt personnalisé enregistré.");
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
  const nextStatus = client.status === "active" ? "suspended" : "active";
  const label = client.status === "active" ? "Suspendre" : "Réactiver";
  return `
    <div class="client-row">
      <button class="client-select ${client.id === selectedClientId ? "selected" : ""}" data-client="${client.id}">
        <span class="client-name">${client.businessName}</span>
        <span class="muted">${client.email}</span>
      </button>
      <div class="client-row-actions">
        <span class="status ${client.status}">${statusLabel(client.status)}</span>
        <button class="${client.status === "active" ? "danger" : ""}" data-status-client="${client.id}" data-next-status="${nextStatus}">
          ${label}
        </button>
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
  const emailSubject = `Vos réponses aux avis Google sont prêtes - ${client.businessName}`;
  const emailBody = renderEmailPreview(client, pending, average, reviews.length);
  const lastEmail = (emailLogResult.emailLogs || [])[0];
  return `
    <div class="cards compact-cards">
      <div class="metric"><span class="muted">Avis</span><strong>${reviews.length}</strong></div>
      <div class="metric"><span class="muted">À traiter</span><strong>${pending}</strong></div>
      <div class="metric"><span class="muted">Moyenne</span><strong>${average}/5</strong></div>
    </div>
    <div class="panel cockpit-panel">
      <div class="cockpit-main">
        <div>
          <span class="eyebrow">Client actif</span>
          <h2>${client.businessName}</h2>
          <p class="muted">${adminGoogleLabel(googleStatus)}</p>
        </div>
        <span class="status ${client.status}">${statusLabel(client.status)}</span>
      </div>
      <div class="status-grid">
        <div class="status-line">
          <span>Google</span>
          <strong>${googleStatusLabel(googleStatus)}</strong>
        </div>
        <div class="status-line">
          <span>Email</span>
          <strong>${emailLogResult.smtpConfigured ? "envoi réel actif" : "simulation"}</strong>
        </div>
        <div class="status-line">
          <span>Dernier email</span>
          <strong>${lastEmail ? `${emailStatusLabel(lastEmail.status)} le ${formatDateTime(lastEmail.createdAt)}` : "aucun"}</strong>
        </div>
        <div class="status-line">
          <span>Synchronisation depuis</span>
          <strong>${client.syncFromDate || "non définie"}</strong>
        </div>
      </div>
      <div class="actions action-row">
        <button data-sync-google>Synchroniser les avis</button>
        <button data-send-email>Envoyer l'email</button>
      </div>
    </div>
    <div class="panel">
      <h2>Email à envoyer</h2>
      <p class="muted">Ce message est généré depuis l'email type du client. Vous pouvez l'ajuster ponctuellement avant l'envoi sans modifier le modèle permanent.</p>
      <p class="muted">${emailLogResult.smtpConfigured ? "Envoi réel configuré." : "Envoi réel non configuré : l'email sera simulé et historisé."}</p>
      <label>Objet
        <input name="emailSubject" value="${emailSubject}" />
      </label>
      <label>Message
        <textarea name="emailBody">${emailBody}</textarea>
      </label>
      <div class="actions">
        <button class="secondary" data-save-email-template>En faire le nouvel email type</button>
      </div>
    </div>
    <div class="panel">
      <h2>Avis à traiter</h2>
      <p class="muted">Avis Google non répondus importés par la synchronisation. Les réponses proposées apparaissent côté client.</p>
      ${pendingReviews.map((review) => reviewCard(review, "admin")).join("") || "<p class='muted'>Aucun avis à traiter.</p>"}
    </div>
    <details class="panel section-details">
      <summary>Réglages client</summary>
      <form id="settings-form">
        <label>Date de début de synchronisation
          <input name="syncFromDate" type="date" value="${client.syncFromDate || ""}" required />
        </label>
        <button type="submit">Enregistrer les réglages</button>
      </form>
    </details>
    <details class="panel section-details">
      <summary>Accès client</summary>
      <p class="muted">L'identifiant sert à la connexion du client et à l'envoi des emails de relance. Le mot de passe actuel n'est jamais affiché : vous pouvez seulement en définir un nouveau.</p>
      <form id="access-form">
        <label>Identifiant / email de connexion
          <input name="email" type="email" value="${client.email || ""}" required />
        </label>
        <label>Nouveau mot de passe temporaire
          <input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Laisser vide pour ne pas changer" />
        </label>
        <button type="submit">Mettre à jour les accès</button>
      </form>
    </details>
    <details class="panel section-details">
      <summary>Historique des emails</summary>
      <p class="muted">Les derniers emails envoyés ou simulés pour ce client.</p>
      ${emailHistory(emailLogResult.emailLogs || [])}
    </details>
    <details class="panel section-details">
      <summary>Prompt personnalisé du client</summary>
      <form id="policy-form">
        <label>Consignes utilisées par l'IA pour générer les réponses Google
          <textarea name="replyPolicy">${client.replyPolicy || ""}</textarea>
        </label>
        <button type="submit">Enregistrer le prompt</button>
      </form>
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

function adminGoogleLabel(status) {
  if (!status.configured) return "Google non configuré dans Vercel : la connexion client n'est pas encore disponible.";
  if (!status.connected) return "Google non connecté : le client doit connecter le compte qui gère sa fiche.";
  if (!status.googleLocationId) return "Google connecté, mais aucun établissement n'est encore sélectionné.";
  return `Google prêt${status.connectedEmail ? ` : ${status.connectedEmail}` : ""}.`;
}

function renderEmailPreview(client, pendingReviews, averageRating, totalReviews) {
  const template =
    client.emailTemplate ||
    "Bonjour {{contactName}},\n\nVous avez {{pendingReviews}} avis Google à traiter cette semaine, avec une moyenne de {{averageRating}}/5.\n\nCliquez ici pour les relire, modifier les réponses proposées et publier celles qui vous conviennent : {{loginUrl}}\n\nBonne journée,\nNotori";
  return template
    .replaceAll("{{contactName}}", client.contactName || client.businessName)
    .replaceAll("{{businessName}}", client.businessName)
    .replaceAll("{{pendingReviews}}", String(pendingReviews))
    .replaceAll("{{totalReviews}}", String(totalReviews))
    .replaceAll("{{averageRating}}", String(averageRating))
    .replaceAll("{{loginUrl}}", window.location.origin);
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
        ${reviews.filter((review) => review.status === "pending").map((review) => reviewCard(review, "client")).join("") || "<p class='muted'>Aucun avis en attente.</p>"}
      </section>
    </div>
  `, "Votre espace de validation");
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
        <h2>Compte Google</h2>
        <p class="muted">La connexion Google n'est pas encore activée par l'administrateur. Le bouton de connexion apparaîtra ici dès que l'accès Google sera configuré.</p>
      </div>
    `;
  }

  if (!status.connected) {
    return `
      <div class="panel">
        <h2>Compte Google</h2>
        <p class="muted">Connectez le compte Google qui gère votre fiche d'établissement.</p>
        <a class="button-link" href="/api/google/start">Connecter mon compte Google</a>
      </div>
    `;
  }

  const locations = locationsResult.locations || [];
  return `
    <div class="panel">
      <h2>Compte Google</h2>
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
      <h2>Accès</h2>
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
  const showActions = mode !== "history";
  const showSave = mode === "admin";
  const showIgnore = mode === "admin";
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
        ${showActions ? `<button data-publish ${review.status !== "pending" ? "disabled" : ""}>Publier</button>` : ""}
        ${showSave ? `<button class="secondary" data-save ${review.status !== "pending" ? "disabled" : ""}>Enregistrer</button>` : ""}
        ${showIgnore ? `<button class="secondary" data-ignore ${review.status !== "pending" ? "disabled" : ""}>Ignorer</button>` : ""}
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
