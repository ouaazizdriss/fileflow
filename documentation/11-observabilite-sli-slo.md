# Observabilité, SLI et SLO — FileFlow

| | |
|---|---|
| **Titre** | Documentation d'observabilité (SLI / SLO) — Plateforme FileFlow |
| **Version** | 1.1 |
| **Date** | 27 octobre 2026 |
| **Statut** | Validé |
| **Propriétaire** | Driss OUAAZIZ — Software Architect |
| **Classification** | Interne |

---

## Table des matières

1. [Objet et périmètre](#1-objet-et-périmètre)
2. [Piliers de l'observabilité](#2-piliers-de-lobservabilité)
3. [Indicateurs de niveau de service (SLI)](#3-indicateurs-de-niveau-de-service-sli)
4. [Objectifs de niveau de service (SLO) et budgets d'erreur](#4-objectifs-de-niveau-de-service-slo-et-budgets-derreur)
5. [Matrice SLI → SLO → mesure](#5-matrice-sli--slo--mesure)
6. [Alerting](#6-alerting)
7. [Tableaux de bord recommandés](#7-tableaux-de-bord-recommandés)
8. [Feuille de route d'instrumentation](#8-feuille-de-route-dinstrumentation)
9. [Références](#9-références)

---

## 1. Objet et périmètre

Ce document définit la stratégie d'observabilité de la plateforme **FileFlow** : les signaux exploités, les indicateurs de niveau de service (SLI), les objectifs associés (SLO) et leurs budgets d'erreur, les règles d'alerte et les tableaux de bord recommandés. Il fournit un cadre mesurable pour piloter la disponibilité et la performance perçues par les utilisateurs.

Il complète le **document 10 — Dossier d'exploitation (DEX)**, qui décrit la supervision opérationnelle et les procédures d'incident.

Les cibles chiffrées proposées constituent une **base de référence** à ajuster au contexte de déploiement (criticité, volumétrie, engagement de service contractuel éventuel).

---

## 2. Piliers de l'observabilité

FileFlow expose trois sources de signaux exploitables en l'état :

| Pilier | Source | Usage |
|---|---|---|
| **Journaux applicatifs** | Bibliothèque `tracing` (sortie standard du conteneur) | Diagnostic, corrélation d'incidents, traçabilité technique |
| **Sonde de santé** | Endpoint `/api/health` (non authentifié) et sonde conteneur embarquée | Disponibilité, détection d'indisponibilité |
| **Journal d'audit métier** | Fichier `CONFIG_DIR/.fileflow_audit.json` (+ rotation `.1`) | Traçabilité des actions (authentification, partages, administration), sécurité |

Ces signaux sont à agréger dans une chaîne de collecte externe (collecte des journaux conteneur, sonde de disponibilité, métriques du reverse-proxy). L'instrumentation métrique native (OpenTelemetry) constitue une évolution recommandée détaillée en §8.

---

## 3. Indicateurs de niveau de service (SLI)

Les SLI sont exprimés du point de vue de l'utilisateur. En l'absence d'instrumentation métrique interne à ce jour, ils sont mesurés au niveau du **reverse-proxy** et de la **sonde de disponibilité** (approche recommandée par le *SRE Book*).

| # | SLI | Définition | Bonne mesure |
|---|---|---|---|
| SLI-1 | **Disponibilité** | Proportion de sondes `/api/health` renvoyant 200 sur la fenêtre | `succès / total` des sondes |
| SLI-2 | **Taux de succès des requêtes** | Proportion de requêtes API répondues sans erreur serveur (statuts 2xx/3xx/4xx attendus, hors 5xx) | `(total − 5xx) / total` |
| SLI-3 | **Latence des requêtes API** | Temps de réponse des requêtes API interactives (hors transferts de fichiers) | Percentiles p50 / p95 / p99 |
| SLI-4 | **Taux d'erreurs 5xx** | Proportion de réponses en erreur serveur | `5xx / total` |
| SLI-5 | **Succès des téléversements** | Proportion de téléversements finalisés avec succès (init → finalisation) | `finalisés / initiés` |
| SLI-6 | **Latence de téléchargement** | Débit / temps de premier octet des téléchargements de fichiers | p95 du temps de premier octet |

> **Note sur les réponses `429`** : elles traduisent un verrouillage anti-force-brute (connexion, 2FA, mots de passe de liens publics) et non une défaillance du service. Comme les autres 4xx, elles comptent comme des succès pour SLI-2 ; elles sont suivies comme **signal de sécurité** (alertes A7 et A9). Les verrous étant tenus en mémoire, un redémarrage remet ces signaux à zéro.

> **Note méthodologique** : la latence de transfert de fichiers (SLI-6) dépend fortement de la taille des objets et de la bande passante client ; elle est suivie sur le **temps de premier octet** et le débit servi, et non sur la durée totale de transfert, afin de rester représentative de la performance du service.

---

## 4. Objectifs de niveau de service (SLO) et budgets d'erreur

Les objectifs ci-dessous sont proposés pour un déploiement de production standard, sur une **fenêtre glissante de 30 jours**.

| SLO | Cible | Budget d'erreur (30 j) |
|---|---|---|
| Disponibilité (SLI-1) | **99,5 %** | ≈ 3 h 39 min d'indisponibilité |
| Taux de succès des requêtes (SLI-2) | **99,9 %** | 0,1 % des requêtes |
| Latence API p95 (SLI-3) | **< 300 ms** | 5 % des requêtes au-delà du seuil |
| Latence API p99 (SLI-3) | **< 800 ms** | 1 % des requêtes au-delà du seuil |
| Taux d'erreurs 5xx (SLI-4) | **< 0,1 %** | 0,1 % des requêtes |
| Succès des téléversements (SLI-5) | **≥ 99 %** | 1 % des téléversements |

### 4.1 Politique de budget d'erreur

- Le **budget d'erreur** est la marge de défaillance tolérée avant manquement au SLO.
- **Budget consommé à moins de 50 %** : fonctionnement nominal, priorité aux évolutions.
- **Budget consommé entre 50 % et 100 %** : gel des changements non essentiels, priorité à la fiabilisation.
- **Budget épuisé** : mobilisation prioritaire sur la remédiation ; toute mise en production non corrective est suspendue jusqu'au rétablissement.

---

## 5. Matrice SLI → SLO → mesure

| SLI | SLO cible | Fenêtre | Source de mesure |
|---|---|---|---|
| Disponibilité | 99,5 % | 30 j | Sonde externe sur `/api/health` |
| Taux de succès des requêtes | 99,9 % | 30 j | Journaux d'accès du reverse-proxy (statuts HTTP) |
| Latence API p95 | < 300 ms | 30 j | Temps de réponse mesuré au reverse-proxy |
| Latence API p99 | < 800 ms | 30 j | Temps de réponse mesuré au reverse-proxy |
| Taux d'erreurs 5xx | < 0,1 % | 30 j | Journaux d'accès du reverse-proxy |
| Succès des téléversements | ≥ 99 % | 30 j | Journaux applicatifs (`tracing`) + journal d'audit (`upload`) |
| Latence de téléchargement | p95 temps de premier octet à suivre | 30 j | Métriques du reverse-proxy |

---

## 6. Alerting

Les alertes distinguent la **sévérité critique** (atteinte à la disponibilité, action immédiate) de la **sévérité d'avertissement** (dérive, action planifiée). Les seuils sont indicatifs et à calibrer.

| ID | Condition | Sévérité | Action attendue |
|---|---|---|---|
| A1 | Sonde `/api/health` en échec ≥ 3 relevés consécutifs | **Critique** | Déclencher le runbook R1 (document 10) |
| A2 | Taux d'erreurs 5xx > 1 % sur 5 min | **Critique** | Investigation immédiate (journaux, dépendances stockage) |
| A3 | Latence API p95 > 300 ms sur 15 min | Avertissement | Analyse de charge / contention (voir dette D8, document 12) |
| A4 | Consommation du budget d'erreur > 50 % (30 j) | Avertissement | Revue de fiabilité, gel des changements non essentiels |
| A5 | Taux d'échec des téléversements > 5 % sur 15 min | Avertissement | Vérifier espace disque (runbook R4) et `MAX_UPLOAD_MB` |
| A6 | Occupation du volume `data` > 85 % | Avertissement | Runbook R4 (espace disque saturé) |
| A7 | Pic d'échecs d'authentification / verrouillages : événements d'audit `login_failed`, `login_blocked_ip`, `login_blocked_user`, `2fa_blocked` | Avertissement | Runbook R8 (document 10) ; corrélation sécurité (runbook R5) si attaque avérée |
| A9 | Taux de réponses `429` sur `/api/s/*` et `/api/r/*` (mots de passe de liens publics) anormal sur 15 min | Avertissement | Runbook R9 (document 10) : force brute ou verrouillage volontaire d'un lien |
| A8 | Redémarrages répétés du conteneur (> 3 / 10 min) | **Critique** | Runbook R1 puis R3 si erreur de base |

---

## 7. Tableaux de bord recommandés

- **Vue « Disponibilité & santé »** : état de la sonde `/api/health`, disponibilité glissante 30 j, consommation du budget d'erreur, historique des redémarrages conteneur.
- **Vue « Performance API »** : latences p50/p95/p99, débit de requêtes, taux d'erreurs 4xx/5xx (mesures reverse-proxy).
- **Vue « Fichiers »** : succès/échecs des téléversements, latence de téléchargement, occupation des volumes (`data`, sous-dossiers `versions`/`trash`/`uploads`).
- **Vue « Sécurité & audit »** : volume d'événements d'authentification, échecs et verrouillages, créations/suppressions de comptes, activité de partage — issue du journal d'audit ; réponses `429` par route (connexion, 2FA, liens publics) — issues des journaux du reverse-proxy, les échecs de mot de passe des liens publics n'étant pas journalisés dans l'audit.
- **Vue « Ressources »** : CPU, mémoire, I/O disque du conteneur.

---

## 8. Feuille de route d'instrumentation

> **Statut : évolution recommandée, non encore implémentée.** FileFlow ne publie pas à ce jour de métriques applicatives natives ni de traces distribuées. Les SLI ci-dessus sont mesurables via le reverse-proxy et la sonde externe. L'instrumentation native ci-dessous en renforcerait la précision et la granularité.

1. **Métriques** : exposer un endpoint de métriques (compteurs de requêtes par route et par statut, histogrammes de latence, compteurs de téléversements/téléchargements, jauges d'occupation) au format standard **OpenTelemetry**.
2. **Traces** : instrumenter les requêtes entrantes et les opérations d'entrées/sorties majeures (accès base, écritures fichiers) en traces OpenTelemetry, avec propagation d'un identifiant de corrélation.
3. **Corrélation** : rattacher un identifiant de requête commun aux journaux `tracing`, aux traces et aux entrées d'audit pertinentes, afin d'accélérer le diagnostic transverse.
4. **Exporteur** : acheminer métriques et traces vers un collecteur OpenTelemetry, puis vers la plateforme d'observabilité retenue.
5. **Migration des SLO** : une fois l'instrumentation native disponible, recaler les mesures des SLI (§5) sur les métriques applicatives plutôt que sur les journaux du reverse-proxy, plus proches de l'expérience réelle.

---

## 9. Références

- **Google, « Site Reliability Engineering »**, O'Reilly, 2016 — chapitre « Service Level Objectives » (SLI, SLO, budgets d'erreur).
- **OpenTelemetry** — cadre d'instrumentation (métriques, traces, journaux) et exporteurs, https://opentelemetry.io.
- **Document 10** — Dossier d'exploitation (DEX) (corpus documentaire FileFlow).
- **Document 12** — Registre des dettes techniques (corpus documentaire FileFlow).
