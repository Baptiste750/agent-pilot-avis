# Agent Pilot Avis - Roadmap

## Objectif V1

Créer un outil simple pour aider les commerces à répondre aux avis Google avec l'IA.

Le client doit pouvoir :

- se connecter avec email et mot de passe ;
- voir uniquement ses avis ;
- modifier une réponse proposée ;
- publier ou ignorer une réponse.

L'admin doit pouvoir :

- créer un client ;
- suspendre ou réactiver son accès ;
- synchroniser les avis Google non répondus ;
- choisir une date de début de synchronisation pour éviter d'importer un ancien historique massif ;
- définir le prompt personnalisé de réponse par client ;
- modifier l'email généré avant envoi ;
- transformer ponctuellement ce message en nouveau modèle email si besoin ;
- envoyer l'email au client après synchronisation ;
- consulter l'historique des avis répondus ;
- voir le résumé qui servira aux emails hebdomadaires.

## Étape 1 - Base locale

Statut : démarré.

Cette première version fonctionne sans Vercel, Supabase, Gmail, Google API ou OpenAI API.
Elle utilise un stockage local dans `data/db.json`.

Important : l'ajout manuel d'avis est seulement un mode de test local. Le fonctionnement final doit être :

1. récupérer les avis Google non répondus ;
2. ignorer les avis plus anciens que la date de début définie pour le client ;
3. générer une réponse avec le prompt personnalisé du client ;
4. préparer un email modifiable avec le résumé ;
5. envoyer l'email au client ;
6. laisser le client modifier/publier depuis son espace ;
7. conserver l'historique des avis répondus ;
8. publier sur Google uniquement après validation.

Comptes de test :

- admin : `admin@agentpilotavis.local` / `admin123`
- client : `client@demo.fr` / `demo123`

## Étape 2 - Compte Google dédié

Créer un compte Google séparé, par exemple :

- Nom : Agent Pilot Avis
- Email : `agentpilotavis@gmail.com` ou une adresse avec le futur domaine

Ce compte servira à :

- gérer le projet Google Cloud ;
- envoyer les emails Gmail au début ;
- être ajouté comme gestionnaire ou partenaire sur les fiches Google Business Profile.

## Étape 3 - Gmail

Statut : préparé.

Le bouton d'envoi email utilise Gmail/SMTP si les variables SMTP sont configurées.
Sans configuration, l'envoi reste simulé et historisé localement.

Brancher l'envoi d'email hebdomadaire :

Objet possible :

`Vos réponses aux avis Google sont prêtes`

Contenu possible :

`Bonjour {{contactName}}, vous avez {{pendingReviews}} avis Google à traiter cette semaine, avec une moyenne de {{averageRating}}/5. Connectez-vous ici pour les vérifier : {{loginUrl}}`

Variables nécessaires :

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM_NAME`

## Étape 4 - OpenAI

Statut : préparé.

La suggestion locale est remplacée automatiquement par un appel API OpenAI dès que `OPENAI_API_KEY` est configurée.
Sans clé, l'application garde un fallback local pour continuer les tests.

Le prompt devra utiliser :

- le texte de l'avis ;
- la note ;
- le nom du commerce ;
- le prompt personnalisé du client ;
- une règle de prudence pour les avis sensibles.

Variables nécessaires :

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

## Étape 5 - Google Business Profile

Brancher la récupération et publication des avis via Google Business Profile API.

La synchronisation devra importer seulement :

- les avis du bon établissement ;
- les avis non répondus ;
- les avis qui n'ont pas déjà été importés ;
- les avis récents depuis la dernière synchronisation.

Variables nécessaires :

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- identifiants OAuth par client
- `googleLocationId`

## Étape 6 - Mise en ligne

Quand la V1 locale est stable :

- hébergement Vercel ;
- base Supabase préparée via `supabase/schema.sql` ;
- domaine ;
- variables secrètes ;
- sauvegardes ;
- comptes clients réels.
