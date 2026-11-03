# Journal des décisions d'architecture (ADR)

Ce répertoire regroupe les **Architecture Decision Records** (ADR) de FileFlow :
une fiche par décision d'architecture structurante, conservée dans le dépôt aux
côtés du code afin d'en préserver le contexte et la traçabilité dans le temps.

## Rôle d'un ADR

Un ADR capture une décision d'architecture significative : le contexte et le
problème posé, les options envisagées, la décision retenue et ses conséquences
(positives, négatives, risques résiduels). Il documente le *pourquoi* d'un choix,
information qui n'est pas lisible dans le code et qui se perd autrement au fil des
évolutions d'équipe.

Un ADR est **immuable** une fois accepté : on ne réécrit pas l'histoire. Lorsqu'une
décision est révisée, on rédige un nouvel ADR qui remplace le précédent, et l'on
met à jour le statut de l'ancien (`Remplacé par ADR-NNNN`).

Exception : un **complément ou une révision de portée limitée**, qui précise la
décision sans la renverser, peut être porté dans l'ADR existant. Il est alors
tracé dans une section « Historique des révisions » et signalé dans le statut
(par exemple `Accepté — révisé le AAAA-MM-JJ`), le texte initial restant
résumé dans cet historique. C'est le cas des ADR 0002 et 0006, complétés le
27 octobre 2026 à la suite de l'audit de sécurité (document 14).

## Convention de nommage

```
NNNN-titre-court-en-kebab-case.md
```

- `NNNN` : numéro séquentiel sur quatre chiffres, jamais réattribué.
- Un fichier par décision ; l'ordre reflète la chronologie d'adoption.

## Statuts possibles

| Statut       | Signification                                             |
|--------------|----------------------------------------------------------|
| `Proposé`    | Décision en cours de discussion, non entérinée.          |
| `Accepté`    | Décision entérinée et en vigueur.                        |
| `Déprécié`   | Décision qui n'est plus recommandée, sans remplaçant.    |
| `Remplacé`   | Décision remplacée par un ADR ultérieur (à référencer).  |

## Index des ADR

| N°   | Titre                                                              | Statut  | Date       |
|------|-------------------------------------------------------------------|---------|------------|
| 0001 | Persistance en SQLite « document-store » avec cache write-through | Accepté | 2026-07-21 |
| 0002 | Révocation des jetons JWT par version de jeton (`token_version`)  | Accepté — complété le 2026-10-27 | 2026-07-21 |
| 0003 | Backend cryptographique pur Rust, HS256 uniquement                | Accepté | 2026-07-21 |
| 0004 | Image de production statique (musl) sur base distroless           | Accepté | 2026-07-21 |
| 0005 | PowerPoint en téléchargement seul, sans prévisualisation          | Accepté | 2026-07-21 |
| 0006 | Limitation des tentatives d'authentification (anti-force brute)   | Accepté — révisé le 2026-10-27 | 2026-07-21 |
| 0007 | Uploads résumables par fragments (chunked upload)                 | Accepté | 2026-07-21 |
| 0008 | Contrôle d'accès par chemins canoniques et autorité dérivée      | Accepté | 2026-10-27 |

## Gabarit MADR (fiche vierge)

```markdown
# ADR-NNNN : <titre de la décision>

- **Statut :** Proposé | Accepté | Déprécié | Remplacé par ADR-NNNN
- **Date :** AAAA-MM-JJ
- **Décideurs :** <équipe / rôles>

## Contexte et problème

<Quel problème résout-on ? Quelles forces sont en jeu ?>

## Facteurs de décision

- <critère 1>
- <critère 2>

## Options envisagées

1. **<Option A>** — <description, avantages, inconvénients>
2. **<Option B>** — <description, avantages, inconvénients>

## Décision

<Option retenue et justification.>

## Conséquences

**Positives**
- <…>

**Négatives**
- <…>

**Risques résiduels**
- <…>

## Références

- <liens, standards, ADR liés>
```

## Références

- Michael Nygard, *Documenting Architecture Decisions*, 2011.
- Modèle et bonnes pratiques ADR : <https://adr.github.io/>.
- MADR — *Markdown Architectural Decision Records* : <https://adr.github.io/madr/>.
