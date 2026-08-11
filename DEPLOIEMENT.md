# Déploiement du Cockpit

Tout tourne sur le VPS, dans `/srv/pilotage`, derrière le Traefik existant :

```
                                    VPS  /srv/pilotage
                                    ┌──────────────────────────────────────┐
  pilotage.alex-worksmart.com       │  Traefik                             │
  ────────────────────────────▶     │   └─ pilotage-front (nginx)          │
        (Cloudflare, proxied)       │        ├─ /       → le front React   │
                                    │        └─ /api/   → pilotage-api     │
                                    │              ├─ pilotage-db (PG)     │
                                    │              └─ depantime-api ◀──────┼─ réseau Docker
                                    └──────────────────────────────────────┘   (pointage)
```

**Un seul domaine.** nginx sert les fichiers du front et proxifie `/api/` vers
l'API sur le réseau interne : le navigateur ne voit qu'une origine, il n'y a
donc pas de CORS à régler et l'API n'est jamais exposée directement.

La passerelle DepanTime passe par le réseau Docker interne : rien ne sort du
serveur.

> **Pourquoi « pilotage » et non « cockpit ».** Le serveur héberge déjà une
> autre application nommée *cockpit patrimonial*, dans `/srv/cockpit` et sur
> `cockpit.alex-worksmart.com`. Dossier, conteneurs et routeur Traefik portent
> donc le préfixe `pilotage` pour ne rien écraser.

Comptez **20 à 30 minutes** la première fois.

---

## Avant de commencer

Sur le VPS, vérifier que l'existant est bien là :

```bash
docker network ls | grep -E 'web|depantime'
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'traefik|depantime'
```

Vous devez voir le réseau `web`, le réseau `depantime_depantime-net`, et les
conteneurs `traefik` + `depantime-api` en marche.

**Si le réseau DepanTime porte un autre nom**, corrigez-le dans
`docker-compose.yml` :

```yaml
  depantime-net:
    external: true
    name: <le nom relevé plus haut>
```

---

## 1 — DNS

Dans Cloudflare, zone `alex-worksmart.com` :

| Type | Nom | Contenu | Proxy |
|---|---|---|---|
| A | `pilotage` | l'IP du VPS | **activé** (nuage orange) |

> **Un seul niveau de sous-domaine.** Le certificat Universal SSL de
> Cloudflare couvre `*.alex-worksmart.com`, pas `*.quelquechose.alex-worksmart.com`.
> Un nom comme `cockpit.mtp.alex-worksmart.com` échouerait au handshake TLS
> tant que le proxy est activé. Si un tel nom est un jour nécessaire, il faut
> soit passer l'enregistrement en *DNS only*, soit souscrire l'Advanced
> Certificate Manager.

Traefik demandera le certificat tout seul (`certresolver=le`, challenge DNS-01
via Cloudflare, le même que DepanTime).

---

## 2 — Mettre le code sur GitHub

Depuis le poste, dans le dossier `cockpit/` :

```bash
git init
git add .
git commit -m "Cockpit — pilotage dépannage"
git remote add origin https://github.com/AlexDiLorenzo/cockpit.git
git push -u origin main
```

Le `.gitignore` exclut `node_modules/`, `dist/`, `.env` et `postgres/`.
**Vérifiez qu'aucun secret ne part** avant de pousser :

```bash
git ls-files | grep -iE 'env|xlsx'
```

Seul `.env.example` doit apparaître.

---

## 3 — Installer sur le VPS

```bash
sudo mkdir -p /srv/pilotage
sudo chown -R $USER:$USER /srv/pilotage
cd /srv/pilotage
git clone https://github.com/AlexDiLorenzo/cockpit.git .
```

Créer le fichier de secrets :

```bash
cp .env.example .env
nano .env
```

À renseigner :

| Variable | Valeur |
|---|---|
| `CK_DB_PASSWORD` | un mot de passe long — `openssl rand -base64 24` |
| `CK_JWT_SECRET` | une autre chaîne aléatoire — `openssl rand -base64 48` |
| `CK_HOST` | `pilotage.alex-worksmart.com` |
| `CK_DEFAULT_PASSWORD` | mot de passe initial du compte `admin` |

Laissez les variables DepanTime vides pour l'instant : on les remplira à
l'étape 5, une fois le reste vérifié.

Puis démarrer :

```bash
sudo docker compose up -d --build
sudo docker compose logs -f pilotage-api
```

Vous devez lire, dans l'ordre :

```
[cockpit] compte « admin » créé (mot de passe : …)
[cockpit] base prête
[cockpit] API sur le port 3100
```

`Ctrl+C` pour quitter les logs (les conteneurs continuent).

Comptez une minute pour l'émission du certificat, puis vérifiez :

```bash
curl https://pilotage.alex-worksmart.com/api/health
```

Réponse attendue : `{"ok":true,"auth":true}`

> Si vous obtenez une erreur TLS ou un **526**, laissez passer deux minutes :
> le certificat est en cours d'émission. `sudo docker logs traefik --tail 50`
> le confirme.

---

## 4 — Première connexion

Ouvrez `https://pilotage.alex-worksmart.com`.

1. Connectez-vous avec `admin` et le `CK_DEFAULT_PASSWORD` du `.env`.
2. **Réglages → Compte → changez le mot de passe.**
3. Vérifiez dans **Réglages → Source de données** que le mode indique
   « Serveur Cockpit ». S'il affiche « Poste local », le front ne joint pas
   l'API — voir *Dépannage* plus bas.

---

## 5 — Brancher la passerelle DepanTime

Elle fournit l'effectif du jour, les jours travaillés par dépanneur et les
heures payées du mois. Sans elle, ces trois valeurs restent en saisie
manuelle et tout le reste fonctionne : vous pouvez faire cette étape plus tard.

**a. Créer un compte de service dans DepanTime.** Un compte dédié, pas un
compte nominatif : le rôle `dispatch` suffit, la passerelle ne fait que lire.

**b. Renseigner ses identifiants sur le VPS :**

```bash
cd /srv/pilotage
nano .env
```

```
CK_DEPANTIME_URL=http://depantime-api:3000
CK_DEPANTIME_USER=cockpit
CK_DEPANTIME_PASSWORD=<le mot de passe du compte de service>
```

L'URL est le **nom du conteneur**, pas le domaine public : l'appel reste dans
Docker, le mot de passe ne sort jamais du serveur.

```bash
sudo docker compose up -d
```

**c. Choisir le site.** Dans le Cockpit, **Réglages → Passerelle DepanTime** :
la pastille doit passer à « connectée ». Sélectionnez le site (MTP).

**d. Vérifier.** Revue hebdomadaire → *Jours travaillés* → *Reprendre depuis
DepanTime*. La fenêtre montre les rapprochements de noms. Les cas qu'elle
n'a pas tranchés — nom absent de DepanTime, ou deux noms PowerPanne désignant
la même fiche — sont à choisir à la main ; le choix est mémorisé.

> **Pourquoi certains noms ne se rapprochent pas seuls** — PowerPanne écrit
> « Dylan Roux », DepanTime stocke `{nom: ROUX, prenom: Dylan}`, et il existe
> des fautes récurrentes (THUAL/THURAL) et des homonymes (les deux Bouhajra,
> les deux Facon). L'appariement tolère une faute de frappe et les inversions,
> mais refuse de deviner quand deux fiches sont à égalité : donner les jours
> d'une personne à une autre fausserait son CA par jour, sans que rien ne le
> signale.

---

## 6 — Premier import

**Import** → déposer l'export PowerPanne « Historique dépanneur ».

Vérifiez l'aperçu avant de valider. Sur l'export de juillet 2026, il affiche :
4 186 lignes lues, 49 lignes de total, 8 lignes de facturation groupée
(277 460 €), 4 129 interventions retenues, CA opérationnel 412,0 k€,
SLA 63,1 %, 86 DPR imputables.

Pour que les courbes sur 8 semaines et 12 mois se remplissent, **importez
l'historique** : un export par mois écoulé. L'ordre n'a pas d'importance, et
deux exports qui se chevauchent ne créent pas de doublon.

---

## 7 — Mises à jour

```bash
cd /srv/pilotage
git pull
sudo docker compose up -d --build
```

Le front est reconstruit dans l'image nginx : un `git pull` suffit, il n'y a
pas de déploiement séparé.

Les données ne bougent pas : elles sont dans le volume
`/srv/pilotage/postgres`, hors des conteneurs.

---

## 8 — Sauvegarde

La base contient ce qui ne se réimporte pas : cibles, actions de comité,
seuils, paramètres de coût, rapprochements de noms.

`scripts/sauvegarde.sh` fait le dump, vérifie qu'il n'est pas vide et purge
au-delà de 30 jours. En tâche planifiée, une fois par nuit — le crontab de
l'utilisateur suffit, il est dans le groupe `docker` :

```bash
crontab -e
```

```cron
30 3 * * * /srv/pilotage/scripts/sauvegarde.sh >> /srv/pilotage/sauvegardes/cron.log 2>&1
```

À la main :

```bash
/srv/pilotage/scripts/sauvegarde.sh
ls -lh /srv/pilotage/sauvegardes/
```

Restauration :

```bash
gunzip -c /srv/pilotage/sauvegardes/cockpit-2026-08-11.sql.gz \
  | docker exec -i pilotage-db psql -U cockpit cockpit
```

---

## Dépannage

**Le Cockpit affiche « Poste local » au lieu de « Serveur Cockpit »**
Le front ne joint pas l'API. Dans la console du navigateur (F12), regardez
l'appel à `/api/health`.
- **502** → nginx ne joint pas l'API. `sudo docker compose logs pilotage-api`
  et vérifiez que le conteneur tourne.
- **404** → le bloc `location /api/` de `nginx.conf` n'est pas dans l'image ;
  reconstruisez avec `--build`.

**Erreur 526 dans le navigateur**
Cloudflare joint le serveur mais refuse son certificat. Soit Traefik n'a pas
encore de route pour ce domaine (le conteneur front est-il démarré ?), soit le
certificat est en cours d'émission :

```bash
sudo docker logs traefik --tail 80 | grep -i pilotage
```

**« DepanTime injoignable » dans Réglages**
```bash
sudo docker exec pilotage-api wget -qO- http://depantime-api:3000/api/health
```
- Pas de réponse → les deux conteneurs ne partagent pas de réseau. Vérifiez
  le nom dans `docker-compose.yml` contre `docker network ls`.
- `unauthorized` → identifiants du compte de service erronés.

**Un import échoue en « 413 »**
Le corps dépasse la limite. `CK_BODY_LIMIT` vaut 64 Mo par défaut côté API et
`client_max_body_size` 64 Mo côté nginx ; au-delà de 15 000 interventions par
fichier, montez les deux et reconstruisez.

**Repartir de zéro sur la base** (efface tout, y compris cibles et actions)
```bash
cd /srv/pilotage
sudo docker compose down
sudo rm -rf postgres
sudo docker compose up -d --build
```

---

## Variante : front sur Cloudflare Pages

Le projet peut aussi servir le front depuis Cloudflare Pages, l'API restant
sur le VPS. Il faut alors :

1. retirer le service `pilotage-front` du `docker-compose.yml` ;
2. remettre `pilotage-api` sur le réseau `web` et lui rendre ses labels
   Traefik, sur un sous-domaine dédié (`pilotage-api.alex-worksmart.com`) ;
3. renseigner `CK_CORS_ORIGIN` avec l'URL exacte du front, sans barre finale ;
4. déclarer `VITE_API_URL` dans Cloudflare Pages — elle est lue **au build**,
   donc tout changement impose un redéploiement, pas seulement un redémarrage
   de l'API.

Ce montage ajoute une origine, donc du CORS, et un second certificat à
surveiller. Il n'a d'intérêt que si le front doit être servi depuis le réseau
Cloudflare plutôt que depuis le VPS.
