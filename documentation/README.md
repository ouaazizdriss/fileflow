# Documentation FileFlow

| | |
|---|---|
| **Objet** | Dossier documentaire d'ingénierie de la plateforme FileFlow |
| **Version** | 1.1 |
| **Date** | 27 octobre 2026 |
| **Statut** | Validé |
| **Propriétaire** | Driss OUAAZIZ — Software Architect |
| **Classification** | Interne |

---

Ce dossier regroupe la documentation d'ingénierie, de sécurité, de conformité et
d'exploitation de **FileFlow**, plateforme de gestion de fichiers auto-hébergée
(backend Rust, frontend React). Les documents sont organisés selon le cycle de vie
du produit et référencent les cadres et normes de l'état de l'art.

## 1. Organisation du dossier

| # | Document | Fichier | Références normatives |
|---|----------|---------|-----------------------|
| **Cadrage et avant-projet** | | | |
| 01 | Note de cadrage / Vision | [`01-note-de-cadrage.md`](./01-note-de-cadrage.md) | PMBOK (PMI) ; PRINCE2 |
| 02 | Étude de faisabilité technique | [`02-etude-faisabilite-technique.md`](./02-etude-faisabilite-technique.md) | ISO/IEC/IEEE 29148 |
| **Conception** | | | |
| 03 | Dossier d'Architecture Technique (DAT) | [`03-dossier-architecture-technique.md`](./03-dossier-architecture-technique.md) | ISO/IEC/IEEE 42010 ; arc42 ; TOGAF |
| 04 | Diagrammes d'architecture (C4) | [`04-diagrammes-architecture-c4.md`](./04-diagrammes-architecture-c4.md) | C4 Model ; ArchiMate ; UML |
| 05 | Décisions d'architecture (ADR) | [`05-adr/`](./05-adr/) | Nygard (2011) ; MADR |
| 06 | Dossier de sécurité et modélisation des menaces | [`06-dossier-securite-threat-model.md`](./06-dossier-securite-threat-model.md) | EBIOS RM (ANSSI) ; ISO/IEC 27005 ; STRIDE ; OWASP |
| 07 | Conformité RGPD | [`07-conformite-rgpd.md`](./07-conformite-rgpd.md) | RGPD (UE 2016/679) ; CNIL |
| **Réalisation et livraison** | | | |
| 08 | Documentation de l'API | [`08-api/`](./08-api/) | OpenAPI 3.1 ; JSON Schema |
| 09 | Normes et guidelines de développement | [`09-guidelines-developpement.md`](./09-guidelines-developpement.md) | Clean Code ; OWASP Secure Coding |
| 10 | Dossier d'exploitation (DEX) + runbooks | [`10-dossier-exploitation-dex.md`](./10-dossier-exploitation-dex.md) | ITIL 4 ; Google SRE |
| **Vie du produit** | | | |
| 11 | Observabilité (SLI / SLO) | [`11-observabilite-sli-slo.md`](./11-observabilite-sli-slo.md) | Google SRE ; OpenTelemetry |
| 12 | Registre des dettes techniques | [`12-registre-dette-technique.md`](./12-registre-dette-technique.md) | Cunningham (1992) ; Fowler |
| 13 | Plan de tests de sécurité dynamique (DAST / OWASP ZAP) | [`13-plan-tests-securite-dast-zap.md`](./13-plan-tests-securite-dast-zap.md) | OWASP WSTG ; OWASP ZAP ; OWASP Top 10 |
| 14 | Rapport d'audit de sécurité (octobre 2026) | [`14-rapport-audit-securite-2026-10.md`](./14-rapport-audit-securite-2026-10.md) | OWASP Top 10 ; OWASP ASVS ; CVSS |
| 15 | Plan directeur des scans et rapports de sécurité | [`15-plan-scans-rapports-securite.md`](./15-plan-scans-rapports-securite.md) | OWASP ASVS 5.0 ; NIST SSDF ; SLSA ; CVSS v4.0 |

## 2. Parcours de lecture conseillé

- **Découverte du produit** : 01 → 03 → 04.
- **Revue de sécurité et conformité** : 06 → 07 → 05 (ADR de sécurité) → 13 (tests DAST) → 14 (rapport d'audit et suivi de la remédiation) → 15 (plan de scans et rapports).
- **Intégration technique / consommation de l'API** : 08 → 09.
- **Mise en production et exploitation** : 10 → 11 → 12.

## 3. Tenue à jour

Chaque document porte un bloc d'en-tête normalisé (titre, version, date, statut,
propriétaire). Toute évolution structurante du produit donne lieu à la révision du DAT
(03), à l'ajout d'une décision d'architecture (05) et, le cas échéant, à la mise à jour
du dossier de sécurité (06) et du registre de dette (12). Les constats de sécurité
sont suivis jusqu'à leur clôture dans le rapport d'audit (14) et le plan des scans (15).
