# Agent Pilot Avis

Outil local pour préparer, valider et publier des réponses aux avis Google avec l'aide de l'IA.

## Lancer l'application

```bash
npm start
```

Puis ouvrir :

```text
http://localhost:4173
```

## Compatibilité Vercel

Le projet contient :

- `server.js` pour le lancement local ;
- `api/index.js` pour les routes serveur Vercel ;
- `vercel.json` pour router `/api/*` vers la fonction Vercel et le reste vers l'interface.

## Comptes de test

Admin :

```text
admin@agentpilotavis.local
admin123
```

Client :

```text
client@demo.fr
demo123
```

## Ce que contient cette V1

- connexion admin ;
- connexion client ;
- création de clients ;
- suspension/réactivation client ;
- ajout manuel d'avis ;
- réponses proposées ;
- modification côté client ;
- publication simulée ;
- résumé hebdomadaire prêt pour email.

## À connecter ensuite

- Gmail pour envoyer les emails ;
- OpenAI pour générer les réponses ;
- Google Business Profile API pour récupérer et publier les avis ;
- Supabase pour remplacer le fichier local ;
- Vercel pour mettre en ligne.

Le plan de mise en ligne bêta est détaillé ici :

[docs/DEPLOIEMENT_BETA.md](docs/DEPLOIEMENT_BETA.md)

## Activer Supabase

Par défaut, l'application utilise le stockage local `data/db.json`.

Pour passer en stockage Supabase :

1. Créer un projet Supabase.
2. Exécuter le fichier SQL : [supabase/schema.sql](supabase/schema.sql)
3. Lancer l'application avec :

```bash
SUPABASE_URL="https://votre-projet.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="votre-service-role-key" \
npm start
```

La clé `SUPABASE_SERVICE_ROLE_KEY` doit rester secrète et ne doit jamais être exposée dans le frontend.

## Activer la génération IA

Sans clé OpenAI, l'application continue de fonctionner avec une génération locale simple.

Pour activer la vraie génération IA :

```bash
OPENAI_API_KEY="votre-cle" OPENAI_MODEL="gpt-4.1-mini" npm start
```

La réponse est générée à partir :

- du texte de l'avis ;
- de la note ;
- du nom du commerce ;
- du prompt personnalisé du client.

## Activer l'envoi Gmail

Sans configuration Gmail/SMTP, le bouton `Envoyer l'email` reste en mode simulation.

Pour envoyer réellement depuis Gmail, lancer l'application avec :

```bash
SMTP_HOST="smtp.gmail.com" \
SMTP_PORT="465" \
SMTP_USER="votre-adresse@gmail.com" \
SMTP_PASS="mot-de-passe-application" \
SMTP_FROM_NAME="Agent Pilot Avis" \
npm start
```

Important : `SMTP_PASS` doit être un mot de passe d'application Google, pas le mot de passe principal du compte.

Étapes côté Google :

1. Activer la validation en deux étapes sur le compte Gmail.
2. Créer un mot de passe d'application pour l'app.
3. Utiliser ce mot de passe dans `SMTP_PASS`.
