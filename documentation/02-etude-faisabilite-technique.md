# Étude de faisabilité technique — FileFlow

| | |
|---|---|
| **Titre** | Étude de faisabilité technique — Plateforme FileFlow |
| **Version** | 1.0 |
| **Date** | 21 juillet 2026 |
| **Statut** | Validé |
| **Propriétaire** | Driss OUAAZIZ — Software Architect |
| **Classification** | Interne |

> Référence méthodologique : ISO/IEC/IEEE 29148 (ingénierie des exigences).

---

## Table des matières

1. Objet
2. Faisabilité technique
3. Contraintes non fonctionnelles
4. Alternatives techniques envisagées et écartées
5. Risques techniques et mitigations
6. Conclusion

---

## 1. Objet

Cette étude évalue la faisabilité technique du produit FileFlow tel que défini dans la note de cadrage (`01-note-de-cadrage.md`) et statue sur l'opportunité de poursuivre en conception détaillée. Elle valide la pertinence des choix structurants et identifie les risques techniques ainsi que leurs parades. L'architecture retenue est détaillée dans le dossier d'architecture technique (`03-dossier-architecture-technique.md`).

## 2. Faisabilité technique

### 2.1 Pile technologique

| Couche | Technologie | Justification |
|---|---|---|
| Backend | Rust, framework web `axum` 0.7 | Sûreté mémoire native, performances, mono-binaire sans exécutant externe |
| Frontend | React 18, TypeScript, Vite, Zustand, Tailwind CSS | Écosystème mature, rendu réactif, empaquetage optimisé, servi par le backend |
| Persistance de configuration | SQLite (`.fileflow.db`, mode WAL) | Base embarquée sans serveur, transactions durables, exploitation triviale |
| Stockage des fichiers | Système de fichiers sous `ROOT_DIR` | Simplicité, portabilité, sauvegarde standard |
| Journal d'audit | Fichier JSONL en append | Écriture O(1), lisible, exportable |

Le backend sert à la fois l'API REST sous `/api` et l'application web (fichiers statiques du SPA), ce qui supprime le besoin d'un serveur web additionnel.

### 2.2 Modèle de persistance

Les données de configuration (utilisateurs, groupes, partages, dossiers collaboratifs, partages internes, demandes d'upload, favoris) sont persistées dans une base SQLite unique organisée en **document-store** : une table par domaine, chaque entité sérialisée en JSON. Un **cache mémoire en écriture immédiate (write-through)** sert les lectures et propage chaque mutation ligne à ligne, évitant toute réécriture globale. Ce modèle est adapté à la volumétrie de configuration attendue et offre une exploitation sans serveur de base de données dédié.

### 2.3 Confinement et sécurité applicative

La faisabilité d'un niveau de sécurité professionnel est établie par des mécanismes éprouvés et déjà intégrés : résolution de chemins protégée contre la traversée de répertoires, isolement des données internes sous `.fileflow/`, authentification JWT en cookie `HttpOnly`/`SameSite=Strict` avec révocation par version de jeton, contrôle d'accès par rôles et permissions, double authentification TOTP, politique de sécurité de contenu stricte, dégradation du contenu actif téléversé, limitation de débit sur l'authentification, et application de quotas de stockage. Le détail figure dans le dossier de sécurité (`06-dossier-securite-threat-model.md`).

### 2.4 Déploiement

Le produit est empaqueté en **image conteneur statique** : binaire lié statiquement (cible `x86_64-unknown-linux-musl`) déposé sur une base **distroless/static**. L'image finale (≈ 11,3 Mo) ne contient ni interpréteur de commandes, ni bibliothèque système superflue, ce qui réduit fortement la surface d'attaque et supprime les vulnérabilités héritées d'une base système classique. Le déploiement s'effectue par `docker compose`, avec sonde de santé intégrée et arrêt gracieux. La faisabilité opérationnelle est donc établie.

## 3. Contraintes non fonctionnelles

| Exigence | Cible | Faisabilité |
|---|---|---|
| Performance | Navigation fluide, transferts en flux (streaming) sans bufferisation intégrale en mémoire | Établie : lecture/écriture en flux, uploads chunkés reprenables, archives ZIP construites hors du fil applicatif |
| Sécurité | Durcissement applicatif et système, traçabilité | Établie : voir §2.3 et dossier de sécurité |
| Portabilité | Exécution sur toute infrastructure conteneurisée | Établie : binaire statique, image autonome |
| Exploitabilité | Déploiement et supervision par équipe réduite | Établie : artefact unique, sonde de santé, journaux, procédures documentées |
| Robustesse | Résistance aux entrées malveillantes | Établie : validations strictes, campagnes de test dédiées aux analyseurs d'entrées |
| Maîtrise du stockage | Quotas par utilisateur | Établie : contrôle appliqué au fil de l'upload |

## 4. Alternatives techniques envisagées et écartées

| Sujet | Alternative | Décision | Motif |
|---|---|---|---|
| Persistance de configuration | Serveur de base de données externe (PostgreSQL) | Écartée | Alourdit l'exploitation ; la volumétrie de configuration ne le justifie pas |
| Persistance de configuration | Fichiers JSON réécrits intégralement | Écartée | Réécriture globale coûteuse (O(n)) ; remplacée par SQLite en écritures unitaires |
| Backend cryptographique (JWT) | Backend s'appuyant sur des bibliothèques C | Écartée | Introduit des dépendances système ; retenue d'un backend Rust pur, compatible binaire statique |
| Image d'exécution | Base système complète (Debian *slim*) | Écartée | Vulnérabilités système héritées et image volumineuse ; retenue de *distroless/static* |
| Prévisualisation des présentations | Bibliothèque de rendu de diapositives | Écartée | Dépendances vulnérables et point d'injection ; PowerPoint proposé au téléchargement |

## 5. Risques techniques et mitigations

| Réf. | Risque technique | Impact | Mitigation |
|---|---|---|---|
| RT1 | Contention en écriture sur la connexion SQLite unique | Moyen | Cache en lecture, écritures unitaires ; évolution possible vers un pool de connexions |
| RT2 | Montée en charge au-delà du mono-nœud | Moyen | Cadrage des volumes ; palier d'évolution identifié (pool puis répartition) |
| RT3 | Cohérence des métadonnées lors d'opérations concurrentes | Moyen | Verrous dédiés sur les sections critiques (métadonnées, corbeille) |
| RT4 | Épuisement mémoire sur transferts volumineux | Élevé | Traitement en flux, plafonds de taille, construction d'archives sur disque temporaire |
| RT5 | Entrées malveillantes sur les analyseurs (chemins, en-têtes, noms de fichiers) | Élevé | Validations strictes et campagnes de test par fuzzing sur les analyseurs exposés |

## 6. Conclusion

La faisabilité technique du produit est **établie** sur l'ensemble des dimensions évaluées : pile technologique maîtrisée, modèle de persistance adapté, sécurité applicative et système démontrée, déploiement simple et robuste. Les risques identifiés disposent de parades documentées et d'un chemin d'évolution clair. 

**Décision : GO** pour la phase de conception détaillée.
