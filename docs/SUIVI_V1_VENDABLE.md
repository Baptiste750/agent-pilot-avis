# Suivi V1 vendable - Agent Pilot Avis

Objectif : transformer l'application actuelle en version beta exploitable avec quelques commerces reels, avant de travailler la vente et la partie commerciale.

Lien application : [ouvrir Agent Pilot Avis](https://agent-pilot-avis.vercel.app/)

## Acces utiles

Application en ligne :

- Lien : [https://agent-pilot-avis.vercel.app/](https://agent-pilot-avis.vercel.app/)
- Admin production : utiliser l'email et le mot de passe configures dans Vercel.
- Important : ne pas noter le vrai mot de passe admin de production dans ce fichier, car il peut etre envoye sur GitHub.

Acces de test local/developpement :

- Admin local : `admin@agentpilotavis.local` / `admin123`
- Client demo local : `client@demo.fr` / `demo123`

Acces client reel :

- Identifiant : defini lors de la creation du client dans l'admin.
- Mot de passe temporaire : defini lors de la creation du client dans l'admin.
- Le client peut ensuite modifier son mot de passe depuis son espace.

## Etat actuel

- [x] Application hebergee en ligne sur Vercel.
- [x] Base Supabase connectee.
- [x] Espace administrateur.
- [x] Creation de clients.
- [x] Modification de l'identifiant client cote admin.
- [x] Reinitialisation du mot de passe client cote admin.
- [x] Espace client separe.
- [x] Connexion Google cote client.
- [x] Selection d'un etablissement Google.
- [x] Synchronisation reelle des avis Google validee.
- [x] Generation de reponses avec OpenAI.
- [x] Validation/modification des reponses par le client.
- [x] Historique des avis traites.
- [x] Premiere direction artistique plus premium.

## Chapitre 1 - Test reel Google de bout en bout

But : verifier que le coeur du produit fonctionne avec une vraie fiche Google.

- [x] Creer un client test cote admin.
- [x] Se connecter avec le compte client test.
- [x] Connecter le vrai compte Google qui gere une fiche.
- [x] Verifier que les etablissements Google remontent bien.
- [x] Selectionner le bon etablissement.
- [x] Synchroniser les avis depuis l'admin.
- [x] Verifier que seuls les avis non repondus et recents remontent.
- [x] Verifier que l'IA propose bien des reponses.
- [x] Modifier une reponse cote client.
- [x] Publier une reponse.
- [x] Verifier que la reponse apparait bien sur Google.
- [x] Noter les erreurs ou blocages rencontres.

Resultat attendu : on sait si la chaine Google complete fonctionne vraiment.

## Chapitre 2 - Fiabilisation Google

But : rendre le parcours Google plus robuste avant de le proposer a un commerce.

- [x] Clarifier les messages si Google n'est pas connecte.
- [x] Clarifier les messages si aucun etablissement n'est trouve.
- [ ] Clarifier les messages si la fiche choisie n'a pas d'avis accessible.
- [x] Ajouter un etat clair quand la synchronisation est en cours.
- [x] Ajouter un message clair quand aucun nouvel avis n'est trouve.
- [x] Verifier que la date de debut de synchronisation evite l'import massif d'anciens avis.
- [x] Verifier qu'un meme avis Google n'est pas importe deux fois.
- [ ] Verifier le comportement si le client reconnecte Google.

Resultat attendu : le client comprend ce qui se passe, meme quand Google ne renvoie rien ou renvoie une erreur.

## Chapitre 3 - Prompt client et questionnaire de ton

But : faire du prompt la vraie difference commerciale du service.

- [ ] Rediger le questionnaire de rendez-vous client.
- [ ] Definir les questions sur le ton de marque.
- [ ] Definir les questions sur les mots a utiliser ou eviter.
- [ ] Definir les questions sur la gestion des avis negatifs.
- [ ] Definir les questions sur les excuses, gestes commerciaux et limites.
- [ ] Creer 5 a 10 exemples d'avis types.
- [ ] Creer une methode pour transformer les reponses du questionnaire en prompt client.
- [ ] Tester le prompt sur plusieurs avis reels.
- [ ] Ajouter une zone admin plus claire pour coller/modifier ce prompt.

Resultat attendu : chaque client a un style de reponse personnalise et coherent.

## Chapitre 4 - Interface client

But : rendre l'espace client tres simple pour un commerce non technique.

- [ ] Clarifier la page client autour d'une action principale : relire et publier.
- [ ] Mettre en avant le nombre d'avis en attente.
- [ ] Distinguer clairement les avis a traiter et l'historique.
- [ ] Rendre la connexion Google plus rassurante.
- [ ] Rendre le changement de mot de passe discret mais accessible.
- [ ] Ameliorer les messages de confirmation.
- [ ] Verifier le rendu mobile.
- [ ] Verifier que le client ne voit jamais les donnees d'un autre client.

Resultat attendu : un restaurateur ou commercant comprend l'outil en moins d'une minute.

## Chapitre 5 - Interface administrateur

But : te permettre de gerer plusieurs clients sans confusion.

- [x] Retirer la zone de test local de l'interface admin.
- [ ] Ameliorer la liste des clients.
- [ ] Ajouter une vue claire du statut Google par client.
- [ ] Ajouter une vue claire du nombre d'avis en attente par client.
- [ ] Ajouter une action simple : synchroniser puis envoyer l'email.
- [ ] Conserver l'historique des emails envoyes.
- [ ] Conserver l'historique des synchronisations.
- [ ] Ameliorer la creation client.
- [x] Permettre a l'admin de modifier l'identifiant client.
- [x] Permettre a l'admin de definir un nouveau mot de passe temporaire.
- [ ] Ajouter une indication claire si un client est suspendu.

Resultat attendu : tu peux gerer plusieurs commerces sans te perdre.

## Chapitre 6 - Emails client

But : envoyer un email propre qui ramene le client vers son espace.

- [ ] Verifier si l'envoi email reel fonctionne.
- [x] Rediger un email type professionnel.
- [x] Ajouter le lien direct vers l'espace client.
- [x] Ajouter le resume : nombre d'avis, moyenne, periode.
- [x] Ajouter un historique des emails envoyes.
- [ ] Prevoir un message different si aucun avis n'est en attente.
- [ ] Verifier que le client recoit bien l'email.

Resultat attendu : le client recoit un email clair et clique pour valider ses reponses.

## Chapitre 7 - Securite et exploitation

But : eviter les problemes avant de vendre a de vrais clients.

- [ ] Verifier l'isolation des comptes clients.
- [ ] Renforcer les mots de passe ou imposer une longueur minimale.
- [ ] Ajouter une procedure si un client oublie son mot de passe.
- [ ] Verifier que les cles API ne sont jamais visibles cote client.
- [ ] Verifier la suspension d'un client qui ne paye pas.
- [ ] Ajouter des messages d'erreur comprehensibles.
- [ ] Garder une trace des actions importantes : sync, publication, email.
- [ ] Prevoir une sauvegarde ou export des donnees importantes.

Resultat attendu : l'application peut etre utilisee avec de vrais commerces avec un risque limite.

## Chapitre 8 - Cadre legal minimum

But : vendre proprement sans donner l'impression d'un outil improvise.

- [ ] Ajouter une case d'acceptation des conditions.
- [ ] Rediger des conditions d'utilisation simples.
- [ ] Preciser que les reponses sont generees avec assistance IA.
- [ ] Preciser que le client reste responsable de la validation/publication.
- [ ] Preciser les acces Google demandes.
- [ ] Ajouter une mention de confidentialite des donnees.
- [ ] Preparer un modele de contrat ou bon de commande simple.

Resultat attendu : le client comprend ce qu'il autorise et ce qu'il valide.

## Chapitre 9 - Beta commerciale

But : tester avec quelques vrais commerces avant de vendre plus largement.

- [ ] Choisir 1 a 3 commerces pilotes.
- [ ] Installer chaque client dans l'outil.
- [ ] Faire le rendez-vous questionnaire de ton.
- [ ] Lancer une premiere synchronisation encadree.
- [ ] Faire valider les premieres reponses.
- [ ] Recueillir les retours client.
- [ ] Corriger les points bloquants.
- [ ] Decider du prix beta.
- [ ] Preparer l'offre mensuelle.

Resultat attendu : obtenir des preuves terrain avant de demarcher plus largement.

## Priorite immediate

La prochaine action est :

1. Faire le test reel Google de bout en bout.
2. Noter precisement ce qui marche et ce qui bloque.
3. Corriger les blocages du Chapitre 1 avant de passer au Chapitre 2.

## Notes de test

Ajouter ici les observations pendant les tests :

- Date :
- Client test :
- Compte Google utilise :
- Etablissement teste :
- Resultat de la synchronisation :
- Resultat de la generation IA :
- Resultat de la publication :
- Probleme rencontre :
- Correction a prevoir :
