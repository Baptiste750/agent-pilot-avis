# Déploiement bêta - Agent Pilot Avis

## Point important sur Gmail

Le connecteur Gmail disponible dans Codex permet à Codex de lire, préparer ou envoyer des emails pendant une conversation.

Il ne fournit pas des identifiants permanents que l'application peut utiliser une fois hébergée.

Pour l'application, il faudra donc utiliser une de ces deux options :

1. Gmail SMTP avec mot de passe d'application.
2. Gmail API avec OAuth Google.

Pour la bêta, l'option la plus simple est Gmail SMTP.

## Pourquoi l'app locale ne suffit pas

En local, l'application tourne sur :

```text
http://127.0.0.1:4173
```

Ce lien fonctionne seulement sur l'ordinateur qui lance l'app.
Un client extérieur ne peut pas y accéder.

Pour envoyer un lien client, il faut héberger l'application en ligne :

```text
https://agent-pilot-avis.vercel.app
```

ou plus tard :

```text
https://app.agentpilotavis.fr
```

## Pourquoi il faut remplacer `data/db.json`

Aujourd'hui, les clients, avis et sessions sont stockés dans :

```text
data/db.json
```

C'est suffisant pour développer localement.

Mais sur Vercel, ce stockage local n'est pas adapté à une vraie application :

- les données peuvent être perdues entre déploiements ;
- plusieurs requêtes ne partagent pas forcément le même fichier ;
- ce n'est pas prévu pour des comptes clients réels ;
- les sessions et mots de passe doivent être mieux sécurisés.

Pour la bêta en ligne, il faut donc passer à Supabase.

## Architecture bêta recommandée

```text
Vercel
- héberge l'interface et le serveur

Supabase
- stocke les clients
- stocke les avis
- stocke les réponses
- stocke les historiques email
- gère les comptes et sessions

Gmail SMTP
- envoie les emails aux clients

OpenAI API
- génère les réponses aux avis

Google Business Profile API
- récupère les avis Google
- publie les réponses validées
```

## Étapes dans l'ordre

### Étape 1 - Créer Supabase

1. Créer un compte Supabase.
2. Créer un projet `agent-pilot-avis`.
3. Récupérer :
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

Projet Supabase actuellement préparé :

```text
Project ID: rimrxakdskbglozxftnz
URL probable: https://rimrxakdskbglozxftnz.supabase.co
```

Les tables sont créées et RLS est activé. Aucune politique publique n'est créée pour l'instant : l'accès doit passer par le serveur avec `SUPABASE_SERVICE_ROLE_KEY`.

### Étape 2 - Migrer la base locale

Remplacer `data/db.json` par des tables Supabase :

- `clients`
- `reviews`
- `email_logs`
- `sessions` ou Supabase Auth

Statut côté code : préparé.

Le serveur utilise encore `data/db.json` par défaut. Dès que `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont configurés, il bascule sur Supabase.

Le schéma SQL à exécuter dans Supabase est disponible ici :

```text
supabase/schema.sql
```

### Étape 3 - Créer les variables d'environnement

Variables nécessaires pour la bêta :

```text
ADMIN_EMAIL=
ADMIN_PASSWORD=
OPENAI_API_KEY=
OPENAI_MODEL=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM_NAME=Agent Pilot Avis
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

### Étape 4 - Héberger sur Vercel

1. Créer un compte Vercel.
2. Importer le projet.
3. Ajouter les variables d'environnement.
4. Déployer.
5. Tester l'URL publique.

Statut côté code : préparé.

Le projet contient :

- `api/index.js` pour les appels serveur ;
- `vercel.json` pour router `/api/*` vers Vercel ;
- `public/` pour l'interface.

Variables Vercel minimales pour une bêta en ligne :

```text
APP_BASE_URL=https://votre-url-vercel.vercel.app
ADMIN_EMAIL=
ADMIN_PASSWORD=
SUPABASE_URL=https://rimrxakdskbglozxftnz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM_NAME=Agent Pilot Avis
```

`APP_BASE_URL` est important : c'est le lien qui sera mis dans les emails envoyés aux clients.

### Étape 5 - Gmail

Pour Gmail SMTP :

1. Activer la validation en deux étapes sur le compte Gmail.
2. Créer un mot de passe d'application.
3. Mettre ce mot de passe dans `SMTP_PASS`.

Le mot de passe principal Gmail ne doit pas être utilisé dans l'application.

### Étape 6 - Google Business Profile

Quand la base et l'hébergement sont stables :

1. Créer le projet Google Cloud.
2. Activer Google Business Profile API.
3. Configurer OAuth.
4. Connecter une fiche test.
5. Remplacer la synchronisation simulée par la vraie récupération Google.

## Ordre technique recommandé maintenant

1. Migrer vers Supabase.
2. Déployer sur Vercel.
3. Configurer Gmail SMTP.
4. Configurer OpenAI.
5. Brancher Google Business Profile.

Cet ordre évite de connecter Google trop tôt sur une app encore locale.
