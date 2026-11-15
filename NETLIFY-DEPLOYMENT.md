# TIE — préparation Netlify

## Architecture conservée
- Interface utilisateur : HTML statique (`/tie.html` et `/dashboard.html`).
- Serveur : Next.js 15, avec les routes API `/api/*`.
- Données : projet Supabase TIE déjà configuré dans la migration fournie.
- Le serveur Next.js est indispensable : ne pas publier uniquement le dossier HTML ou `public/`.

## Réglages de build
Le fichier `netlify.toml` configure :
- Base directory : `apps/web`
- Build command : `npm run build`
- Publish directory : `.next`

Netlify prend en charge Next.js 13.5+ avec son runtime OpenNext détecté automatiquement. Ne pas ajouter de redirection générale `/* -> /index.html`, car elle casserait les routes API.

## Variables d'environnement à définir dans Netlify
Dans Site configuration → Environment variables, définir :

- `NEXT_PUBLIC_SUPABASE_URL` = `https://tpsmiddspufirkfdvsqy.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = la clé publishable du projet TIE
- `SUPABASE_SERVICE_ROLE_KEY` = clé secrète service_role du projet TIE (serveur uniquement)
- `ML_SERVICE_URL` = URL publique du service ML si celui-ci est déployé ; sinon laisser non configuré et vérifier le comportement de repli prévu par l'application.

Ne jamais mettre `SUPABASE_SERVICE_ROLE_KEY` dans un fichier HTML, une variable `NEXT_PUBLIC_*`, ni dans un dépôt public. Après ajout/modification des variables, relancer un déploiement.

## Limite actuelle
Ce paquet est préparé pour le build Netlify, mais il n'est pas encore déployé. La compilation Next.js et les tests en production restent à effectuer. Le déploiement complet nécessite que Netlify puisse récupérer les sources via un dépôt Git connecté ou qu'un déploiement soit envoyé avec Netlify CLI depuis un environnement disposant de Node.js et d'un accès réseau.


## Protection d'accès obligatoire avant mise en ligne

TIE est livré en mode privé avec une authentification HTTP Basic appliquée à toutes les pages et routes API (y compris `/api/health`, `/api/analyze`, `/api/predictions` et `/api/performance`). Le navigateur demandera un identifiant et un mot de passe.

Dans Netlify → Site configuration → Environment variables, définir :

- `TIE_ACCESS_USERNAME` : nom d'utilisateur privé (au moins 3 caractères).
- `TIE_ACCESS_PASSWORD` : mot de passe long, unique, d'au moins 16 caractères.

Ne jamais mettre ces valeurs dans GitHub, dans le HTML ou dans une variable `NEXT_PUBLIC_*`. Après ajout/modification des variables, relancer un nouveau déploiement. Si les variables sont absentes ou insuffisantes, TIE renvoie volontairement HTTP 503 et reste inaccessible. Les requêtes d'écriture sans origine identique au site sont refusées.

Cette protection est une barrière d'accès partagée adaptée à une première version privée ; ce n'est pas un système de comptes individuels ni une gestion de rôles.
