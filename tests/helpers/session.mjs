/*
 * Contexte de navigateur déjà connecté : l'application ne montre plus rien sans session.
 * Compte créé par l'API, comme à l'inscription : le cookie de session reste dans le contexte.
 */
let counter = 0;

export const TEST_PASSWORD = 'correct horse battery';

export function nextEmail() {
  return `s${process.pid}-${++counter}@exemple.test`;
}

export async function signedInContext(browser, app, options = {}, { displayName = 'Essai', email = nextEmail() } = {}) {
  // Une adresse vue par contexte : les limites de débit sont comptées par compte et par adresse.
  app.nextClient();
  const context = await browser.newContext(options);
  const res = await context.request.post(`${app.origin}/api/auth/register`, {
    headers: { Origin: app.origin, 'Content-Type': 'application/json' },
    data: { email, password: TEST_PASSWORD, displayName }
  });
  if (!res.ok()) throw new Error(`Compte de test refusé : ${res.status()} ${await res.text()}`);
  context.testEmail = email;
  return context;
}
