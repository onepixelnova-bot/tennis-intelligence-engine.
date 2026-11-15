# Tennis Intelligence Engine (TIE)

Application de suivi et d'analyse tennis : interface HTML, backend Next.js, moteur ML Python facultatif et persistance Supabase.

## Structure
- `apps/web/` : application Next.js 15, interface (`public/tie.html`, `public/dashboard.html`) et API.
- `services/ml/` : service FastAPI facultatif.
- `supabase/migrations/` : schéma SQL de TIE.
- `netlify.toml` : configuration de build Netlify.
- `docs/` : état, validation et configuration.

## Développement local
```bash
cd apps/web
npm install
npm run dev
```

## Déploiement Netlify
Netlify doit construire l'application Next.js depuis `apps/web` avec `npm run build`. Ne déployer ni uniquement les fichiers HTML, ni un export statique : les routes API `/api/*` sont nécessaires.

Variables serveur à configurer dans Netlify :
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clé publishable)
- `SUPABASE_SERVICE_ROLE_KEY` (secret serveur uniquement)

Ne jamais committer de fichier `.env.local` ni publier la clé `SUPABASE_SERVICE_ROLE_KEY`.

## Avertissement avant production
Les routes API de lecture, création et règlement des prédictions ne disposent pas encore d'authentification applicative. Ne pas ouvrir l'application au public ni utiliser des données sensibles avant d'avoir ajouté et testé un contrôle d'accès.

Voir `NETLIFY-DEPLOYMENT.md` et `docs/` pour les limites et vérifications restantes.
