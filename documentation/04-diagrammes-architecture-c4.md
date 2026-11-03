# Diagrammes d'architecture (modèle C4) — FileFlow

| | |
|---|---|
| **Document** | Diagrammes d'architecture — modèle C4 |
| **Produit** | FileFlow — Plateforme de gestion de fichiers auto-hébergée |
| **Version** | 1.1 |
| **Date** | 27 octobre 2026 |
| **Statut** | Validé |
| **Propriétaire** | Driss OUAAZIZ — Software Architect |
| **Classification** | Interne |

---

## Table des matières

1. [Introduction](#1-introduction)
2. [Niveau 1 — Diagramme de contexte](#2-niveau-1--diagramme-de-contexte)
3. [Niveau 2 — Diagramme de conteneurs](#3-niveau-2--diagramme-de-conteneurs)
4. [Niveau 3 — Diagramme de composants de l'API](#4-niveau-3--diagramme-de-composants-de-lapi)
5. [Vue dynamique — Séquence d'authentification](#5-vue-dynamique--séquence-dauthentification)
6. [Références](#6-références)

---

## 1. Introduction

Ce document présente l'architecture de FileFlow selon le **modèle C4** de Simon Brown, qui décrit un système à quatre niveaux de zoom successifs : le **Contexte**, les **Conteneurs**, les **Composants** et le **Code**. Les trois premiers niveaux sont documentés ici, complétés d'une **vue dynamique** décrivant un scénario clé.

Les diagrammes sont exprimés en notation Mermaid afin d'être rendus directement dans les outils de revue. Une vue dynamique de séquence complète l'ensemble, conformément aux usages UML.

---

## 2. Niveau 1 — Diagramme de contexte

Le diagramme de contexte situe FileFlow dans son environnement : les catégories d'utilisateurs qui interagissent avec le système et les éléments d'infrastructure qui l'entourent. Trois profils d'acteurs sont distingués — l'**administrateur**, l'**utilisateur authentifié** et le **destinataire d'un lien public** (non authentifié). L'accès transite systématiquement par un **reverse-proxy** assurant la terminaison TLS.

```mermaid
graph TB
    admin["Administrateur<br/>(gestion utilisateurs,<br/>groupes, audit)"]
    user["Utilisateur authentifié<br/>(fichiers, partages,<br/>favoris)"]
    guest["Destinataire de lien public<br/>(téléchargement / dépôt,<br/>non authentifié)"]

    proxy["Reverse-proxy<br/>Terminaison TLS<br/><i>Infrastructure</i>"]
    ff["FileFlow<br/>Plateforme de gestion<br/>de fichiers auto-hébergée<br/><i>Système</i>"]

    admin -->|"HTTPS"| proxy
    user -->|"HTTPS"| proxy
    guest -->|"HTTPS"| proxy
    proxy -->|"HTTP (réseau interne)"| ff

    classDef person fill:#6F259F,stroke:#4d1a70,color:#ffffff;
    classDef system fill:#FF2D95,stroke:#c71f73,color:#ffffff;
    classDef infra fill:#5FB3C1,stroke:#3f8794,color:#ffffff;
    class admin,user,guest person;
    class ff system;
    class proxy infra;
```

---

## 3. Niveau 2 — Diagramme de conteneurs

Le diagramme de conteneurs ouvre la boîte « FileFlow ». Le produit se distribue en un **mono-binaire** qui expose à la fois l'API REST et sert le SPA. Sur le plan logique, on distingue toutefois plusieurs conteneurs : l'**application monopage** exécutée dans le navigateur, l'**API** au sein du binaire, la **base SQLite** embarquée et le **volume de fichiers** persistant.

```mermaid
graph TB
    subgraph browser["Navigateur"]
        spa["Application monopage (SPA)<br/>React 18 · TypeScript · Vite · Zustand<br/><i>Conteneur</i>"]
    end

    proxy["Reverse-proxy<br/>Terminaison TLS"]

    subgraph binary["Mono-binaire FileFlow (Rust, statique musl)"]
        api["API REST<br/>Rust · axum · Tokio<br/><i>Conteneur</i>"]
        static["Service de fichiers statiques<br/>(SPA + repli confiné à dist/)"]
    end

    db[("Base de configuration<br/>SQLite (WAL)<br/><i>Conteneur de données</i>")]
    files[("Volume de fichiers<br/>ROOT_DIR + .fileflow/<br/><i>Conteneur de données</i>")]

    spa -->|"HTTPS"| proxy
    proxy -->|"/api/* et statiques"| api
    proxy --> static
    api -->|"lecture/écriture ligne à ligne"| db
    api -->|"opérations fichiers"| files
    static -->|"lit"| files

    classDef container fill:#6F259F,stroke:#4d1a70,color:#ffffff;
    classDef data fill:#FF5A00,stroke:#c74600,color:#ffffff;
    classDef infra fill:#5FB3C1,stroke:#3f8794,color:#ffffff;
    class spa,api,static container;
    class db,files data;
    class proxy infra;
```

---

## 4. Niveau 3 — Diagramme de composants de l'API

Le diagramme de composants détaille l'organisation interne de l'API. Les requêtes traversent d'abord les **intergiciels transversaux** (authentification, en-têtes de sécurité), puis sont acheminées vers le regroupement fonctionnel concerné. Les liens publics et les demandes de dépôt, servis sans authentification, sont protégés par le verrou des mots de passe de liens (clés par lien et par adresse IP). Tous les regroupements s'appuient sur la **couche de persistance** (magasin documentaire SQLite et système de fichiers) et alimentent le **journal d'audit**.

```mermaid
graph TB
    router["Routeur HTTP (axum)"]

    subgraph mw["Intergiciels transversaux"]
        auth["Authentification & 2FA<br/>require_auth · require_admin<br/>JWT · TOTP · jetons d'attente"]
        headers["En-têtes de sécurité<br/>CSP · nosniff · HSTS"]
        rl["Rate-limiting<br/>verrous anti-force brute (mémoire)<br/>IP · utilisateur+IP · compte<br/>2FA · liens publics"]
    end

    subgraph domain["Regroupements fonctionnels"]
        users["Gestion utilisateurs / RBAC<br/>UserStore · groupes · quotas"]
        filesops["Opérations fichiers<br/>resolve · download · preview<br/>rename · move · corbeille · tags"]
        uploads["Uploads<br/>multipart + fragmenté reprenable"]
        pubshare["Partage public<br/>liens · mot de passe · expiration"]
        intshare["Partage interne & collaboration<br/>internal_shares · dossiers partagés"]
        fav["Favoris"]
        reqs["Liens de dépôt anonymes"]
        audit["Audit<br/>journal JSONL + rotation"]
    end

    subgraph persistence["Persistance"]
        store["Magasin documentaire<br/>SQLite (cache write-through)"]
        fs[("Système de fichiers<br/>ROOT_DIR · .fileflow/")]
    end

    router --> auth --> headers
    headers --> users
    headers --> filesops
    headers --> uploads
    headers --> intshare
    headers --> fav
    router --> rl --> pubshare
    rl --> reqs

    users --> store
    filesops --> fs
    filesops --> store
    uploads --> fs
    pubshare --> store
    pubshare --> fs
    intshare --> store
    fav --> store
    reqs --> store
    reqs --> fs

    users --> audit
    filesops --> audit
    uploads --> audit
    pubshare --> audit
    intshare --> audit
    reqs --> audit
    audit --> fs

    classDef mw fill:#5FB3C1,stroke:#3f8794,color:#ffffff;
    classDef comp fill:#6F259F,stroke:#4d1a70,color:#ffffff;
    classDef data fill:#FF5A00,stroke:#c74600,color:#ffffff;
    class auth,headers,rl mw;
    class users,filesops,uploads,pubshare,intshare,fav,reqs,audit comp;
    class store,fs data;
```

---

## 5. Vue dynamique — Séquence d'authentification

La vue dynamique décrit le scénario d'authentification, incluant le second facteur TOTP. L'authentification par mot de passe, lorsque le double facteur est activé, ne délivre pas directement une session mais un **jeton d'attente** de courte durée, échangé contre une session complète après vérification du code TOTP.

```mermaid
sequenceDiagram
    autonumber
    participant U as Utilisateur (SPA)
    participant A as API FileFlow
    participant S as UserStore
    participant R as Rate-limiter
    participant J as Journal d'audit

    U->>A: POST /api/auth/login (identifiant, mot de passe)
    A->>R: verrou actif (IP, couple utilisateur+IP, compte) ?
    alt Verrou actif
        R-->>A: bloqué
        A->>J: journalisation « login_blocked_ip » ou « login_blocked_user »
        A-->>U: 429 Trop de tentatives
    else Autorisé
        A->>S: vérification du mot de passe (bcrypt)
        alt Identifiants invalides
            S-->>A: échec
            A->>R: enregistrement de l'échec (IP, couple, compte)
            A->>J: journalisation « login_failed »
            A-->>U: 401 Non autorisé
        else Identifiants valides et 2FA activé
            A->>A: émission d'un jeton d'attente (courte durée)
            A->>J: journalisation « login_2fa_required »
            A-->>U: 200 { requires_2fa: true } + cookie d'attente
            U->>A: POST /api/auth/2fa/verify (code TOTP)
            A->>R: verrou 2FA actif ?
            A->>S: vérification du code TOTP
            alt Code invalide
                A->>R: enregistrement de l'échec 2FA
                A-->>U: 400 Code invalide
            else Code valide
                A->>R: réinitialisation du compteur 2FA
                A->>A: émission du JWT de session (avec token_version)
                A->>J: journalisation « 2fa_verify_success »
                A-->>U: 200 + cookie de session (HttpOnly, SameSite=Strict)
            end
        else Identifiants valides sans 2FA
            A->>R: réinitialisation des compteurs IP et couple (compteur de compte conservé)
            A->>A: émission du JWT de session (avec token_version)
            A->>J: journalisation « login »
            A-->>U: 200 + cookie de session (HttpOnly, SameSite=Strict)
        end
    end
```

---

## 6. Références

- **C4 Model** — Simon Brown (c4model.com).
- **ArchiMate** — Langage de modélisation d'architecture d'entreprise (The Open Group).
- **UML** — *Unified Modeling Language* (Object Management Group).
- **RFC 6238** — *TOTP: Time-Based One-Time Password Algorithm.*
