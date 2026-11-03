# Note de cadrage / Document de vision — FileFlow

| | |
|---|---|
| **Titre** | Note de cadrage / Vision — Plateforme FileFlow |
| **Version** | 1.1 |
| **Date** | 27 octobre 2026 |
| **Statut** | Validé |
| **Propriétaire** | Driss OUAAZIZ — Software Architect |
| **Classification** | Interne |

> Références méthodologiques : *PMBOK Guide* (PMI) — « Project Charter » ; méthode PRINCE2 — « Project Brief ».

---

## Table des matières

1. Objet du document
2. Contexte métier et enjeu
3. Objectifs
4. Périmètre
5. Parties prenantes
6. Hypothèses
7. Contraintes
8. Facteurs clés de succès
9. Jalons indicatifs
10. Risques macro
11. Validation

---

## 1. Objet du document

La présente note de cadrage formalise la vision, les objectifs, le périmètre et les contraintes du produit **FileFlow**. Elle constitue le document de référence initial engageant l'ensemble des parties prenantes sur une compréhension commune du projet. Elle est complétée par l'étude de faisabilité technique (`02-etude-faisabilite-technique.md`), le dossier d'architecture technique (`03-dossier-architecture-technique.md`), le dossier de sécurité (`06-dossier-securite-threat-model.md`) et le dossier de conformité RGPD (`07-conformite-rgpd.md`).

## 2. Contexte métier et enjeu

Les organisations font face à un besoin croissant de partage et de gestion de fichiers en conservant la **maîtrise pleine et entière de leurs données**. Le recours aux services de stockage dans des clouds tiers soulève des difficultés de souveraineté, de localisation des données, de dépendance à un fournisseur et de conformité réglementaire.

FileFlow répond à cet enjeu en proposant une **plateforme de gestion de fichiers auto-hébergée**, déployable sur l'infrastructure propre de l'organisation. Le produit est distribué sous la forme d'un **mono-binaire** accompagné d'une interface web moderne, minimisant l'empreinte opérationnelle et la surface d'exposition.

Bénéfices attendus :

- **Souveraineté** : les données ne quittent jamais l'infrastructure de l'organisation.
- **Simplicité d'exploitation** : un seul artefact à déployer, sans dépendance externe lourde.
- **Sécurité par conception** : contrôle d'accès fin, journalisation, durcissement applicatif et système.
- **Coût maîtrisé** : absence de facturation à l'usage propre aux services tiers.

## 3. Objectifs

### 3.1 Objectifs généraux

- Offrir une gestion de fichiers complète (navigation, upload, téléchargement, renommage, déplacement, corbeille, versions).
- Permettre le partage interne (entre utilisateurs) et externe (liens publics) de manière contrôlée et traçable.
- Garantir un niveau de sécurité et de confidentialité adapté à un usage professionnel.
- Rester exploitable par une équipe réduite grâce à un déploiement et une supervision simples.

### 3.2 Objectifs SMART

| Réf. | Objectif | Indicateur de réussite |
|---|---|---|
| O1 | Déployer la plateforme via un artefact unique | Image conteneur unique déployable par `docker compose up`, démarrage < 10 s |
| O2 | Sécuriser l'accès applicatif | Authentification JWT + 2FA TOTP, RBAC opérationnel, verrouillage anti-force brute |
| O3 | Réduire la surface d'attaque de l'image | Image finale statique sur base *distroless*, ≈ 11,3 Mo, 0 CVE au scan de l'image |
| O4 | Assurer la traçabilité | Journal d'audit exhaustif des actions sensibles, exportable |
| O5 | Maîtriser la consommation de stockage | Quotas par utilisateur appliqués à l'upload |
| O6 | Garantir la disponibilité | Sonde de santé et arrêt gracieux, redémarrage automatique |

## 4. Périmètre

### 4.1 Inclus

- Gestion de fichiers et de répertoires (CRUD, corbeille avec rétention, versionnage).
- Recherche par nom, par contenu (texte) et par étiquettes.
- Prévisualisation intégrée (images, PDF, texte/code avec coloration syntaxique, Markdown, CSV, tableurs, documents Word).
- Partage : liens publics (avec expiration, mot de passe, limite de téléchargements), partages internes utilisateur-à-utilisateur, dossiers collaboratifs, demandes d'upload publiques.
- Authentification, gestion des utilisateurs, groupes, rôles et permissions ; double authentification (TOTP) et codes de récupération.
- Journalisation d'audit et export.
- Administration : gestion des comptes, quotas, révocation de sessions.

### 4.2 Exclus

- Édition collaborative en temps réel du contenu des fichiers.
- Prévisualisation avec rendu graphique des présentations (les fichiers PowerPoint sont proposés au téléchargement).
- Synchronisation de type client de bureau (hors périmètre de la version courante).
- Fédération multi-instances.

## 5. Parties prenantes

| Partie prenante | Rôle | Intérêt principal |
|---|---|---|
| Direction / commanditaire | Sponsor | Souveraineté, maîtrise des coûts, conformité |
| Équipe Ingénierie FileFlow | Conception et réalisation | Qualité, maintenabilité, sécurité |
| Équipe Exploitation / SRE | Déploiement et supervision | Fiabilité, exploitabilité, sauvegardes |
| Responsable sécurité (RSSI) | Validation sécurité | Réduction des risques, conformité |
| Délégué à la protection des données (DPO) | Conformité RGPD | Protection des données personnelles |
| Utilisateurs finaux | Usage quotidien | Simplicité, performance, fiabilité |
| Administrateurs | Gestion de l'instance | Contrôle d'accès, supervision, quotas |

## 6. Hypothèses

- La plateforme est déployée sur une infrastructure maîtrisée par l'organisation (serveur, conteneur ou orchestrateur).
- Un terminaison TLS est assurée en amont (reverse-proxy) pour tout déploiement en production.
- Les volumes de données et de fichiers sont fournis par des supports persistants et sauvegardés.
- Le nombre d'utilisateurs par instance reste dans un ordre de grandeur compatible avec une architecture mono-nœud (voir étude de faisabilité).
- L'organisation déployant l'instance en est le responsable de traitement au sens du RGPD.

## 7. Contraintes

### 7.1 Contraintes techniques

- Distribution sous forme d'un mono-binaire et d'une image conteneur unique.
- Persistance locale sans serveur de base de données externe (SQLite embarqué).
- Architecture mono-nœud pour la version courante.

### 7.2 Contraintes de sécurité

- Chiffrement des échanges en transit assuré par la terminaison TLS amont.
- Cookies d'authentification `HttpOnly`, `SameSite=Strict`, attribut `Secure` en production.
- Politique de sécurité de contenu (CSP) stricte et en-têtes de sécurité systématiques.
- Contrôle d'accès fondé sur les rôles et les permissions, avec restriction par chemins.
- Protection contre la traversée de répertoires et le contenu actif téléversé.

### 7.3 Contraintes réglementaires

- Respect du RGPD (Règlement UE 2016/679) pour les données personnelles traitées : identifiants, adresse e-mail optionnelle, adresses IP consignées dans le journal d'audit, et contenu des fichiers utilisateurs. Détail dans `07-conformite-rgpd.md`.

### 7.4 Contraintes opérationnelles

- Déploiement et supervision par une équipe réduite.
- Sauvegarde et restauration reposant sur des procédures documentées (voir `10-dossier-exploitation-dex.md`).

## 8. Facteurs clés de succès

- Simplicité de déploiement et d'exploitation.
- Niveau de sécurité vérifiable et documenté.
- Performance perçue satisfaisante pour la navigation et les transferts.
- Traçabilité complète des actions sensibles.
- Documentation d'ingénierie et d'exploitation à jour et exploitable.

## 9. Jalons indicatifs

| Jalon | Contenu | Livrable associé |
|---|---|---|
| J1 — Cadrage | Vision, objectifs, périmètre | Présente note |
| J2 — Faisabilité | Validation technique | `02-etude-faisabilite-technique.md` |
| J3 — Conception | Architecture, décisions, sécurité, conformité | `03`, `04`, `05`, `06`, `07` |
| J4 — Réalisation | Développement et intégration continue | Code, `09`, `10` |
| J5 — Livraison | Mise en production et exploitation | `10-dossier-exploitation-dex.md` |
| J6 — Vie du produit | Supervision, dette technique | `11`, `12` |

## 10. Risques macro

| Réf. | Risque | Impact | Probabilité | Parade |
|---|---|---|---|---|
| RM1 | Montée en charge au-delà de l'architecture mono-nœud | Moyen | Moyenne | Cadrage des volumes ; évolution vers un pool de connexions puis une architecture répartie |
| RM2 | Mauvaise configuration de sécurité au déploiement | Élevé | Moyenne | Valeurs par défaut sûres, documentation d'exploitation, listes de vérification |
| RM3 | Perte de données par défaut de sauvegarde | Élevé | Faible | Procédures de sauvegarde/restauration documentées et testées |
| RM4 | Non-conformité RGPD à l'usage | Élevé | Faible | Registre des traitements, minimisation, rétention maîtrisée |
| RM5 | Vulnérabilité applicative | Élevé | Faible | Chaîne d'analyse en intégration continue, revues de sécurité, durcissement |

## 11. Validation

| Rôle | Nom | Date | Décision |
|---|---|---|---|
| Sponsor | | 21 juillet 2026 | Validé |
| Responsable Ingénierie | | 21 juillet 2026 | Validé |
| RSSI | | 21 juillet 2026 | Validé |
