const app = document.querySelector("#app");

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
          <strong>Agent Pilot Avis</strong>
          <span>${subtitle}</span>
        </div>
        <button class="secondary" data-action="logout">Se déconnecter</button>
      </header>
      <section class="page">${content}</section>
    </div>
  `;
  app.querySelector("[data-action='logout']")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    renderLogin();
  });
}

function renderLogin() {
  app.innerHTML = `
    <section class="login">
      <h1>Agent Pilot Avis</h1>
      <p class="muted">Connectez-vous pour gérer les réponses aux avis Google.</p>
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
  const [{ reviews }, googleStatus] = await Promise.all([
    activeClientId ? api(`/api/reviews?clientId=${activeClientId}`) : Promise.resolve({ reviews: [] }),
    activeClientId ? api(`/api/google/status?clientId=${activeClientId}`).catch(() => ({ configured: false, connected: false })) : Promise.resolve({ configured: false, connected: false })
  ]);

  layout(`
    <h1>Espace admin</h1>
    <p class="muted">Créez les comptes clients, synchronisez les avis Google non répondus et gardez la main sur les accès.</p>
    <div class="grid two">
      <aside class="panel">
        <h2>Clients</h2>
        <div id="clients-list">
          ${clients.map((client) => clientRow(client, activeClientId)).join("")}
        </div>
        <h3>Ajouter un client</h3>
        <form id="client-form">
          <label>Commerce <input name="businessName" required /></label>
          <label>Contact <input name="contactName" /></label>
          <label>Email <input name="email" type="email" required /></label>
          <label>Mot de passe temporaire <input name="password" required /></label>
          <label>Synchroniser les avis à partir du
            <input name="syncFromDate" type="date" required value="${new Date().toISOString().slice(0, 10)}" />
          </label>
          <button type="submit">Créer le client</button>
        </form>
      </aside>
      <section>
        ${activeClientId ? adminClientPanel(clients.find((client) => client.id === activeClientId), reviews, googleStatus) : "<p>Aucun client.</p>"}
      </section>
    </div>
  `);

  document.querySelectorAll("[data-client]").forEach((button) => {
    button.addEventListener("click", () => renderAdmin(button.dataset.client));
  });

  document.querySelectorAll("[data-status-client]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/clients/${button.dataset.statusClient}`, {
        method: "PATCH",
        body: { status: button.dataset.nextStatus }
      });
      renderAdmin(button.dataset.statusClient);
    });
  });

  document.querySelector("[data-sync-google]")?.addEventListener("click", async () => {
    try {
      const result = await api(`/api/sync-google-reviews/${activeClientId}`, { method: "POST" });
      alert(`${result.imported} nouvel avis non répondu importé sur ${result.totalFound} trouvé.`);
      renderAdmin(activeClientId);
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector("#settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/admin/clients/${activeClientId}`, {
      method: "PATCH",
      body: {
        syncFromDate: form.get("syncFromDate")
      }
    });
    renderAdmin(activeClientId);
  });

  document.querySelector("[data-save-email-template]")?.addEventListener("click", async () => {
    const body = document.querySelector("[name='emailBody']").value;
    await api(`/api/admin/clients/${activeClientId}`, {
      method: "PATCH",
      body: { emailTemplate: body }
    });
    alert("Ce message devient le nouvel email type du client.");
    renderAdmin(activeClientId);
  });

  document.querySelector("[data-send-email]")?.addEventListener("click", async () => {
    const subject = document.querySelector("[name='emailSubject']").value;
    const body = document.querySelector("[name='emailBody']").value;
    const result = await api(`/api/admin/send-email/${activeClientId}`, {
      method: "POST",
      body: { subject, body }
    });
    if (result.email.status === "sent") {
      alert("Email envoyé au client.");
    } else if (result.email.status === "failed") {
      alert(`L'envoi a échoué : ${result.email.error}`);
    } else {
      alert("Email simulé et enregistré. Configurez Gmail/SMTP pour l'envoi réel.");
    }
  });

  document.querySelector("#policy-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/admin/clients/${activeClientId}`, {
      method: "PATCH",
      body: { replyPolicy: form.get("replyPolicy") }
    });
    renderAdmin(activeClientId);
  });

  document.querySelector("#client-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api("/api/admin/clients", {
      method: "POST",
      body: Object.fromEntries(form.entries())
    });
    renderAdmin(result.client.id);
  });

  document.querySelector("#review-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/admin/reviews", {
      method: "POST",
      body: { ...Object.fromEntries(form.entries()), clientId: activeClientId }
    });
    renderAdmin(activeClientId);
  });
}

function clientRow(client, selectedClientId) {
  const nextStatus = client.status === "active" ? "suspended" : "active";
  const label = client.status === "active" ? "Suspendre" : "Réactiver";
  return `
    <div class="client-row">
      <button class="secondary" data-client="${client.id}">
        ${client.businessName} ${client.id === selectedClientId ? "✓" : ""}
      </button>
      <span class="status ${client.status}">${client.status}</span>
      <div class="muted">${client.email}</div>
      <button class="${client.status === "active" ? "danger" : ""}" data-status-client="${client.id}" data-next-status="${nextStatus}">
        ${label}
      </button>
    </div>
  `;
}

function adminClientPanel(client, reviews, googleStatus) {
  const pendingReviews = reviews.filter((review) => review.status === "pending");
  const historyReviews = reviews.filter((review) => review.status !== "pending");
  const pending = pendingReviews.length;
  const average = reviews.length
    ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)
    : "0.0";
  const emailSubject = `Vos réponses aux avis Google sont prêtes - ${client.businessName}`;
  const emailBody = renderEmailPreview(client, pending, average, reviews.length);
  return `
    <div class="cards">
      <div class="metric"><span class="muted">Avis</span><strong>${reviews.length}</strong></div>
      <div class="metric"><span class="muted">À traiter</span><strong>${pending}</strong></div>
      <div class="metric"><span class="muted">Moyenne</span><strong>${average}/5</strong></div>
    </div>
    <div class="panel">
      <h2>${client.businessName}</h2>
      <p class="muted">Les avis synchronisés tiennent compte de la date de début configurée pour éviter d'importer tout l'historique Google.</p>
      <p class="muted">${adminGoogleLabel(googleStatus)}</p>
      <div class="actions">
        <button data-sync-google>Synchroniser les avis Google non répondus</button>
      </div>
    </div>
    <div class="panel">
      <h2>Réglages client</h2>
      <form id="settings-form">
        <label>Date de début de synchronisation
          <input name="syncFromDate" type="date" value="${client.syncFromDate || ""}" required />
        </label>
        <button type="submit">Enregistrer les réglages</button>
      </form>
    </div>
    <div class="panel">
      <h2>Email à envoyer</h2>
      <p class="muted">Ce message est généré depuis l'email type du client. Vous pouvez l'ajuster ponctuellement avant l'envoi sans modifier le modèle permanent.</p>
      <label>Objet
        <input name="emailSubject" value="${emailSubject}" />
      </label>
      <label>Message
        <textarea name="emailBody">${emailBody}</textarea>
      </label>
      <div class="actions">
        <button data-send-email>Envoyer l'email</button>
        <button class="secondary" data-save-email-template>En faire le nouvel email type</button>
      </div>
    </div>
    <div class="panel">
      <h2>Prompt personnalisé du client</h2>
      <form id="policy-form">
        <label>Consignes utilisées par l'IA pour générer les réponses Google
          <textarea name="replyPolicy">${client.replyPolicy || ""}</textarea>
        </label>
        <button type="submit">Enregistrer le prompt</button>
      </form>
    </div>
    <div class="panel">
      <h2>Test local</h2>
      <p class="muted">Cette zone sert uniquement à tester l'interface avant la connexion réelle à Google Business Profile.</p>
      <form id="review-form">
        <label>Auteur <input name="author" placeholder="Nom affiché sur Google" /></label>
        <label>Note
          <select name="rating">
            <option value="5">5/5</option>
            <option value="4">4/5</option>
            <option value="3">3/5</option>
            <option value="2">2/5</option>
            <option value="1">1/5</option>
          </select>
        </label>
        <label>Avis Google <textarea name="text" required></textarea></label>
        <label>Réponse proposée <textarea name="suggestedReply"></textarea></label>
        <button type="submit">Ajouter un avis de test</button>
      </form>
    </div>
    <div class="panel">
      <h2>Avis synchronisés à traiter</h2>
      <p class="muted">Ce sont les avis Google non répondus importés par la synchronisation. Les réponses proposées apparaîtront côté client.</p>
      ${pendingReviews.map((review) => reviewCard(review, "admin")).join("") || "<p class='muted'>Aucun avis à traiter.</p>"}
    </div>
    <div class="panel">
      <h2>Historique des avis répondus</h2>
      <p class="muted">Utile pour comprendre les corrections du client et affiner le ton des prochaines réponses.</p>
      ${historyReviews.map((review) => reviewCard(review, "history")).join("") || "<p class='muted'>Aucun avis répondu pour le moment.</p>"}
    </div>
  `;
}

function adminGoogleLabel(status) {
  if (!status.configured) return "Google n'est pas encore configuré dans Vercel.";
  if (!status.connected) return "Le client n'a pas encore connecté son compte Google.";
  if (!status.googleLocationId) return "Compte Google connecté, établissement pas encore choisi.";
  return `Google connecté${status.connectedEmail ? ` : ${status.connectedEmail}` : ""}.`;
}

function renderEmailPreview(client, pendingReviews, averageRating, totalReviews) {
  const template =
    client.emailTemplate ||
    "Bonjour {{contactName}},\n\nVous avez {{pendingReviews}} avis Google à traiter cette semaine, avec une moyenne de {{averageRating}}/5.\n\nCliquez ici pour les relire, modifier les réponses proposées et publier celles qui vous conviennent : {{loginUrl}}\n\nBonne journée,\nAgent Pilot Avis";
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
    ${clientGooglePanel(googleStatus, googleLocationsResult)}
    ${clientPasswordPanel(me.client)}
    <section>
      ${reviews.filter((review) => review.status === "pending").map((review) => reviewCard(review, "client")).join("") || "<p class='muted'>Aucun avis en attente.</p>"}
    </section>
  `, "Votre espace de validation");
  document.querySelector("#client-google-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/client/google-location", {
        method: "PATCH",
        body: { googleLocationId: form.get("googleLocationId") || "" }
      });
      alert("Établissement Google enregistré.");
      renderClient();
    } catch (error) {
      alert(error.message);
    }
  });
  document.querySelector("#client-password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      alert("Les deux nouveaux mots de passe ne correspondent pas.");
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
      alert("Mot de passe modifié.");
    } catch (error) {
      alert(error.message);
    }
  });
  wireReviewButtons(renderClient);
}

function clientGooglePanel(status, locationsResult) {
  if (!status.configured) {
    return `
      <div class="panel">
        <h2>Compte Google</h2>
        <p class="muted">La connexion Google n'est pas encore activée sur l'application.</p>
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
      <h2>Accès au compte</h2>
      <label>Identifiant
        <input value="${client.email}" disabled />
      </label>
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
        <button type="submit">Modifier le mot de passe</button>
      </form>
    </div>
  `;
}

function reviewCard(review, mode = "client") {
  const showActions = mode !== "history";
  const showSave = mode === "admin";
  const showIgnore = mode === "admin";
  return `
    <article class="review" data-review-id="${review.id}">
      <div class="review-head">
        <div>
          <h3>${review.author}</h3>
          <span class="stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span>
        </div>
        <span class="status ${review.status}">${review.status}</span>
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
      afterSave();
    });
    card.querySelector("[data-publish]")?.addEventListener("click", async () => {
      await api(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        body: { suggestedReply: textarea.value, status: "published" }
      });
      afterSave();
    });
    card.querySelector("[data-ignore]")?.addEventListener("click", async () => {
      await api(`/api/reviews/${reviewId}`, {
        method: "PATCH",
        body: { status: "ignored" }
      });
      afterSave();
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
