# Cockpit — Montpellier Dépannage

Application de pilotage du dépannage : une journée en temps réel, une revue
hebdomadaire, une revue mensuelle. Alimentée par l'export Excel PowerPanne
« Historique dépanneur », et prête à basculer sur l'API PowerPanne le jour où
elle existera.

Charte, logos et vocabulaire repris du design system **Montpellier Dépannage**
(vert forêt `#2C6126`, jaune signalisation `#E4E13C` en fond uniquement,
neutres stone, DM Sans / Space Mono / JetBrains Mono).

---

## Pour l'utilisateur

### Importer un fichier

Onglet **Import** → déposer l'export PowerPanne. L'application montre un
aperçu avant d'enregistrer quoi que ce soit :

| Ce qui est affiché | Ce que cela veut dire |
|---|---|
| Lignes lues | tout ce que contient le fichier |
| Lignes de total | une par onglet, reconnue à ses « / », exclue |
| Facturation groupée | montant au-delà de 3 000 €, isolée (voir plus bas) |
| Doublons | lignes déjà connues d'un import précédent, fusionnées |
| Interventions retenues | ce qui alimentera les indicateurs |
| Délais aberrants | négatifs ou supérieurs à 24 h, écartés des moyennes |

Le bouton **Colonnes reconnues** dit précisément quelle colonne du fichier
alimente quel champ, lesquelles ont été ignorées et lesquelles ne servent pas.
Si une colonne indispensable manque, l'import est bloqué et la colonne est
nommée.

Deux exports qui se chevauchent ne créent pas de doublon : le dernier import
fait foi. L'historique des imports est consultable, et un import peut être
supprimé avec les interventions qu'il a apportées.

### Les trois écrans

**Temps réel** — cinq compteurs, chacun cliquable pour ouvrir la liste des
dossiers concernés (numéro, dépanneur, heure, lieu), chacun avec un seuil
d'alerte modifiable. Le sélecteur **Journée** permet de rejouer une journée
passée. Le nombre de dépanneurs en service se saisit en haut à droite.

**Revue hebdomadaire** — six indicateurs, chacun en courbe sur huit semaines,
avec propriétaire nommé et cible tracée. Plus la vue croisée SLA heure × jour
de semaine, qui montre les créneaux sous-armés. Les actions du comité
précédent sont en tête d'écran.

**Revue mensuelle** — l'économie : CA opérationnel, marge par intervention,
CA par heure payée, marge par convention, rendement par véhicule, coût des
pertes, mix d'activité. Chaque marge affiche l'encart **Base de calcul** qui
rappelle sur quels paramètres elle repose.

### Poser une cible, enregistrer une action

Sur chaque indicateur, **+ Cible** ouvre la saisie : valeur visée, échéance,
propriétaire. La cible apparaît ensuite en repère sur la courbe, et un badge
dit si elle est tenue.

**+ Action** enregistre jusqu'à trois actions par comité : libellé, porteur,
échéance, indicateur de preuve. Au comité suivant, elles sont en tête d'écran
et se marquent **Faite / Non faite / Bloquée**.

Cibles, actions, seuils et paramètres de coût survivent aux imports.

### Reprise depuis DepanTime

Trois données absentes de l'export PowerPanne viennent de l'applicatif de
pointage :

| Donnée | Où | Comment |
|---|---|---|
| Dépanneurs en service | Temps réel | rempli seul depuis le pointage du jour ; une saisie manuelle le remplace |
| Jours travaillés | Revue hebdo → *Jours travaillés* | bouton *Reprendre depuis DepanTime* |
| Heures payées du mois | Revue mensuelle → *Paramètres de coût* | bouton *Reprendre les heures* |

La reprise ne remplit qu'un aperçu : vous voyez ce qui a été rapproché avant
de valider. Les noms ne se correspondent pas d'un applicatif à l'autre
(« Dylan Roux » d'un côté, `{nom: ROUX, prenom: Dylan}` de l'autre, plus les
fautes récurrentes et les homonymes) : l'appariement tolère une faute de
frappe et les inversions, mais **refuse de deviner** quand deux fiches sont à
égalité — donner les jours d'une personne à une autre fausserait son CA par
jour sans que rien ne le signale. Les cas non tranchés sont à choisir à la
main, et le choix est mémorisé.

Un **jour de congés** compte dans les heures payées mais pas dans les jours
travaillés : DepanTime y pré-remplit 7 h pour la paie, or aucune intervention
n'y est produite.

Tant que la passerelle n'est pas configurée (voir `DEPLOIEMENT.md`), les trois
valeurs restent en saisie manuelle et tout le reste fonctionne.

### Ce qui doit être décidé

Deux paramètres n'existent nulle part : le **coût horaire chargé** et le
**coût kilométrique** (global, et par véhicule si les profils diffèrent). Tant
qu'ils ne sont pas ajustés, les marges reposent sur les valeurs par défaut
(28 €/h et 0,45 €/km), ce que l'écran indique sous chaque chiffre.

---

## Définitions de calcul

Elles vivent dans un seul fichier, `src/core/metrics.js`, et les trois écrans
appellent les mêmes fonctions. Un SLA affiché en temps réel et le même SLA en
revue hebdomadaire sortent du même code.

| Indicateur | Définition |
|---|---|
| Délai d'acceptation | `Date d'acceptation (mobile)` − `Date de première affectation` |
| Délai d'arrivée | `Date d'arrivée sur lieu (mobile)` − `Date de première affectation` |
| SLA | part des interventions arrivées en ≤ 45 min, **hors** `Rendez-vous = OUI` |
| DPR imputables | `materiel_inapproprie` ou `vehicule_non_trouve` (l'annulation client est exclue) |
| Dossier non facturé | `Date de facturation` vide |
| CA opérationnel | somme des `Total HT`, hors facturation groupée |
| Marge | `Total HT` − (durée × coût horaire) − (km × coût kilométrique du véhicule) |

Toute médiane, moyenne ou taux ignore les valeurs aberrantes — délai négatif
ou supérieur à 24 h — et **le nombre de lignes écartées est affiché** sous
l'indicateur.

### Règles de nettoyage

1. **Lignes de total** — une par onglet, reconnaissable à la valeur `/` dans
   la plupart des colonnes.
2. **Facturation groupée** — `Total HT` au-delà du seuil (3 000 € par défaut,
   réglable). Typiquement des regroupements trimestriels de frais de parc.
   Exclues des indicateurs opérationnels, consultables dans la revue mensuelle.
3. **Horodatages** — seuls les suffixes `(mobile)` et `(web)` sont exploités.
   Les `(modifiée)`, remplis à moins de 50 %, sont ignorés.
4. **Identité d'une intervention** — ni `Numéro de dossier` ni `Numéro de
   mission` ne sont des clés : un dossier porte souvent plusieurs missions
   (`…OM1`, `…OM2`) confiées à des dépanneurs différents, et le champ mission
   accueille de la saisie libre (sur l'export de juillet 2026, `1` revient
   381 fois, à côté de `NE PAS FACTURER` ou `PAYANT 160€`). L'empreinte
   combine dossier, mission, dépanneur, horodatages et montant.

---

## Pour la personne qui reprend le code

### Architecture

```
src/
  core/                 pur, testable, sans dépendance — tourne aussi dans Node
    schema.js           le SEUL endroit qui connaît les noms de colonnes
    normalize.js        lignes brutes → interventions canoniques (nettoyage)
    metrics.js          toutes les définitions de calcul
    matching.js         appariement des noms PowerPanne ↔ DepanTime
  sources/              adaptateurs interchangeables
    xlsxSource.js       export Excel multi-onglets (SheetJS, dans le navigateur)
    apiSource.js        API PowerPanne — en place, en attente d'ouverture
  components/           graphiques SVG et primitives d'interface
  screens/              les trois écrans + import + réglages
  store.js              accès aux données : API Cockpit, ou navigateur seul
api/                    Express + PostgreSQL — stocke, ne calcule pas
  depantime.js          passerelle de pointage, en lecture seule
test/                   60 tests du noyau (node --test)
scripts/verify-import.mjs  vérification du noyau contre un export réel
```

**Le point important** : les indicateurs ne sont pas calculés côté serveur.
Le serveur stocke les interventions normalisées, le navigateur applique
`core/metrics.js`. Recoder les définitions côté API créerait une seconde
vérité, exactement ce que le cahier des charges veut éviter.

### Changer de source de données

Une source respecte ce contrat :

```js
{ id, label, needs, load(input, opts) => Promise<{ headers, rows, sheets, meta }> }
```

Elle produit des lignes brutes `{ [nomDeColonne]: valeur }` — elle ne nettoie
rien et ne calcule rien. Pour brancher l'API PowerPanne :

1. renseigner `CK_POWERPANNE_URL` et `CK_POWERPANNE_TOKEN` côté serveur (le
   jeton ne doit jamais transiter par le navigateur : la route
   `/api/powerpanne/interventions` relaie) ;
2. ajuster `mapRecord()` dans `src/sources/apiSource.js` aux noms de champs
   réellement renvoyés ;
3. passer `available: true`.

Aucune ligne de calcul ne bouge. Si l'API renomme des colonnes, les variantes
s'ajoutent dans les `aliases` de `src/core/schema.js`.

### Vérifier le noyau

```bash
npm test                                          # 60 tests des définitions
node scripts/verify-import.mjs "chemin/export.xlsx"   # contrôle sur un vrai fichier
```

Le second imprime les chiffres que doivent afficher les écrans. Sur l'export
de juillet 2026 : 4 186 lignes lues, 49 totaux, 8 lignes groupées (277 460 €),
4 129 interventions, CA opérationnel 411 969 €, SLA 63,1 %, 86 DPR imputables.

### Développement

```bash
npm install && npm run dev        # front sur http://localhost:5174
cd api && npm install && npm run dev   # API sur le port 3100
```

Sans API joignable, l'application bascule seule sur le stockage navigateur
(IndexedDB) : elle est utilisable sans serveur, mais les données restent sur
le poste. L'écran Réglages indique le mode actif.

### Déploiement

Front, API et Postgres dans `/srv/pilotage` sur le VPS, derrière Traefik
comme DepanTime, sur `https://pilotage.alex-worksmart.com`. nginx sert le
front et proxifie `/api/` : une seule origine, pas de CORS.
**Pas-à-pas complet dans `DEPLOIEMENT.md`.**

L'historique est purgé au-delà de 14 mois (`CK_RETENTION_MONTHS`), de quoi
tenir les courbes 8 semaines et 12 mois avec de la marge.

### Choix à connaître

- **Pas de bibliothèque de graphiques.** Les courbes, barres, heatmap et
  jauges sont du SVG dans `components/charts.jsx` (~500 lignes). Le contrôle
  sur la charte le justifiait ; la palette catégorielle
  (`#2C6126 · #185FA5 · #A09D1E · #A32D2D`) est validée pour la vision des
  couleurs (ΔE deutan 19,4 sur la paire adjacente la plus proche).
- **Chaque graphique a une vue tableau** (bouton « Tableau »), et chaque
  valeur reste lisible sans survol.
- **SheetJS est chargé à la demande** : il pèse plus que tout le reste de
  l'application et seul l'écran d'import en a besoin.
- **Trois actions maximum par comité.** La contrainte est volontaire, elle
  force le comité à choisir. Elle est appliquée côté serveur.
