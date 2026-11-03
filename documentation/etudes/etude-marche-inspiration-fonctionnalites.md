# Étude de marché — Produits comparables et fonctionnalités inspirantes pour FileFlow

| | |
|---|---|
| **Titre** | Étude de marché — Sources d'inspiration et pistes de fonctionnalités pour FileFlow |
| **Version** | 1.0 |
| **Date** | 22 juillet 2026 |
| **Statut** | Étude — aide à la feuille de route |
| **Propriétaire** | Driss OUAAZIZ — Software Architect |
| **Classification** | Interne |

> Nature du document : étude comparative d'aide à la décision. Aucune modification de code n'a été réalisée. Les pistes présentées ne constituent pas un engagement de réalisation.

---

## Table des matières

1. Objet et méthode
2. Périmètre fonctionnel actuel de FileFlow (référentiel de comparaison)
3. Panorama des produits du marché
4. Fonctionnalités candidates, par thème
5. Ce qu'il convient d'écarter (cohérence de positionnement)
6. Recommandations priorisées
7. Prochaines étapes
8. Sources

---

## 1. Objet et méthode

Cette étude examine des **produits comparables du marché** (open source et commerciaux)
afin d'identifier des **fonctionnalités intéressantes** dont FileFlow pourrait s'inspirer.
Chaque piste est confrontée au **positionnement du produit** — auto-hébergement, mono-binaire,
simplicité, sécurité, souveraineté — de
façon à ne retenir que ce qui renforce FileFlow sans en trahir l'identité.

La méthode : cartographier le périmètre actuel (§2), relever les fonctionnalités marquantes
des produits comparables (§3), puis en déduire un ensemble de pistes qualifiées et priorisées
(§4 à §6).

## 2. Périmètre fonctionnel actuel de FileFlow (référentiel de comparaison)

Déjà couvert : gestion de fichiers (CRUD, corbeille avec rétention, versions), recherche
(nom, plein-texte, étiquettes), prévisualisation (images, PDF, texte/code, Markdown, CSV,
tableurs, documents Word ; PowerPoint en téléchargement), partage (liens publics avec
expiration/mot de passe/limite de téléchargements, partages internes, dossiers collaboratifs,
demandes d'upload), authentification (JWT, 2FA TOTP + codes de secours), contrôle d'accès
(rôles, permissions, groupes à chemins autorisés), administration (comptes, quotas, journal
d'audit exportable, révocation de sessions), uploads (multipart et chunké résumable), favoris.

**Absences notables** (par rapport au marché) : édition documentaire en ligne, accès WebDAV,
authentification déléguée (SSO/LDAP), clients de synchronisation, notifications, commentaires,
antivirus à l'upload, chiffrement côté client, vignettes/galerie, jetons d'API.

## 3. Panorama des produits du marché

| Produit | Positionnement | Fonctionnalités marquantes | Intérêt comme source d'inspiration |
|---|---|---|---|
| **Nextcloud** | Plateforme collaborative complète (PHP), leader de l'auto-hébergement | Partage granulaire (lecture seule, expiration, mot de passe, dépôt de fichiers), stockage externe (S3, FTP, SFTP, SMB, Drive), édition en ligne (Collabora/OnlyOffice), chiffrement de bout en bout, automatisation « Flow », antivirus, WebDAV, clients bureau/mobile | Référence de complétude ; réservoir d'idées de partage, collaboration et intégrations |
| **ownCloud Infinite Scale (oCIS)** | Réécriture Go, cloud-native, orientée entreprise | Modèle de pilotes de stockage (POSIX, S3, WebDAV), « Spaces » (espaces d'équipe), scalabilité horizontale | Abstraction de stockage et espaces d'équipe |
| **Seafile** | Sync/partage haute performance (blocs) | Déduplication au niveau bloc (1 Mio, adressage par contenu), **sync delta** (transfert des seuls blocs modifiés), **bibliothèques chiffrées** côté client, versions | Efficacité de synchronisation ; coffres chiffrés |
| **Pydio Cells** | Sync/partage entreprise (Go, microservices) | Backend S3 recommandé, cellules/espaces, partage, édition et **commentaires** de documents | Collaboration (commentaires) et backend objet |
| **Filebrowser** | Gestionnaire web mono-binaire minimal (Go) | UI web devant un dossier, gestion d'utilisateurs, partages, commandes | Analogue direct de FileFlow ; sobriété |
| **Filestash** | Front web multi-backends | Connexion à S3, SFTP, FTP(S), MinIO, WebDAV, Git, LDAP… ; prévisualisation, édition | Découplage backend ; richesse de prévisualisation |
| **Collabora Online / ONLYOFFICE Docs** | Suites bureautiques en ligne auto-hébergeables | Édition collaborative temps réel via le **protocole WOPI**, compatibilité Microsoft, documents restant sur le serveur | Brique d'édition documentaire à intégrer (service externe optionnel) |
| **Proton Drive / Cryptomator** | Stockage chiffré, orienté vie privée | Chiffrement de bout en bout / coffres chiffrés côté client | Modèle de confidentialité renforcée |
| **Dropbox / Box (commerciaux)** | Références d'expérience utilisateur | Demandes de fichiers, commentaires, notifications, permissions fines, intégrations, liens analytiques | Étalon d'ergonomie et de fonctions de partage |

## 4. Fonctionnalités candidates, par thème

Chaque piste est qualifiée par : source d'inspiration, intérêt pour FileFlow, **alignement**
avec le positionnement (mono-binaire / sécurité / simplicité), et **effort** indicatif (S/M/L).

### 4.1 Accès et interopérabilité

- **Accès WebDAV** *(Nextcloud, Filestash, oCIS)* — montage de l'espace comme lecteur réseau
  (Explorateur, Finder, `davfs`). Fort intérêt d'usage, s'intègre au binaire, **aligné**. Effort **M**.
- **Jetons d'API / mots de passe d'application** *(Nextcloud)* — accès programmatique et
  compatibilité `rclone` sans exposer le mot de passe principal. **Aligné**, effort **S**.
- **Backends de stockage externes / objet** *(oCIS, Pydio, Filestash)* — voir l'étude dédiée
  `etude-stockage-objet-minio-s3.md`. **Aligné sous conditions**, effort **L**.

### 4.2 Édition et collaboration documentaire

- **Édition en ligne via WOPI** *(Collabora / ONLYOFFICE)* — édition collaborative des documents
  bureautiques, les fichiers restant sur le serveur. Très forte valeur, mais **service externe
  optionnel** (tension avec « sans dépendance lourde » — à cantonner en intégration activable).
  Effort **L**.
- **Commentaires et annotations** *(Pydio, Dropbox)* — fils de discussion attachés aux fichiers.
  **Aligné**, effort **M**.
- **Flux d'activité** *(Nextcloud)* — historique des actions par fichier/dossier (s'appuie sur le
  journal d'audit déjà présent). **Aligné**, effort **M**.

### 4.3 Partage avancé

- **Liens en lecture seule / dépôt (drop) / désactivation du téléchargement** *(Nextcloud, Dropbox)*
  — enrichit le partage public déjà présent. **Aligné**, effort **S/M**.
- **Notifications** (courriel puis, à terme, push) sur partages et échéances *(Nextcloud, Box)*.
  **Aligné**, effort **M**.
- **Permissions de partage plus fines** (voir / modifier / repartager) *(Nextcloud)*. **Aligné**, effort **M**.

### 4.4 Authentification et entreprise

- **SSO OIDC / OAuth2 et LDAP/AD** *(Nextcloud, oCIS ; fournisseurs Authentik, Pocket ID…)* —
  délégation de l'authentification à un fournisseur d'identité. Débloque l'usage en entreprise.
  **Aligné** (le fournisseur reste externe et choisi par l'organisation), effort **M/L**.
- **Passkeys / WebAuthn (FIDO2)** *(Hanko, Authgear)* — second facteur résistant au hameçonnage,
  en complément du TOTP existant. **Aligné**, effort **M**.

### 4.5 Sécurité du contenu et des données

- **Analyse antivirus à l'upload (ClamAV)** *(Nextcloud)* — service externe optionnel, activable.
  **Aligné** (renforce la sécurité, cœur de la proposition de valeur), effort **M**.
- **Coffres / bibliothèques chiffrés côté client** *(Seafile, Cryptomator, Proton Drive)* —
  confidentialité renforcée, l'administrateur n'accède pas au contenu. Sensible et structurant.
  **Aligné avec réserve**, effort **L**.
- **Politiques de rétention et conservation légale** *(entreprise)* — durées et blocage de
  suppression sur corbeille/versions. **Aligné** (complète la conformité RGPD), effort **M**.
- **Verrouillage de fichiers** *(oCIS, solutions entreprise)* — évite les écrasements concurrents.
  **Aligné**, effort **M**.

### 4.6 Synchronisation

- **Synchronisation delta / au niveau bloc** *(Seafile)* — transfert des seuls blocs modifiés.
  Forte valeur sur gros fichiers, mais **effort élevé** et clients dédiés. Effort **L**.
- **Clients bureau / mobile** *(Nextcloud, Seafile)* — au-delà du périmètre binaire unique ;
  **désaligné** à court terme (nouveaux artefacts à maintenir).

### 4.7 Média et ergonomie

- **Vignettes et vue galerie** *(Nextcloud, Immich)* — génération de miniatures côté serveur,
  grille d'images. **Aligné**, effort **M**.
- **Affichage des métadonnées EXIF** *(gestionnaires photo)* — lecture des métadonnées d'image
  (date, appareil, dimensions), **sans** reconnaissance de contenu. **Aligné**, effort **S/M**.
- **Application web progressive (PWA) / mode hors-ligne léger** *(commerciaux)*. **Aligné**, effort **M**.

### 4.8 Automatisation et exploitation

- **Règles d'automatisation / webhooks** *(Nextcloud Flow)* — déclencher une action sur un
  événement (upload, partage). **Aligné**, effort **M/L**.
- **Quotas par groupe** *(entreprise)* — complète les quotas par utilisateur existants.
  **Aligné**, effort **S/M**.

## 5. Ce qu'il convient d'écarter (cohérence de positionnement)

- **Analyse automatique du contenu des fichiers** — reconnaissance d'images, extraction
  « intelligente » de texte, étiquetage automatique, recommandations. Hors du périmètre
  revendiqué : elles introduiraient des dépendances lourdes et un profil de risque étrangers à
  l'identité du produit.
- **Empilement de services obligatoires** — tout ce qui romprait le mono-binaire doit rester une
  **intégration externe activable** (Collabora/ONLYOFFICE, ClamAV, fournisseur OIDC), jamais une
  dépendance imposée par défaut.
- **Clients de synchronisation propriétaires à court terme** — coût de maintenance élevé
  (multi-plateformes) sans rapport avec la valeur immédiate.

## 6. Recommandations priorisées

Priorité fondée sur le triptyque **valeur × alignement × effort**.

| Priorité | Piste | Valeur | Effort | Alignement |
|---|---|---|---|---|
| **P1 — Gains rapides** | Jetons d'API / mots de passe d'application | Élevée | S | Fort |
| **P1** | Liens de partage en lecture seule / dépôt / sans téléchargement | Élevée | S/M | Fort |
| **P1** | Passkeys / WebAuthn (2e facteur) | Élevée | M | Fort |
| **P2 — Structurantes** | Accès WebDAV | Élevée | M | Fort |
| **P2** | SSO OIDC + LDAP/AD | Élevée (entreprise) | M/L | Fort |
| **P2** | Antivirus à l'upload (ClamAV, optionnel) | Élevée (sécurité) | M | Fort |
| **P2** | Notifications (courriel) + flux d'activité | Moyenne/Élevée | M | Fort |
| **P2** | Vignettes / vue galerie + EXIF | Moyenne | M | Fort |
| **P2** | Politiques de rétention / verrouillage de fichiers | Moyenne | M | Fort |
| **P3 — Stratégiques** | Édition documentaire WOPI (Collabora/ONLYOFFICE) | Très élevée | L | Moyen (service externe) |
| **P3** | Backends de stockage objet (voir étude dédiée) | Moyenne/Élevée | L | Moyen |
| **P3** | Coffres chiffrés côté client | Élevée | L | Moyen |
| **P3** | Synchronisation delta / bloc + clients | Élevée | L+ | Faible (court terme) |

**Lecture rapide.** Les **gains rapides (P1)** renforcent immédiatement l'utilité et la sécurité
à faible coût, sans toucher à l'identité du produit. Les pistes **P2** professionnalisent l'usage
(interopérabilité, entreprise, sécurité du contenu). Les pistes **P3** sont à fort impact mais
engagent l'architecture ou des services externes : à traiter par décisions dédiées.

## 7. Prochaines étapes

- Sélectionner les pistes retenues et, pour chaque piste structurante ou stratégique, ouvrir une
  **décision d'architecture (ADR)** dans `05-adr/`.
- Alimenter la feuille de route et, le cas échéant, le registre de dette / d'évolutions.
- Traiter le stockage objet via son étude dédiée (`etude-stockage-objet-minio-s3.md`).

## 8. Sources

- Nextcloud — *Files*, *Sharing*, *Features* : <https://nextcloud.com/files/>, <https://nextcloud.com/sharing/>, <https://nextcloud.com/features/>
- Comparatif Nextcloud / ownCloud / Seafile — MassiveGRID : <https://massivegrid.com/blog/nextcloud-vs-owncloud-vs-seafile-enterprise-comparison/>
- Seafile — dépôt officiel et sync delta : <https://github.com/haiwen/seafile>, <https://gofoss.net/cloud-storage/>
- ownCloud Infinite Scale — oCIS : <https://owncloud.dev/ocis/>, stockage S3 : <https://doc.owncloud.com/ocis/next/deployment/storage/s3.html>
- Comparatifs gestionnaires auto-hébergés : <https://computingforgeeks.com/cloudreve-vs-nextcloud-seafile-filebrowser-immich/>, <https://talos.tools/blog/best-self-hosted-cloud-storage-2026>
- Édition documentaire WOPI — Collabora : <https://www.collaboraonline.com/blog/wopi-is-open-your-office-stack-should-be-too/> ; ONLYOFFICE : <https://api.onlyoffice.com/docs/docs-api/using-wopi/overview/>
- Authentification auto-hébergée (OIDC/LDAP/passkeys) : <https://www.cerbos.dev/blog/best-open-source-auth-tools-and-software-for-enterprises-2026>, <https://www.authgear.com/post/top-open-source-mfa-solutions-for-enterprise-applications-2026/>
