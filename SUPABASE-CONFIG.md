# Configuration Supabase de TIE

Projet dédié : `TIE`
- Project ref : `tpsmiddspufirkfdvsqy`
- URL : `https://tpsmiddspufirkfdvsqy.supabase.co`
- Région : `eu-west-3` (Europe/Paris)

## Base de données installée
La migration `create_app_predictions` a été appliquée. Elle crée `public.app_predictions` avec les colonnes utilisées par `apps/web/lib/store.ts`, les index de recherche et RLS activé.

Vérifications effectuées :
- table présente ;
- RLS activé ;
- `service_role` autorisé à lire ;
- `anon` et `authenticated` non autorisés à lire ;
- 0 ligne au démarrage (aucune donnée fictive injectée).

L'absence de politique RLS publique est volontaire : TIE doit accéder à cette table uniquement depuis le serveur Next.js avec la clé secrète `SUPABASE_SERVICE_ROLE_KEY`. Ne jamais mettre cette clé dans le HTML, dans une variable `NEXT_PUBLIC_*`, dans GitHub ou dans un fichier public.

## Dernière étape de connexion
Ajouter la clé secrète serveur du projet TIE comme variable d'environnement sur l'hébergeur (nom exact : `SUPABASE_SERVICE_ROLE_KEY`), puis redéployer. La clé publique et l'URL sont déjà renseignées dans `.env.example` et `.env.local` ; elles ne remplacent pas la clé serveur.

Après configuration, vérifier `GET /api/health` : `storage` doit être `supabase` et `supabaseConfigured` doit être `true`.
