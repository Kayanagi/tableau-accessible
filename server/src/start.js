// Point d'entrée du processus. Sous PM2, process.argv[1] désigne le lanceur de PM2 : une comparaison
// avec le fichier courant ne démarrerait jamais le serveur, et PM2 l'afficherait quand même en ligne.
import { main } from './index.js';

main().catch(err => {
  console.error(`[baro] démarrage impossible : ${err.message}`);
  process.exit(1);
});
