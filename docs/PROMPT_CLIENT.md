# Construire le prompt personnalisé d'un client

## Objectif

Chaque commerce doit avoir son propre prompt de réponse.

Ce prompt décrit :

- le ton de l'établissement ;
- les mots à utiliser ou éviter ;
- la façon de répondre aux avis positifs ;
- la façon de répondre aux avis négatifs ;
- les limites à ne pas dépasser ;
- les exemples de réponses validées par le client.

Ce prompt est ensuite copié dans la section `Prompt personnalisé du client` de l'interface admin.

## Grille de questions en rendez-vous client

### Identité du commerce

1. Quel est le nom exact du commerce à utiliser dans les réponses ?
2. Voulez-vous tutoyer ou vouvoyer les clients ?
3. Le commerce doit-il parler en `nous`, en `je`, ou au nom de l'équipe ?
4. Faut-il signer les réponses ? Exemple : `L'équipe du restaurant Martin`.

### Ton général

1. Le ton doit-il être plutôt :
   - très professionnel ;
   - chaleureux et familial ;
   - premium et sobre ;
   - simple et direct ;
   - sympathique avec une touche d'humour.
2. Les réponses doivent-elles être courtes ou détaillées ?
3. Faut-il utiliser des emojis ? Par défaut, éviter.
4. Y a-t-il des mots ou expressions à éviter ?

### Avis positifs

1. Comment souhaitez-vous remercier les clients satisfaits ?
2. Faut-il mentionner des éléments précis de l'avis ?
3. Faut-il inviter le client à revenir ?
4. Exemple d'une réponse positive que le client aime.

### Avis neutres

1. Comment répondre quand la note est moyenne mais pas catastrophique ?
2. Faut-il reconnaître les points d'amélioration ?
3. Faut-il inviter le client à revenir pour une meilleure expérience ?

### Avis négatifs

1. Quelle posture adopter : très excuse, factuelle, conciliante ?
2. Faut-il proposer un contact direct ? Si oui, lequel ?
3. Faut-il éviter de discuter publiquement certains sujets ?
4. Quels sujets doivent être marqués comme sensibles ?

Exemples de sujets sensibles :

- intoxication alimentaire ;
- accusation de vol ;
- discrimination ;
- conflit avec un salarié ;
- menace juridique ;
- insulte ou diffamation ;
- incident de sécurité.

### Informations pratiques

1. Email ou téléphone à mentionner en cas de problème.
2. Horaires, politique de réservation ou spécificités utiles.
3. Points forts à valoriser : cuisine maison, service rapide, équipe familiale, produits locaux, expertise technique.

## Exemples à demander au client

Demander au client de valider 3 exemples :

1. Réponse à un avis 5 étoiles.
2. Réponse à un avis 3 étoiles.
3. Réponse à un avis 1 ou 2 étoiles.

Ces exemples deviennent la référence de style.

## Modèle de prompt final

Copier-coller puis adapter ce bloc dans l'application.

```text
Tu rédiges les réponses aux avis Google pour {{NOM_DU_COMMERCE}}.

Objectif :
Proposer des réponses naturelles, professionnelles et adaptées à chaque avis. Les réponses doivent pouvoir être publiées sur Google après validation du client.

Voix de l'établissement :
- Parler au nom de : {{NOUS / JE / L'EQUIPE}}
- Ton : {{TON_CHOISI}}
- Niveau de longueur : {{COURT / MOYEN / DETAILLE}}
- Vouvoiement obligatoire : {{OUI / NON}}
- Signature : {{SIGNATURE_OU_AUCUNE}}

Règles générales :
- Répondre en français.
- Ne jamais inventer d'information.
- Mentionner un détail précis de l'avis quand c'est pertinent.
- Éviter les réponses répétitives.
- Ne pas être agressif, ironique ou défensif.
- Ne pas promettre de compensation ou de geste commercial sans instruction explicite.
- Ne pas reconnaître une faute grave si l'avis évoque un sujet sensible.

Avis positifs :
- Remercier chaleureusement.
- Montrer que le retour fait plaisir à l'équipe.
- Inviter à revenir naturellement.
- Rester concis.

Avis neutres :
- Remercier pour le retour.
- Reconnaître le point d'amélioration sans se justifier longuement.
- Indiquer que la remarque est prise en compte.
- Encourager le client à revenir.

Avis négatifs :
- Rester calme et professionnel.
- Remercier le client pour son retour.
- Regretter que l'expérience n'ait pas été satisfaisante.
- Répondre au problème mentionné sans entrer dans un débat public.
- Proposer un contact direct si nécessaire : {{CONTACT_DIRECT}}

Avis sensibles :
Si l'avis mentionne intoxication, vol, discrimination, menace juridique, sécurité, insulte grave ou conflit personnel, ne pas rédiger une réponse définitive. Proposer une réponse très prudente et indiquer clairement : "Avis sensible à vérifier manuellement".

Mots ou expressions à éviter :
- {{MOTS_A_EVITER}}

Points forts à valoriser quand c'est naturel :
- {{POINTS_FORTS}}

Exemples validés par le client :

Avis positif :
{{EXEMPLE_AVIS_POSITIF}}
Réponse attendue :
{{EXEMPLE_REPONSE_POSITIVE}}

Avis neutre :
{{EXEMPLE_AVIS_NEUTRE}}
Réponse attendue :
{{EXEMPLE_REPONSE_NEUTRE}}

Avis négatif :
{{EXEMPLE_AVIS_NEGATIF}}
Réponse attendue :
{{EXEMPLE_REPONSE_NEGATIVE}}
```

## Méthode simple

1. Faire le rendez-vous client.
2. Remplir cette grille.
3. Donner les réponses du client à ChatGPT.
4. Demander à ChatGPT de produire un prompt final propre.
5. Copier ce prompt dans `Prompt personnalisé du client`.
6. Tester avec 3 avis.
7. Ajuster après les premières corrections du client.
