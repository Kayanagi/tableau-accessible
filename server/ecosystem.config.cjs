// Configuration PM2 de Baro. Aucun secret : les jetons sont aléatoires et stockés hachés.
// fork, une seule instance : les compteurs de débit et la file de scrypt vivent en mémoire.
module.exports = {
  apps: [
    {
      name: 'baro-server',
      cwd: __dirname,
      script: 'src/start.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '400M',
      env: {
        // Sans cette valeur, les garde-fous du cookie et de scrypt ne s'appliquent pas.
        NODE_ENV: 'production',
        PORT: 3006,
        BARO_DB: '/var/lib/baro/baro.db',
        BARO_ORIGIN: 'https://baro.dwes.fr',
        BARO_INSCRIPTIONS: 'ouvert'
      }
    }
  ]
};
