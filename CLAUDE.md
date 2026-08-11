# CLAUDE.md

Guide pour Claude Code sur ce dépôt.

## Vue d'ensemble

Cockpit est l'outil de pilotage de Montpellier Dépannage : trois écrans
(temps réel, revue hebdomadaire, revue mensuelle) alimentés par l'export
Excel PowerPanne « Historique dépanneur ». Interface en français, charte
Montpellier Dépannage, ~4 000 interventions par mois.

Application distincte de **DepanTime** (pointage, plannings, DocuSign) mais
déployée à côté sur le même VPS, avec les mêmes tokens visuels. Le Cockpit lit
DepanTime en direct pour les effectifs, les jours travaillés et les heures
payées (voir *Passerelle DepanTime*) ; sans ce lien, ces valeurs se saisissent
à la main.

## Commandes

```bash
npm install && npm run dev              # front, http://localhost:5174
cd api && npm install && npm run dev    # API, port 3100
npm test                                # 60 tests du noyau (node --test)
npm run build                           # dist/
node scripts/verify-import.mjs "<fichier.xlsx>"   # noyau contre un export réel
```

Pas de linter configuré.

## Architecture

### Le noyau est la pièce maîtresse

`src/core/` est pur, sans dépendance, et tourne dans le navigateur comme dans
Node. Trois fichiers, trois responsabilités qui ne se mélangent pas :

- **`schema.js`** — le seul endroit qui connaît les noms de colonnes de la
  source. Correspondance par nom, tolérante aux accents, à la casse et aux
  apostrophes (`normKey`). Chaque champ déclare ses `aliases` et si son
  absence bloque l'import (`required`).
- **`normalize.js`** — lignes brutes → interventions canoniques. Porte les
  règles de nettoyage et le calcul des délais.
- **`metrics.js`** — toutes les définitions de calcul, plus le catalogue
  `INDICATORS` qui sert aux cibles et aux séries.
- **`matching.js`** — appariement des noms PowerPanne ↔ fiches DepanTime.
  Logique reprise de `src/payroll.js` de DepanTime (mêmes scores, même
  distance d'édition). **Si l'une des deux implémentations est corrigée,
  l'autre doit suivre.**

**Les indicateurs ne sont jamais calculés côté serveur.** Le cahier des
charges impose des définitions identiques sur les trois écrans ; les recoder
dans l'API créerait une seconde vérité. L'API stocke et restitue, le
navigateur calcule.

Toute modification d'une définition passe par `metrics.js` et doit être
couverte dans `test/core.test.js`.

### Sources interchangeables

`src/sources/` — contrat unique :

```js
{ id, label, needs, load(input, opts) => Promise<{ headers, rows, sheets, meta }> }
```

Une source produit des lignes brutes `{ [nomDeColonne]: valeur }`. Elle ne
nettoie rien, ne calcule rien. `xlsxSource` lit le classeur multi-onglets
(SheetJS, chargé dynamiquement) ; `apiSource` est le futur branchement
PowerPanne, en attente d'ouverture.

`xlsxSource` promeut le nom d'onglet en colonne `Dépanneur (onglet)` : il est
plus complet que la colonne `Dépanneur` (« Dylan Roux » contre « Dylan R »).
Le schéma le préfère ; une source sans onglets retombe sur `Dépanneur`.

### Store à deux implémentations

`src/store.js` détecte au démarrage si `/api/health` répond :

- **remote** — API Cockpit + PostgreSQL, mode normal ;
- **local** — IndexedDB + localStorage, l'application tourne sans serveur.

Les écrans ne savent pas lequel est actif. Les dates sont réhydratées au
chargement (`reviveIntervention`) — le JSON les rend en chaînes.

### Front

React 18 + Vite, sans routeur ni bibliothèque d'état : la navigation est un
`useState` dans `App.jsx`, les données sont chargées une fois et partagées.
Graphiques en SVG maison (`components/charts.jsx`), pas de Recharts ni de D3.

## Pièges de l'export PowerPanne

Vérifiés sur l'export réel de juillet 2026 (49 onglets, 4 186 lignes) :

- **Aucune clé naturelle.** `Numéro de dossier` n'est pas unique (725
  doublons : un dossier porte plusieurs missions `…OM1`, `…OM2` confiées à
  des dépanneurs différents). `Numéro de mission` non plus : il accueille de
  la saisie libre — `1` revient 381 fois, à côté de `NE PAS FACTURER`,
  `Fourrière`, `PAYANT 160€`. L'identité passe par `missionKey()` :
  dossier + mission + dépanneur + horodatages + montant. **Ne pas revenir à
  une clé simple** : la première version perdait 534 lignes et 51 k€ de CA.
- **`Date de facturation` peut contenir plusieurs dates** séparées par des
  espaces (92 cas), sans heure. `parseDateMulti` retient la plus ancienne et
  compte les occurrences.
- **`% de majoration` est une chaîne composite** (`"25, 0 et 25"`).
  Utiliser `Montant majoré HT`, pas ce champ.
- **`Nombre de photos prises` est du texte**, pas un nombre.
- **`Coût de revient` est vide à 100 %** — d'où les paramètres de coût saisis
  dans l'application.
- **Délais aberrants massifs** : ~11 % des lignes ont un délai négatif ou
  supérieur à 24 h. Ils sont conservés bruts, marqués invalides, et le nombre
  d'exclusions remonte jusqu'à l'écran.
- **La période déborde du titre du fichier** : l'export « juillet » couvre du
  23 juin au 3 août.

## Passerelle DepanTime

`api/depantime.js` lit les relevés de temps de l'applicatif de pointage pour
fournir ce que PowerPanne ne contient pas : effectif du jour, jours travaillés,
heures payées. **Lecture seule** — le Cockpit n'écrit jamais dans DepanTime.

- L'appel se fait de conteneur à conteneur (`http://depantime-api:3000`) : les
  identifiants du compte de service restent dans l'API Cockpit.
- Une seule route sert les trois usages :
  `GET /api/depantime/effectifs?siteId&from&to`. La plage vaut un jour
  (temps réel), une semaine ISO (revue hebdo) ou un mois (revue mensuelle).
- DepanTime **indexe ses mois de 0 à 11**, comme JavaScript. La passerelle
  convertit ; ne pas l'oublier en ajoutant une route.
- **Un jour de congés est payé mais non travaillé.** DepanTime y pré-remplit
  7 h (08:00–17:00 avec pause) pour la paie. Les compter comme jours
  travaillés abaisserait mécaniquement le CA par jour-dépanneur.
- **Règle anti-collision** : si deux noms PowerPanne désignent la même fiche,
  les deux passent en choix manuel. Un alias posé par l'utilisateur occupe la
  fiche et fait céder le rapprochement deviné. Sans cette règle, les jours
  d'une personne seraient attribués à deux dépanneurs, silencieusement.

Sans configuration, l'application fonctionne : les trois valeurs restent en
saisie manuelle et l'écran Réglages explique quoi renseigner.

## Charte

Reprise du design system Montpellier Dépannage (`DEPANTIME/design-system-extract`).
Trois règles non négociables :

1. `forest-600` (#2C6126) est la couleur primaire ;
2. `signal-300` (#E4E13C) est un **fond uniquement**, jamais un texte ni un
   trait — la seule surface admise est le bandeau d'alerte `.callout-urgent` ;
3. `stone-900` (#1A190F) est le noir, jamais `#000`.

Typographie : Space Mono (titres), DM Sans (corps), JetBrains Mono (chiffres,
avec `tnum` — mais chiffres proportionnels sur les grandes valeurs isolées).
Pas de dégradé, pas de motif, pas de mode sombre.

Palette des graphiques : `#2C6126 · #185FA5 · #A09D1E · #A32D2D`, validée pour
la vision des couleurs. Séquentiel : rampe forest. Divergent (heatmap SLA) :
danger ↔ forest autour de la cible. Chaque graphique a une vue tableau.

## Vocabulaire

Français opérationnel, ton factuel, pas de marketing. `dépanneur`, `DPR`
(déplacement pour rien), `CRO` (compte rendu d'opération), `SLA`,
`origine d'appel` (la convention), `facturation groupée`. Em-dash `—` pour
les valeurs vides, jamais « N/A ». Emoji réservé aux marqueurs de catégorie
de la navigation, jamais dans le corps du texte ni sur les boutons.

## Déploiement

Tout en Docker dans **`/srv/pilotage`** sur le VPS, derrière le Traefik
existant (`certresolver=le` en DNS-01 Cloudflare, middlewares `ratelimit@docker`
et `sec-headers@docker`, comme DepanTime). Un seul domaine :
`pilotage.alex-worksmart.com`. Pas-à-pas complet : `DEPLOIEMENT.md`.

À garder en tête :

- le préfixe est **`pilotage`**, pas `cockpit` : le serveur héberge déjà une
  application *cockpit patrimonial* dans `/srv/cockpit`, sur
  `cockpit.alex-worksmart.com`, avec un routeur Traefik nommé `cockpit`.
  Dossier, conteneurs et routeur ont donc été renommés pour ne rien écraser ;
- `nginx.conf` sert le front **et** proxifie `/api/` vers `pilotage-api` :
  une seule origine, donc pas de CORS et `VITE_API_URL` inutile (`API_BASE`
  vaut alors la chaîne vide et le front appelle `/api` sur son propre
  domaine) ;
- l'API n'est ni sur le réseau `web` ni exposée à Traefik — elle n'est
  joignable que depuis `pilotage-net` ;
- **un seul niveau de sous-domaine** : l'Universal SSL de Cloudflare couvre
  `*.alex-worksmart.com` et pas au-delà. Un `x.y.alex-worksmart.com` proxifié
  échoue au handshake TLS ;
- la variante front-sur-Cloudflare-Pages reste documentée en fin de
  `DEPLOIEMENT.md` — elle rouvre le CORS et un second certificat.

Secrets dans `/srv/cockpit/.env` (voir `.env.example`). Purge de l'historique
au-delà de 14 mois.
