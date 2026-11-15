# État du produit — Tennis Intelligence Engine

## Pipeline présent dans le code

```
Input J1/J2
 → BetPawa events + multi-markets
 → Rankings ESPN → Elo
 → Forme / H2H / surface (ESPN scoreboard)
 → Charge physique (volume 7/14/21j)
 → Ensemble ML (Elo + logistic features) — service ou fallback local
 → Opportunités tous marchés modélisés
 → SelectionEngine (1 sélection max ou aucune)
 → Persist (Supabase ou fichier)
 → Dashboard ROI / settlement
```

## Modules
| Module | Fichiers clés |
|---|---|
| BetPawa connector | `apps/web/lib/betpawa.ts`, `betpawa-markets.ts` |
| Rankings / Elo | `apps/web/lib/rankings.ts` |
| Forme / H2H | `apps/web/lib/player-stats.ts` |
| Physique | `apps/web/lib/physical.ts` |
| ML ensemble | `services/ml/app/main.py`, `apps/web/lib/ml-client.ts` |
| EV + sélection | `apps/web/lib/selection.ts`, `market-models.ts` |
| Store | `apps/web/lib/store.ts` + Supabase |
| UI | `/tie.html`, `/dashboard`, `/api/*` |

## État de préparation
- Frontend HTML, application Next.js/API, service ML facultatif et migration Supabase présents dans le paquet.
- Projet Supabase TIE dédié : `tpsmiddspufirkfdvsqy` (région `eu-west-3`). La table `public.app_predictions` a été créée et configurée avec RLS ; accès SQL/API réservé au rôle serveur `service_role`.
- La clé `SUPABASE_SERVICE_ROLE_KEY` doit être ajoutée uniquement dans les variables d'environnement Netlify.
- Aucun déploiement Netlify n'a été effectué.
- Le build Next.js n'a pas été exécuté avec succès dans l'environnement de préparation : l'installation npm avait échoué à cause d'une erreur DNS (`EAI_AGAIN registry.npmjs.org`).

## Blocage sécurité avant ouverture publique
Les routes API de lecture, ajout et règlement (`/api/predictions`, `/api/performance`, et opérations de règlement) ne disposent pas encore d'authentification applicative. Toute personne pouvant atteindre ces routes pourrait consulter ou modifier des données via l'application. Ajouter et tester un contrôle d'accès avant de rendre TIE public ou d'y stocker des données sensibles.

## Limites fonctionnelles
- Entraînement XGBoost offline sur plusieurs saisons : structure non intégrée à un dataset historique massif.
- Settlement entièrement automatique : les commandes manuelles et l'API existent, mais le règlement automatique complet n'est pas validé.
- BetPawa/ESPN, endpoints en production, persistance distante depuis l'application et parcours complet utilisateur restent à tester.
