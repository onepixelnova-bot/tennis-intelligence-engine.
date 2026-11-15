# Tennis Intelligence Engine (TIE)

L'interface utilisateur est servie en HTML statique depuis `public/tie.html` et `public/dashboard.html`.

Le serveur Next.js reste indispensable : il expose les API `/api/analyze`, `/api/health`, `/api/performance` et `/api/predictions`, protège les secrets et relie l'interface à BetPawa, au moteur ML et à Supabase.

## Configuration
- Node.js 20+
- `cd apps/web && npm install`
- Copier `.env.example` vers `.env.local`.
- L'URL et la clé publique du projet TIE sont déjà indiquées.
- Ajouter `SUPABASE_SERVICE_ROLE_KEY` uniquement dans l'environnement serveur de l'hébergeur. Ne jamais placer cette clé dans le HTML ou dans une variable `NEXT_PUBLIC_*`.
- La table `public.app_predictions` a déjà été créée dans le projet Supabase TIE. Voir `../../docs/SUPABASE-CONFIG.md`.
- Démarrer avec `npm run dev`, puis ouvrir `http://localhost:3000`.
- Vérifier `/api/health` : `storage` doit indiquer `supabase` et `supabaseConfigured` doit être `true` une fois la clé serveur configurée.

Le HTML appelle les API du même domaine. Il ne doit pas être ouvert comme un fichier local `file://` ni hébergé séparément sans configurer une URL d'API autorisée.

## ML facultatif
`cd services/ml && pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 8001`
