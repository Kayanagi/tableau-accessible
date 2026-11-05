export const CATEGORIES = ['Réunions et ateliers', 'Idéation et brainstorming', 'Recherche et design', 'Agile', 'Stratégie et planification', 'Diagrammes et cartographie', 'Présentations', 'Wireframes et prototypes', 'Mes modèles'];
const [REUNION, IDEE, DESIGN, AGILE, STRAT, DIAG, PRES, WIRE] = CATEGORIES;

/* Petit constructeur : les identifiants item-N sont attribués à l'ajout. */
class Board {
  constructor() { this.items = []; }
  add(type, x, y, props = {}) {
    const id = `item-${this.items.length + 1}`;
    this.items.push({ id, type, x, y, ...props });
    return id;
  }
  title(text, x = 40, y = 20, width = 900) { return this.add('text', x, y, { content: text, width, height: 40, fontSize: 28, bold: true }); }
  hint(text, x = 40, y = 66, width = 900, parent = null) { return this.add('text', x, y, { content: text, width, height: 24, fontSize: 15, parent }); }
  frame(label, x, y, width, height) { return this.add('frame', x, y, { content: label, width, height }); }
  note(text, x, y, color = 'light_yellow', parent = null, size = 130) { return this.add('sticky_note', x, y, { content: text, color, width: size, height: size, parent }); }
  box(text, x, y, width = 160, height = 70, shape = 'rectangle', parent = null) { return this.add('shape', x, y, { shape, content: text, width, height, parent }); }
  card(title, content, x, y, parent = null, width = 240, height = 120) { return this.add('card', x, y, { title, content, width, height, parent }); }
  line(start, end, props = {}) {
    const ends = {};
    if (typeof start === 'string') ends.startId = start; else ends.start = start;
    if (typeof end === 'string') ends.endId = end; else ends.end = end;
    return this.add('connector', 0, 0, { label: '', lineType: 'straight', startCap: 'none', endCap: 'arrow_filled', ...ends, ...props });
  }
  /* Colonnes de sections : cadre, consigne et post-its d'exemple. */
  panels(list, { cols = 3, x0 = 40, y0 = 120, perRow = 2, note = 130 } = {}) {
    const gap = 10, width = perRow * (note + gap) + 30;
    let rowY = y0;
    for (let r = 0; r < Math.ceil(list.length / cols); r++) {
      const row = list.slice(r * cols, (r + 1) * cols);
      const hintH = 64;
      const height = Math.max(...row.map(s => Math.ceil(Math.max(1, s.notes.length) / perRow))) * (note + gap) + hintH + 24;
      row.forEach((s, c) => {
        const x = x0 + c * (width + 30);
        const f = this.frame(s.t, x, rowY, width, height);
        this.hint(s.h, x + 12, rowY + 10, width - 24, f);
        s.notes.forEach((text, n) => this.note(text, x + 15 + (n % perRow) * (note + gap), rowY + hintH + Math.floor(n / perRow) * (note + gap), s.c || 'light_yellow', f, note));
      });
      rowY += height + 50;
    }
    return this;
  }
  mind(rootText, branches, x = 60, y = 260) {
    const root = this.add('mindmap', x, y, { content: rootText, parentNode: null, width: 170, height: 56 });
    const leafCount = branches.reduce((n, br) => n + Math.max(1, br[1].length), 0);
    let row = y + 28 - leafCount * 30;
    for (const [text, leaves] of branches) {
      const count = Math.max(1, leaves.length);
      const branch = this.add('mindmap', x + 230, row + count * 30 - 22, { content: text, parentNode: root });
      leaves.forEach((leaf, i) => this.add('mindmap', x + 440, row + i * 60 + 8, { content: leaf, parentNode: branch }));
      row += count * 60;
    }
    return root;
  }
  slide(label, x, y, title, lines = [], note = null) {
    const f = this.frame(label, x, y, 800, 450);
    this.add('text', x + 40, y + 36, { content: title, width: 720, height: 48, fontSize: 32, bold: true, parent: f });
    lines.forEach((l, i) => this.add('text', x + 40, y + 110 + i * 44, { content: `• ${l}`, width: 720, height: 30, fontSize: 20, parent: f }));
    if (note) this.note(note, x + 620, y + 280, 'light_yellow', f, 150);
    return f;
  }
}

const spec = (id, nom, categorie, description, tags, build, extra = {}) => ({
  id, nom, icone: '◇', categorie, description, tags, partage: true, ...extra,
  données: () => { const b = new Board(); build(b); return { name: nom, items: JSON.parse(JSON.stringify(b.items)) }; }
});
const P = (t, h, notes, c) => ({ t, h, notes, c });

export const LIBRARY = [
  /* Réunions et ateliers */
  spec('revue-projet', 'Revue de projet', REUNION, 'Faire le point sur l’avancement, les risques et les décisions à prendre.', ['Suivi'], b => {
    b.title('Revue de projet'); b.hint('Trente minutes : l’état du projet, ce qui bloque, puis les décisions. Remplissez avant la réunion.');
    b.panels([P('État d’avancement', 'Livré depuis la dernière revue.', ['Maquettes validées', 'API de paiement en recette'], 'light_green'), P('Risques', 'Ce qui menace la date ou le budget.', ['Prestataire en retard', 'Charge de tests sous-estimée'], 'red'), P('Décisions', 'Ce que le groupe doit trancher aujourd’hui.', ['Reporter le lot 3 ?', 'Ajouter un testeur ?'], 'violet'), P('Prochaines étapes', 'Une action, une personne, une date.', ['Sophie : plan de tests, vendredi'], 'light_blue')], { cols: 4, perRow: 2 });
  }, { recommande: true }),
  spec('okr-hebdo', 'Réunion OKR hebdomadaire', REUNION, 'Suivre chaque semaine la confiance sur les objectifs et les résultats clés.', ['Suivi', 'Objectifs'], b => {
    b.title('Réunion OKR hebdomadaire'); b.hint('Notez la confiance de 0 à 10 pour chaque résultat clé, puis l’action de la semaine.');
    b.add('datatable', 40, 120, { content: 'Résultats clés', rows: [['Résultat clé', 'Cible', 'Actuel', 'Confiance'], ['Taux de conversion', '4 %', '3,1 %', '7/10'], ['Délai de réponse support', '2 h', '3 h', '5/10'], ['Nouveaux clients', '40', '26', '8/10']] });
    b.panels([P('Priorités de la semaine', 'Trois maximum.', ['Tester la nouvelle page tarifs', 'Former deux agents support'], 'miro_yellow'), P('Points d’alerte', 'Ce qui fait baisser la confiance.', ['Budget publicité épuisé'], 'red')], { cols: 2, x0: 560, y0: 120 });
  }, { recommande: true }),
  spec('brise-glace', 'Brise-glace', REUNION, 'Lancer un atelier en mettant chacun à l’aise en cinq minutes.', ['Brise-glace'], b => {
    b.title('Brise-glace'); b.hint('Chacun pose un post-it dans le cadre qui lui parle, puis se présente en une phrase.');
    b.panels([P('Mon humeur du jour', 'Une météo ou un emoji.', ['☀️ Grand soleil', '🌧 Un peu de pluie'], 'miro_blue'), P('Ce que j’attends de l’atelier', 'Une attente concrète.', ['Repartir avec un plan', 'Comprendre les priorités'], 'light_green'), P('Une chose à savoir sur moi', 'Vraie ou amusante.', ['J’élève des abeilles'], 'miro_orange')]);
  }, { recommande: true }),
  spec('ordre-du-jour', 'Ordre du jour de réunion', REUNION, 'Préparer les sujets, les décisions et les actions d’une réunion.', ['Suivi'], b => {
    b.title('Objectif de la réunion : décider du calendrier'); b.hint('Un objectif clair, des sujets minutés, et une action par décision.');
    b.panels([P('Sujets', 'Durée et responsable.', ['10 min : bilan du trimestre', '20 min : calendrier'], 'light_yellow'), P('Décisions', 'Formulées en une phrase.', ['Livraison reportée au 12'], 'violet'), P('Actions', 'Qui fait quoi pour quand.', ['Marc : prévenir le client'], 'light_green')]);
  }),
  spec('revue-sprint', 'Revue de sprint', REUNION, 'Présenter les résultats du sprint et recueillir les retours.', ['Suivi', 'Scrum'], b => {
    b.title('Revue de sprint'); b.hint('Montrez ce qui fonctionne, écoutez les retours, ajustez le backlog.');
    b.panels([P('Objectif du sprint', 'Atteint ou non, et pourquoi.', ['Paiement en un clic : atteint'], 'light_green'), P('Démonstration', 'Ce qui est livré.', ['Nouveau panier', 'Reçu par courriel'], 'miro_blue'), P('Retours', 'Remarques des parties prenantes.', ['Ajouter PayPal ?'], 'miro_orange'), P('Prochaines étapes', 'Impacts sur le backlog.', ['Prioriser PayPal'], 'violet')], { cols: 4, perRow: 1, note: 160 });
  }),
  spec('reunion-individuelle', 'Point individuel', REUNION, 'Structurer un entretien régulier entre une personne et son responsable.', ['Suivi'], b => {
    b.title('Point individuel'); b.hint('Quinze à trente minutes, dans l’intérêt de la personne : elle parle d’abord.');
    b.panels([P('Ce qui va bien', 'Réussites depuis le dernier point.', ['Présentation au client réussie'], 'light_green'), P('Ce qui freine', 'Obstacles et besoins d’aide.', ['Trop de réunions le matin'], 'light_pink'), P('Développement', 'Compétences à travailler.', ['Formation animation d’atelier'], 'light_blue'), P('Engagements', 'À vérifier la prochaine fois.', ['Libérer deux matinées'], 'miro_yellow')], { cols: 2 });
  }),
  spec('rose-bourgeon-epine', 'Rose Bourgeon Épine', REUNION, 'Faire un retour positif, prometteur et critique sur une période ou un projet.', ['Rétrospective'], b => {
    b.title('Rose, Bourgeon, Épine'); b.hint('Dix minutes en silence, puis regroupez et discutez.');
    b.panels([P('🌹 Rose', 'Ce qui a bien marché.', ['Bonne entraide', 'Clients ravis de la démo'], 'light_pink'), P('🌱 Bourgeon', 'Ce qui promet et mérite d’être développé.', ['Tests automatisés', 'Atelier mensuel'], 'light_green'), P('🌵 Épine', 'Ce qui a piqué ou bloqué.', ['Recette trop tardive', 'Outils lents'], 'red')]);
  }, { recommande: true }),

  /* Idéation et brainstorming */
  spec('brainstorming', 'Brainstorming', IDEE, 'Explorer les idées puis choisir les pistes à approfondir.', ['Idées'], b => {
    b.title('Comment rendre notre accueil client plus simple ?'); b.hint('Remplacez la question. Quantité d’abord, sans critique ; on trie ensuite.');
    b.panels([P('Question de départ', 'Le problème, en une question ouverte.', ['Que reprochent les clients aujourd’hui ?'], 'miro_blue'), P('Idées', 'Toutes les idées, même folles.', ['Rappel automatique', 'Formulaire unique', 'Agent virtuel', 'Accueil par SMS'], 'light_yellow'), P('À approfondir', 'Les trois idées retenues.', ['Formulaire unique'], 'light_green')]);
  }, { recommande: true }),
  spec('crazy-eights', 'Crazy Eights', IDEE, 'Dessiner huit idées en huit minutes pour sortir des évidences.', ['Idées', 'Croquis'], b => {
    b.title('Crazy Eights'); b.hint('Une minute par case : un croquis rapide, sans perfection. Présentez ensuite vos deux préférés.');
    for (let i = 0; i < 8; i++) { const f = b.frame(`Idée ${i + 1}`, 40 + (i % 4) * 240, 130 + Math.floor(i / 4) * 200, 220, 170); if (i === 0) b.note('Croquis de la page d’accueil', 70 + (i % 4) * 240, 150, 'light_yellow', f, 110); }
  }),
  spec('brainstorming-inverse', 'Brainstorming inversé', IDEE, 'Chercher comment aggraver le problème, puis retourner chaque réponse en solution.', ['Idées', 'Analyse'], b => {
    b.title('Brainstorming inversé'); b.hint('Question : comment faire fuir nos clients ? Inversez ensuite chaque réponse.');
    b.panels([P('Comment aggraver le problème ?', 'Le pire possible.', ['Ne jamais répondre', 'Cacher les tarifs', 'Changer les prix sans prévenir'], 'red'), P('En inversant', 'La solution correspondante.', ['Réponse sous 24 h', 'Tarifs publics', 'Préavis de 30 jours'], 'light_green')], { cols: 2, perRow: 3 });
  }),
  spec('multiplicateur-idees', 'Multiplicateur d’idées', IDEE, 'Faire varier une idée de départ avec sept angles (SCAMPER).', ['Idées'], b => {
    b.title('Multiplicateur d’idées (SCAMPER)'); b.hint('Partez d’une idée et appliquez chaque verbe pour en créer de nouvelles.');
    const hub = b.box('Idée de départ : livraison à vélo', 500, 300, 200, 110, 'circle');
    ['Substituer', 'Combiner', 'Adapter', 'Modifier', 'Autre usage', 'Éliminer', 'Renverser'].forEach((v, i) => {
      const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
      const n = b.note(v, Math.round(600 + Math.cos(a) * 380 - 65), Math.round(355 + Math.sin(a) * 240 - 65), ['miro_yellow', 'miro_blue', 'light_green', 'miro_orange', 'violet', 'light_pink', 'cyan'][i]);
      b.line(hub, n, { endCap: 'none' });
    });
  }),
  spec('brainwriting', 'Brainwriting', IDEE, 'Écrire en silence et enrichir les idées des autres, tour après tour.', ['Idées'], b => {
    b.title('Brainwriting 6-3-5'); b.hint('Six personnes, trois idées, cinq minutes par tour. Chaque colonne passe à la personne suivante.');
    ['Personne A', 'Personne B', 'Personne C'].forEach((name, c) => {
      const f = b.frame(name, 40 + c * 340, 120, 310, 470);
      ['Idée', 'Enrichie au tour 2', 'Enrichie au tour 3'].forEach((t, r) => b.note(t, 60 + c * 340, 140 + r * 145, ['light_yellow', 'miro_yellow', 'miro_orange'][r], f));
    });
  }),
  spec('effort-impact', 'Matrice impact/effort', IDEE, 'Choisir les actions au meilleur rapport entre impact et effort.', ['Priorisation'], b => {
    b.title('Matrice impact/effort'); b.hint('Placez chaque action selon son impact et l’effort demandé. Commencez en haut à gauche.');
    b.panels([P('Faible effort, fort impact', 'À faire tout de suite.', ['Corriger le formulaire'], 'light_green'), P('Fort effort, fort impact', 'À planifier.', ['Refonte du parcours'], 'miro_blue'), P('Faible effort, faible impact', 'Si le temps le permet.', ['Nouvelle icône'], 'light_yellow'), P('Fort effort, faible impact', 'À abandonner.', ['Application montre'], 'red')], { cols: 2, perRow: 2 });
  }, { recommande: true }),
  spec('premortem', 'Pré-mortem', IDEE, 'Imaginer que le projet a échoué pour en prévenir les causes.', ['Analyse'], b => {
    b.title('Pré-mortem'); b.hint('Nous sommes dans six mois et le projet a échoué. Pourquoi ? Que faire dès maintenant ?');
    b.panels([P('Causes de l’échec', 'Une par post-it.', ['Budget dépassé', 'Utilisateurs non consultés'], 'red'), P('Signaux d’alerte', 'Comment les voir venir.', ['Coût à plus de 80 %'], 'miro_orange'), P('Parades', 'Action et responsable.', ['Test utilisateur chaque mois'], 'light_green')]);
  }),

  /* Recherche et design */
  spec('persona', 'Persona', DESIGN, 'Décrire une personne, ses objectifs et ses freins.', ['Utilisateurs'], b => {
    b.card('Camille, 34 ans, cheffe de projet', 'Travaille en télétravail trois jours par semaine. Utilise surtout son téléphone.', 50, 50);
    b.add('flipcard', 300, 50, { content: 'Objectif : gagner du temps sur le suivi', back: 'Frein : outils multiples et notifications', width: 240, height: 120 });
    b.add('text', 50, 190, { content: 'Citation : « Je veux voir en un coup d’œil ce qui est en retard. »', width: 500, height: 30, fontSize: 16 });
  }, { recommande: true }),
  spec('parcours-utilisateur', 'Parcours utilisateur', DESIGN, 'Cartographier les étapes vécues et les opportunités.', ['Utilisateurs'], b => {
    b.title('Parcours utilisateur'); b.hint('Une colonne par étape : ce que la personne fait, ressent, et ce qu’on peut améliorer.');
    b.add('datatable', 40, 120, { content: 'Parcours', rows: [['Étape', 'Action', 'Émotion', 'Opportunité'], ['Découverte', 'Lit un avis', 'Curieuse', 'Mettre en avant les avis'], ['Inscription', 'Crée un compte', 'Agacée', 'Connexion en un clic'], ['Première utilisation', 'Suit le guide', 'Rassurée', 'Guide plus court']] });
  }),
  spec('synthese-recherche', 'Synthèse de recherche', DESIGN, 'Passer des observations aux enseignements et aux recommandations.', ['Synthèse'], b => {
    b.title('Synthèse de recherche'); b.hint('Des faits observés aux décisions : gardez un lien avec la source de chaque constat.');
    const a = b.frame('Observations', 40, 120, 320, 340), c = b.frame('Enseignements', 410, 120, 320, 340), d = b.frame('Recommandations', 780, 120, 320, 340);
    b.note('4 personnes sur 6 ne trouvent pas le bouton', 55, 140, 'light_yellow', a); b.note('Vocabulaire jugé technique', 205, 140, 'light_yellow', a);
    const n2 = b.note('Le parcours n’est pas compris', 425, 140, 'miro_blue', c), n3 = b.note('Déplacer et renommer le bouton', 795, 140, 'light_green', d);
    b.line(n2, n3);
  }),
  spec('carte-empathie', 'Carte d’empathie', DESIGN, 'Se mettre à la place d’une personne : ce qu’elle dit, pense, fait et ressent.', ['Utilisateurs'], b => {
    b.title('Carte d’empathie'); b.hint('Partez d’entretiens réels et distinguez ce qui est dit de ce qui est supposé.');
    b.panels([P('Dit', 'Citations exactes.', ['« Je n’ai pas le temps »'], 'miro_blue'), P('Pense', 'Préoccupations.', ['Peur de se tromper'], 'violet'), P('Fait', 'Comportements.', ['Note tout sur papier'], 'light_green'), P('Ressent', 'Émotions.', ['Stressée le lundi'], 'light_pink')], { cols: 2 });
  }, { recommande: true }),
  spec('critique-design', 'Critique de design', DESIGN, 'Recueillir des retours utiles et précis sur une maquette.', ['Critique'], b => {
    b.title('Critique de design'); b.hint('Posez la maquette au centre. Les retours parlent de l’objectif, pas des goûts.');
    const f = b.frame('Maquette à commenter', 40, 120, 480, 340); b.box('Écran', 80, 170, 400, 250, 'rectangle', f);
    b.panels([P('J’aime', 'Ce qui sert l’objectif.', ['Hiérarchie claire'], 'light_green'), P('Je m’interroge', 'Questions ouvertes.', ['Le prix est-il visible ?'], 'miro_yellow'), P('Et si…', 'Pistes d’amélioration.', ['Bouton plus haut'], 'miro_blue')], { cols: 3, x0: 560, perRow: 1, note: 150 });
  }),
  spec('diagramme-affinites', 'Diagramme d’affinités', DESIGN, 'Regrouper des observations par thèmes pour faire émerger des tendances.', ['Synthèse', 'Analyse'], b => {
    b.title('Diagramme d’affinités'); b.hint('Déposez toutes les notes, regroupez-les en silence, puis nommez chaque groupe.');
    b.panels([P('Thème : rapidité', 'Nommez le groupe.', ['Chargement lent', 'Trop de clics'], 'miro_orange'), P('Thème : confiance', 'Nommez le groupe.', ['Peu d’avis clients', 'Paiement peu rassurant'], 'miro_blue'), P('Thème : aide', 'Nommez le groupe.', ['FAQ introuvable', 'Pas de contact'], 'light_green')]);
  }),

  /* Agile */
  spec('start-stop-continue', 'Rétro Start/Stop/Continue', AGILE, 'Décider ensemble des pratiques à faire évoluer.', ['Rétrospective'], b => {
    b.title('Rétrospective Start, Stop, Continue'); b.hint('Votez pour trois actions et donnez-leur un responsable.');
    b.panels([P('Commencer', 'Ce qu’on veut essayer.', ['Revue de code en binôme'], 'light_green'), P('Arrêter', 'Ce qui nous freine.', ['Réunions sans ordre du jour'], 'red'), P('Continuer', 'Ce qui marche.', ['Démo du vendredi'], 'miro_blue')]);
  }, { recommande: true }),
  spec('daily', 'Daily', AGILE, 'Partager les progrès et lever les obstacles en quinze minutes.', ['Scrum', 'Suivi'], b => {
    b.title('Daily'); b.hint('Quinze minutes debout : ce qui est fait, ce qui vient, ce qui bloque.');
    b.panels([P('Hier', 'Terminé.', ['Écran de connexion fini'], 'light_green'), P('Aujourd’hui', 'En cours.', ['Tests du paiement'], 'miro_blue'), P('Obstacles', 'À lever après le daily.', ['Accès à la recette'], 'red')]);
  }),
  spec('kanban-projet', 'Kanban', AGILE, 'Suivre les tâches du projet du début à la fin.', ['Kanban'], b => {
    b.add('kanban', 50, 50, { content: 'Projet', columns: [['À faire', ['Rédiger le cahier des charges', 'Choisir l’hébergeur']], ['En cours', ['Maquette de l’accueil']], ['En revue', []], ['Terminé', ['Cadrage validé']]].map(([name, cards], i) => ({ id: `col-${i}`, name, cards: cards.map((text, k) => ({ id: `task-${i}-${k}`, text })) })) });
  }, { recommande: true, format: 'Kanban' }),
  spec('user-story-map', 'User story map', AGILE, 'Organiser les activités et les versions du produit.', ['Planification'], b => {
    b.title('User story map'); b.hint('En haut le parcours, en dessous les histoires, découpées en versions.');
    ['Découvrir', 'Choisir', 'Payer', 'Suivre'].forEach((t, c) => b.box(t, 40 + c * 250, 120, 220, 60));
    b.frame('Version initiale', 30, 210, 1010, 180); b.frame('Version suivante', 30, 420, 1010, 180);
    [['Page d’accueil', 'Liste de produits', 'Carte bancaire', 'Courriel de suivi'], ['Recommandations', 'Comparateur', 'Paiement en 3 fois', 'Suivi en direct']].forEach((row, r) => row.forEach((t, c) => b.note(t, 75 + c * 250, 235 + r * 210, r ? 'light_blue' : 'light_yellow')));
  }),
  spec('backlog-produit', 'Backlog produit', AGILE, 'Lister, estimer et prioriser les histoires du produit.', ['Planification', 'Scrum'], b => {
    b.title('Backlog produit'); b.hint('Du plus prioritaire au moins prioritaire. Une histoire : En tant que…, je veux…, afin de…');
    b.add('datatable', 40, 120, { content: 'Backlog', rows: [['Histoire', 'Valeur', 'Estimation', 'État'], ['En tant que client, je paie en un clic', 'Haute', '5', 'Prête'], ['En tant qu’admin, j’exporte les ventes', 'Moyenne', '3', 'À affiner'], ['En tant que visiteur, je compare', 'Basse', '8', 'Idée']] });
  }, { recommande: true, format: 'Tableaux' }),
  spec('pi-planning', 'PI Planning', AGILE, 'Planifier un incrément sur plusieurs équipes et rendre les dépendances visibles.', ['Planification'], b => {
    b.title('PI Planning'); b.hint('Une ligne par équipe, une colonne par itération. Les flèches montrent les dépendances.');
    ['Itération 1', 'Itération 2', 'Itération 3'].forEach((t, c) => b.box(t, 200 + c * 290, 120, 270, 50));
    const ids = [];
    ['Équipe Web', 'Équipe API'].forEach((team, r) => {
      b.box(team, 40, 190 + r * 190, 140, 170);
      ['Parcours achat', 'Paiement', 'Suivi'].forEach((t, c) => ids.push(b.note(r ? `Service ${t.toLowerCase()}` : t, 270 + c * 290, 210 + r * 190, r ? 'miro_blue' : 'light_yellow')));
    });
    b.line(ids[4], ids[2], { stroke: 'red', label: 'Dépendance' });
    b.line(ids[3], ids[1], { stroke: 'red' });
  }),
  spec('planification-sprint', 'Planification de sprint', AGILE, 'Fixer l’objectif du sprint et sélectionner les histoires réalisables.', ['Planification', 'Scrum'], b => {
    b.title('Planification de sprint'); b.hint('Un objectif clair, la capacité de l’équipe, puis les histoires retenues.');
    b.panels([P('Objectif du sprint', 'Une phrase, compréhensible par le client.', ['Payer en un clic sur mobile'], 'violet'), P('Capacité', 'Personnes et absences.', ['5 personnes, 38 points'], 'miro_blue'), P('Histoires retenues', 'Par ordre de priorité.', ['Paiement mobile (8)', 'Reçu par courriel (3)'], 'light_green'), P('Risques', 'Ce qui peut déborder.', ['Validation banque'], 'red')], { cols: 4 , perRow: 1, note: 160 });
  }),

  /* Stratégie et planification */
  spec('eisenhower', 'Matrice d’Eisenhower', STRAT, 'Prioriser selon l’urgence et l’importance.', ['Analyse'], b => {
    b.title('Matrice d’Eisenhower'); b.hint('Ce qui est important passe avant ce qui est simplement urgent.');
    b.panels([P('Urgent et important', 'À faire maintenant.', ['Déclaration TVA'], 'red'), P('Important, non urgent', 'À planifier.', ['Plan de formation'], 'light_green'), P('Urgent, peu important', 'À déléguer.', ['Commande fournitures'], 'miro_orange'), P('Ni urgent ni important', 'À supprimer.', ['Réunion mensuelle sans objet'], 'miro_gray')], { cols: 2 });
  }),
  spec('swot', 'SWOT', STRAT, 'Étudier les forces, faiblesses, opportunités et menaces.', ['Analyse'], b => {
    b.title('SWOT'); b.hint('À gauche l’interne, à droite l’externe. Terminez par une action par case.');
    b.panels([P('Forces', 'Ce que nous faisons mieux que les autres.', ['Équipe expérimentée'], 'light_green'), P('Faiblesses', 'Ce qui nous limite.', ['Peu de notoriété'], 'miro_orange'), P('Opportunités', 'Ce que le marché nous offre.', ['Nouvelle réglementation'], 'miro_blue'), P('Menaces', 'Ce qui peut nous nuire.', ['Concurrent à bas prix'], 'red')], { cols: 2 });
  }, { recommande: true }),
  spec('lean-canvas', 'Lean canvas', STRAT, 'Expliciter les hypothèses d’un projet sur une seule page.', ['Vision'], b => {
    b.title('Lean canvas'); b.hint('Remplissez dans l’ordre : problème, clients, valeur, solution, puis le reste.');
    b.panels([P('Problème', 'Les trois principaux.', ['Suivi dispersé'], 'red'), P('Solution', 'La réponse minimale.', ['Tableau unique'], 'light_green'), P('Proposition de valeur', 'En une phrase.', ['Tout voir au même endroit'], 'violet'), P('Segments clients', 'Les premiers.', ['Petites agences'], 'miro_blue'), P('Canaux', 'Comment les atteindre.', ['Réseaux professionnels'], 'cyan'), P('Revenus', 'Modèle de prix.', ['Abonnement mensuel'], 'light_yellow'), P('Coûts', 'Fixes et variables.', ['Hébergement, support'], 'miro_orange'), P('Indicateurs', 'Les chiffres à suivre.', ['Tableaux actifs'], 'light_blue'), P('Avantage', 'Ce qui ne se copie pas.', ['Accessibilité native'], 'light_pink')], { perRow: 1, note: 150 });
  }),
  spec('business-model-canvas', 'Business Model Canvas', STRAT, 'Décrire comment une activité crée, délivre et capte de la valeur.', ['Vision'], b => {
    b.title('Business Model Canvas'); b.hint('Neuf blocs à compléter avec des hypothèses à vérifier.');
    b.panels([P('Partenaires', 'Qui nous aide ?', ['Hébergeur'], 'cyan'), P('Activités clés', 'Que faut-il faire ?', ['Développement'], 'light_blue'), P('Ressources clés', 'De quoi avons-nous besoin ?', ['Équipe technique'], 'miro_blue'), P('Propositions de valeur', 'Quelle promesse ?', ['Collaboration accessible'], 'violet'), P('Relations clients', 'Quel lien ?', ['Support humain'], 'light_pink'), P('Canaux', 'Par où ?', ['Site et partenaires'], 'miro_pink'), P('Segments clients', 'Pour qui ?', ['Écoles, administrations'], 'miro_orange'), P('Structure de coûts', 'Quels coûts ?', ['Salaires, serveurs'], 'red'), P('Sources de revenus', 'Qui paie quoi ?', ['Licences annuelles'], 'light_green')], { perRow: 1, note: 150 });
  }, { recommande: true }),
  spec('cadrage-produit', 'Cadrage produit', STRAT, 'Aligner l’équipe sur le problème, la cible, le périmètre et le succès.', ['Vision'], b => {
    b.title('Cadrage produit'); b.hint('Une page pour dire pourquoi, pour qui, quoi et quoi pas.');
    b.panels([P('Problème', 'Quel problème, pour qui ?', ['Les équipes perdent leurs comptes rendus'], 'red'), P('Cible', 'Les premiers utilisateurs.', ['Équipes de 5 à 20'], 'miro_blue'), P('Périmètre', 'Inclus dans la première version.', ['Recherche, partage'], 'light_green'), P('Hors périmètre', 'Exclu pour l’instant.', ['Application mobile'], 'miro_gray'), P('Indicateurs de succès', 'Comment le mesurer.', ['60 % d’usage hebdomadaire'], 'violet'), P('Questions ouvertes', 'À trancher.', ['Quel modèle de prix ?'], 'miro_yellow')]);
  }, { recommande: true }),
  spec('recueil-besoins', 'Recueil des besoins', STRAT, 'Recenser les besoins et les classer avant de décider.', ['Vision', 'Analyse'], b => {
    b.title('Recueil des besoins'); b.hint('Classez chaque besoin : indispensable, important, souhaitable, exclu (méthode MoSCoW).');
    b.panels([P('Indispensable', 'Sans cela, pas de produit.', ['Connexion sécurisée', 'Export PDF'], 'red'), P('Important', 'Attendu, mais contournable.', ['Filtres avancés'], 'miro_orange'), P('Souhaitable', 'Si le temps le permet.', ['Thème personnalisé'], 'miro_yellow'), P('Exclu', 'Pas dans cette version.', ['Messagerie interne'], 'miro_gray')], { cols: 4, perRow: 1, note: 160 });
  }),
  spec('pestel', 'PESTEL', STRAT, 'Analyser l’environnement : politique, économique, social, technologique, écologique, légal.', ['Analyse'], b => {
    b.title('PESTEL'); b.hint('Un post-it par facteur qui pourrait influencer le projet.');
    b.panels([P('Politique', 'Décisions publiques.', ['Aides aux PME'], 'miro_blue'), P('Économique', 'Conjoncture.', ['Hausse des taux'], 'light_green'), P('Social', 'Usages.', ['Télétravail durable'], 'light_pink'), P('Technologique', 'Innovations.', ['Assistants de rédaction'], 'violet'), P('Écologique', 'Environnement.', ['Bilan carbone exigé'], 'dark_green'), P('Légal', 'Règles.', ['RGAA, RGPD'], 'miro_orange')]);
  }),
  spec('parties-prenantes', 'Carte des parties prenantes', STRAT, 'Identifier qui influence le projet et comment l’associer.', ['Analyse'], b => {
    b.title('Carte des parties prenantes'); b.hint('Placez chaque personne selon son pouvoir et son intérêt.');
    b.panels([P('Fort pouvoir, fort intérêt', 'À impliquer de près.', ['Direction produit'], 'red'), P('Fort pouvoir, faible intérêt', 'À tenir satisfaits.', ['Direction financière'], 'miro_orange'), P('Faible pouvoir, fort intérêt', 'À tenir informés.', ['Équipe support'], 'miro_blue'), P('Faible pouvoir, faible intérêt', 'À surveiller.', ['Fournisseurs'], 'miro_gray')], { cols: 2 });
  }),

  /* Diagrammes et cartographie */
  spec('diagramme-flux', 'Diagramme de flux', DIAG, 'Relier les étapes et les décisions d’un processus.', ['Processus'], b => {
    b.title('Traitement d’une demande');
    const a = b.box('Demande reçue', 60, 130, 160, 80, 'circle'), c = b.box('Analyser', 300, 130), d = b.box('Complète ?', 540, 115, 170, 110, 'diamond'), e = b.box('Traiter', 800, 130), f = b.box('Demander les pièces', 540, 310), g = b.box('Clore', 1040, 130, 140, 80, 'circle');
    b.line(a, c); b.line(c, d); b.line(d, e, { label: 'Oui' }); b.line(d, f, { label: 'Non' }); b.line(e, g); b.line(f, c, { lineType: 'orthogonal' });
  }, { recommande: true, format: 'Diagrammes' }),
  spec('carte-mentale', 'Carte mentale', DIAG, 'Organiser les idées autour d’un sujet central.', ['Idées'], b => {
    b.mind('Lancement du site', [['Contenu', ['Textes', 'Photos']], ['Technique', ['Hébergement', 'Accessibilité']], ['Communication', ['Réseaux', 'Lettre d’information']]]);
  }, { recommande: true, format: 'Cartes mentales' }),
  spec('value-stream-mapping', 'Value Stream Mapping', DIAG, 'Visualiser un flux de bout en bout et repérer les attentes inutiles.', ['Processus'], b => {
    b.title('Value Stream Mapping'); b.hint('Notez le temps de travail et le temps d’attente de chaque étape, puis attaquez les plus longues attentes.');
    const steps = [['Commande', '5 min', '2 h'], ['Validation', '15 min', '1 jour'], ['Préparation', '1 h', '3 h'], ['Expédition', '20 min', '4 h']];
    let prev = null;
    steps.forEach(([t, work, wait], i) => {
      const x = 60 + i * 280;
      const box = b.box(t, x, 150, 180, 80);
      b.add('text', x, 240, { content: `Travail : ${work}`, width: 180, height: 24, fontSize: 14 });
      b.box('Stock', x + 195, 165, 60, 60, 'triangle');
      b.add('text', x + 170, 240, { content: `Attente : ${wait}`, width: 110, height: 44, fontSize: 14 });
      if (prev) b.line(prev, box);
      prev = box;
    });
    b.note('Goulet : validation par une seule personne', 340, 320, 'red', null, 150);
    b.line({ x: 60, y: 300 }, { x: 1200, y: 300 }, { endCap: 'arrow_open', label: 'Délai total : 1 jour et 10 h' });
  }, { recommande: true }),
  spec('frise-chronologique', 'Frise chronologique', DIAG, 'Situer des jalons et des événements dans le temps.', ['Processus'], b => {
    b.title('Frise chronologique'); b.hint('Glissez les jalons le long de l’axe et remplacez les dates.');
    b.line({ x: 60, y: 320 }, { x: 1240, y: 320 }, { strokeWidth: 4, endCap: 'arrow_filled' });
    [['Janvier', 'Cadrage'], ['Mars', 'Maquettes'], ['Juin', 'Bêta privée'], ['Septembre', 'Lancement']].forEach(([month, text], i) => {
      const x = 120 + i * 280;
      b.box(month, x, 290, 120, 60, 'rectangle');
      b.note(text, x - 5, i % 2 ? 370 : 140, ['light_green', 'miro_blue', 'miro_yellow', 'light_pink'][i]);
    });
  }, { recommande: true, format: 'Diagrammes' }),
  spec('organigramme-equipe', 'Organigramme d’équipe', DIAG, 'Montrer les rôles et les rattachements d’une équipe.', ['Organisation'], b => {
    b.title('Organigramme d’équipe');
    const top = b.box('Direction : Claire', 480, 100, 200, 70);
    ['Produit : Hugo', 'Technique : Amina', 'Support : Yanis'].forEach((t, i) => {
      const m = b.box(t, 150 + i * 330, 230, 200, 70);
      b.line(top, m, { lineType: 'orthogonal', endCap: 'none' });
      const n = b.box(['Design : Léa', 'Développement : Tom', 'Accueil : Nora'][i], 150 + i * 330, 360, 200, 70);
      b.line(m, n, { lineType: 'orthogonal', endCap: 'none' });
    });
  }, { recommande: true }),
  spec('cinq-pourquoi', 'Les 5 pourquoi', DIAG, 'Remonter à la cause profonde d’un problème.', ['Analyse', 'Processus'], b => {
    b.title('Les 5 pourquoi'); b.hint('Partez du problème observé et demandez « pourquoi ? » jusqu’à une cause sur laquelle agir.');
    let prev = b.note('Problème : la livraison a pris une semaine de retard', 40, 130, 'red', null, 150);
    ['La recette a commencé tard', 'Le serveur n’était pas prêt', 'La demande est partie trop tard', 'Personne n’en était responsable', 'Cause : pas de liste de préparation'].forEach((t, i) => {
      const n = b.note(t, 240 + i * 200, 130, i === 4 ? 'light_green' : 'light_yellow', null, 150);
      b.line(prev, n, { label: 'Pourquoi ?' });
      prev = n;
    });
  }),
  spec('ishikawa', 'Diagramme d’Ishikawa', DIAG, 'Classer les causes possibles d’un problème par familles.', ['Analyse'], b => {
    b.title('Diagramme d’Ishikawa'); b.hint('Le problème à droite, les causes sur les arêtes : méthodes, moyens, personnes, milieu.');
    const head = b.box('Trop de retours produits', 960, 280, 220, 100, 'rectangle');
    b.line({ x: 60, y: 330 }, head, { strokeWidth: 4 });
    ['Méthodes', 'Moyens', 'Personnes', 'Milieu'].forEach((t, i) => {
      const up = i % 2 === 0, x = 200 + Math.floor(i / 2) * 340;
      b.line({ x, y: up ? 150 : 510 }, { x: x + 110, y: 330 }, { endCap: 'none' });
      b.box(t, x - 80, up ? 110 : 510, 160, 50);
      b.note(['Contrôle trop tardif', 'Emballage fragile', 'Formation insuffisante', 'Humidité en entrepôt'][i], x + 40, up ? 170 : 370, 'light_yellow', null, 110);
    });
  }),
  spec('matrice-raci', 'Matrice RACI', DIAG, 'Clarifier qui réalise, qui décide, qui est consulté et informé.', ['Organisation'], b => {
    b.title('Matrice RACI'); b.hint('R : réalise. A : décide. C : consulté. I : informé. Un seul A par ligne.');
    b.add('datatable', 40, 120, { content: 'Responsabilités', rows: [['Tâche', 'Claire', 'Hugo', 'Amina'], ['Cahier des charges', 'A', 'R', 'C'], ['Développement', 'I', 'C', 'R'], ['Mise en production', 'A', 'I', 'R']] });
  }, { format: 'Tableaux' }),

  /* Présentations */
  spec('presentation', 'Présentation', PRES, 'Une présentation complète en cadres, prête pour le mode Présenter.', ['Diapositives'], b => {
    b.slide('Titre', 40, 40, 'Titre de la présentation', ['Sous-titre', 'Nom, date']);
    b.slide('Contexte', 880, 40, 'Pourquoi en parler aujourd’hui', ['Le constat en une phrase', 'Un chiffre marquant', 'Ce qui change'], 'Remplacez par votre chiffre clé');
    b.slide('Proposition', 40, 530, 'Notre proposition', ['Ce que nous proposons', 'Pour qui', 'Avec quels moyens']);
    b.slide('Résultats', 880, 530, 'Résultats attendus', ['Objectif à 3 mois', 'Objectif à 12 mois']);
    b.slide('Décision', 40, 1020, 'Ce que nous vous demandons', ['Décision attendue', 'Prochaine étape', 'Questions']);
  }, { recommande: true }),
  spec('presentation-simple', 'Présentation simple', PRES, 'Trois diapositives pour un message court.', ['Diapositives'], b => {
    b.slide('Message', 40, 40, 'Le message en une phrase', ['Dites-le dès la première diapositive']);
    b.slide('Preuves', 880, 40, 'Trois raisons d’y croire', ['Un fait', 'Un exemple', 'Un témoignage']);
    b.slide('Suite', 40, 530, 'Et maintenant ?', ['Ce que vous attendez du public']);
  }, { recommande: true }),
  spec('compte-rendu-projet', 'Bilan de trimestre', PRES, 'Présenter les résultats, les enseignements et le cap suivant.', ['Synthèse', 'Diapositives'], b => {
    b.slide('Bilan', 40, 40, 'Le trimestre en bref', ['Trois résultats', 'Un chiffre à retenir']);
    b.slide('Enseignements', 880, 40, 'Ce que nous avons appris', ['Ce qui a marché', 'Ce qui a moins marché']);
    b.slide('Cap', 40, 530, 'Le prochain trimestre', ['Objectif principal', 'Moyens nécessaires']);
  }),

  /* Wireframes et prototypes */
  spec('wireframe-site', 'Wireframe de site', WIRE, 'Une page d’accueil en blocs, à adapter avant de passer à la maquette.', ['Site'], b => {
    const f = b.frame('Ordinateur : accueil', 40, 40, 1100, 760);
    b.box('Logo', 60, 60, 120, 50, 'rectangle', f);
    ['Accueil', 'Offres', 'Contact'].forEach((t, i) => b.box(t, 760 + i * 120, 60, 110, 50, 'rectangle', f));
    b.box('Grand titre et image', 60, 130, 1060, 260, 'rectangle', f);
    b.box('Bouton principal', 480, 410, 220, 60, 'rectangle', f);
    ['Avantage 1', 'Avantage 2', 'Avantage 3'].forEach((t, i) => b.box(t, 60 + i * 360, 500, 340, 180, 'rectangle', f));
    b.box('Pied de page', 60, 700, 1060, 70, 'rectangle', f);
    b.note('Le bouton doit se voir sans défiler', 1170, 400, 'light_yellow');
  }, { recommande: true }),
  spec('wireframe-mobile', 'Wireframe mobile', WIRE, 'Un parcours en trois écrans de téléphone reliés par des flèches.', ['Mobile'], b => {
    const screens = [['Écran 1 : connexion', ['Logo', 'Courriel', 'Mot de passe', 'Se connecter']], ['Écran 2 : liste', ['Recherche', 'Élément 1', 'Élément 2', 'Élément 3']], ['Écran 3 : détail', ['Image', 'Description', 'Prix', 'Acheter']]];
    const frames = screens.map(([name, blocks], i) => {
      const x = 40 + i * 380;
      const f = b.frame(name, x, 40, 300, 560);
      blocks.forEach((t, k) => b.box(t, x + 20, 70 + k * 125, 260, 105, 'rectangle', f));
      return f;
    });
    b.line(frames[0], frames[1], { label: 'Valider' });
    b.line(frames[1], frames[2], { label: 'Toucher' });
  }, { recommande: true }),
  spec('wireframe-formulaire', 'Wireframe de formulaire', WIRE, 'Un formulaire accessible : libellés, aide, erreurs et bouton.', ['Site', 'Composants'], b => {
    const f = b.frame('Formulaire d’inscription', 40, 40, 620, 620);
    ['Nom (obligatoire)', 'Courriel (obligatoire)', 'Message d’erreur : courriel invalide', 'Mot de passe', 'Créer le compte'].forEach((t, i) => b.box(t, 70, 70 + i * 110, 560, 80, 'rectangle', f));
    b.note('Chaque champ a un libellé visible', 700, 90, 'light_yellow');
    b.note('L’erreur dit comment corriger', 700, 250, 'red');
  }),

  /* Formats */
  spec('format-tableau', 'Tableau de suivi', STRAT, 'Un tableau de données prêt à remplir pour suivre des actions.', ['Objectifs'], b => {
    b.add('datatable', 40, 40, { content: 'Suivi des actions', rows: [['Action', 'Responsable', 'Échéance', 'État'], ['Préparer le budget', 'Claire', '12 mars', 'En cours'], ['Valider le devis', 'Hugo', '20 mars', 'À faire']] });
  }, { format: 'Tableaux' }),
  spec('format-code', 'Note technique', DIAG, 'Documenter une API avec un exemple de code et des cartes.', ['Processus'], b => {
    b.add('code', 40, 40, { content: 'GET /api/commandes/42\nAuthorization: Bearer <jeton>\n\n200 OK\n{ "statut": "expédiée" }', language: 'text', width: 420, height: 200 });
    b.card('Prérequis', 'Un jeton d’accès valide', 500, 40); b.card('Erreurs', '401 si jeton absent, 404 si commande inconnue', 500, 180);
    b.add('flipcard', 40, 270, { content: 'Que renvoie l’API si la commande n’existe pas ?', back: 'Le code 404', width: 300, height: 130 });
  }, { format: 'Code et cartes' })
];
