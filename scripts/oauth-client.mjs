// Registers the apps that may ask visitors for their public work profile (OAuth clients). There is no admin page:
// a client is one row in D1, written with this script.
// npm run oauth:client -- add --name "PA Cafe" --redirect https://example.com/callback [--redirect …] [--public] [--local]
// npm run oauth:client -- list [--local]
// npm run oauth:client -- remove <client_id> [--local]
// Without --local it writes to the production D1. A client gets a secret unless --public is given; the secret is
// printed once and only its hash is stored. Removing a client also ends every authorization it holds.
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';

const [command, ...args] = process.argv.slice(2);
const local = args.includes('--local');
const values = (flag) => args.flatMap((arg, i) => arg === flag ? [args[i + 1]] : []);
const fail = (message) => { console.error(message); process.exit(1); };
function run(sql) {
  const target = local ? ['--local', '--persist-to', '.wrangler/state'] : ['--remote'];
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', ...target, '--config', 'wrangler.jsonc', '--json', '--command', sql], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
  return JSON.parse(out)[0].results;
}
// The same rule the server applies: https, or http on the visitor's own machine for local development.
function validRedirect(value) {
  try { const url = new URL(value); return !url.hash && !url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)); } catch { return false; }
}
const quote = (text) => "'" + text.replaceAll("'", "''") + "'";

if (command === 'add') {
  const [name] = values('--name'), redirects = values('--redirect');
  if (!name || name.length > 40) fail('--name is required (40 characters at most); it is shown to visitors on the consent page');
  if (!redirects.length || !redirects.every((uri) => uri && validRedirect(uri))) fail('--redirect needs at least one https:// address (http:// only for localhost); it must match the app\'s redirect_uri exactly');
  const id = 'urai_' + randomBytes(12).toString('hex');
  const secret = args.includes('--public') ? null : randomBytes(32).toString('hex');
  const hash = secret ? quote(createHash('sha256').update(secret).digest('hex')) : 'NULL';
  run(`INSERT INTO oauth_clients (id,name,redirect_uris,secret_hash,created_at) VALUES (${quote(id)},${quote(name)},${quote(JSON.stringify(redirects))},${hash},${Date.now()})`);
  console.log(`Registered on the ${local ? 'local' : 'production'} database.\n  client_id      ${id}\n  client_secret  ${secret ?? '(none: public client, PKCE only)'}\n  redirect_uris  ${redirects.join(', ')}`);
  if (secret) console.log('Store the secret now. Only its hash is kept, so it cannot be shown again.');
} else if (command === 'list') {
  for (const row of run('SELECT c.id, c.name, c.redirect_uris, c.secret_hash IS NOT NULL AS confidential, (SELECT count(*) FROM oauth_grants g WHERE g.client_id = c.id AND g.refresh_hash IS NOT NULL) AS grants FROM oauth_clients c ORDER BY c.created_at'))
    console.log(`${row.id}  ${row.name}  ${row.confidential ? 'confidential' : 'public'}  authorizations: ${row.grants}  ${JSON.parse(row.redirect_uris).join(', ')}`);
} else if (command === 'remove') {
  const id = args.find((arg) => /^urai_[0-9a-f]{24}$/.test(arg));
  if (!id) fail('Give the client_id to remove');
  run(`DELETE FROM oauth_grants WHERE client_id = ${quote(id)}; DELETE FROM oauth_clients WHERE id = ${quote(id)}`);
  console.log('Removed ' + id + ' and its authorizations.');
} else fail('Usage: npm run oauth:client -- add --name <name> --redirect <uri> [--public] [--local] | list [--local] | remove <client_id> [--local]');
