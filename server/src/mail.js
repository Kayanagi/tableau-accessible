import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';

const SENDMAIL_PATH = '/usr/sbin/sendmail';
const SEND_TIMEOUT = 30 * 1000;
const ADDRESS_MAX = 254;
const ENCODED_WORD_BYTES = 45;
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/* Renvoie l'adresse en ASCII, ou null. Plus strict que la validation d'inscription : Postfix lit un
   argument comme une liste d'adresses, donc « a,b@c.fr » viserait deux destinataires. */
export function safeAddress(value) {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return null;
  const local = value.slice(0, at);
  const domain = domainToASCII(value.slice(at + 1));
  if (!LOCAL_PART.test(local) || !DOMAIN.test(domain)) return null;
  const address = `${local}@${domain}`;
  return address.length <= ADDRESS_MAX ? address : null;
}

/* RFC 2047 : mots encodés d'au plus 75 caractères, sans couper un caractère UTF-8. */
export function encodeSubject(subject) {
  if (/[\u0000-\u001f\u007f]/.test(subject)) throw new Error('sujet invalide');
  const chunks = [];
  let chunk = '';
  for (const char of subject) {
    if (Buffer.byteLength(chunk + char) > ENCODED_WORD_BYTES) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  chunks.push(chunk);
  return chunks.map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\n ');
}

export function buildMessage({ from, to, subject, text, date, messageId }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${messageId}@${from.slice(from.indexOf('@') + 1)}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'Auto-Submitted: auto-generated'
  ];
  return `${headers.join('\n')}\n\n${text}`;
}

/* send() résout toujours : true si sendmail sort avec le code 0, c'est-à-dire si Postfix a pris le
   message en charge. Cela ne prouve pas sa distribution. Aucun shell : l'adresse reste un argument. */
export function createSendmail({ from, path = SENDMAIL_PATH, timeoutMs = SEND_TIMEOUT, now = Date.now }) {
  const sender = safeAddress(from);
  if (!sender) throw new Error('adresse d’expéditeur invalide');

  function send({ to, subject, text }) {
    const recipient = safeAddress(to);
    if (!recipient) return Promise.resolve(false);
    const message = buildMessage({ from: sender, to: recipient, subject, text, date: new Date(now()), messageId: randomBytes(16).toString('hex') });
    return new Promise(resolve => {
      let child;
      try {
        child = spawn(path, ['-i', '-f', sender, '--', recipient], { stdio: ['pipe', 'ignore', 'ignore'] });
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(false);
      }, timeoutMs);
      const finish = ok => {
        clearTimeout(timer);
        resolve(ok);
      };
      child.once('error', () => finish(false));
      child.once('close', code => finish(code === 0));
      // Un sendmail qui sort sans lire son entrée provoque EPIPE : le code de sortie tranche.
      child.stdin?.on('error', () => {});
      child.stdin?.end(message);
    });
  }

  return { send };
}
