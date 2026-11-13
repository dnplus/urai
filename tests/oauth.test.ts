import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {handleSession} from '../lib/session-service.ts';
import {handleRemembered} from '../lib/remembered-service.ts';
import {createPublicCard, revokePublicCard, loadPublicCard, CARD_TTL_MS} from '../lib/public-card-service.ts';
import {handleConsent, handleToken, handleRevoke, handleProfile, checkAuthorizeRequest, oauthMetadata, validRedirectUri, ACCESS_TTL_MS, CODE_TTL_MS} from '../lib/oauth-service.ts';
import {teamSnapshot} from '../lib/team-service.ts';
import {toReport} from '../lib/assessment.ts';
import {makeLevelFixture} from '../lib/fixture.ts';

let mf: Miniflare; let db: D1Database; let directory: string;
const now = Date.parse('2026-10-10T12:00:00Z');
const origin = 'http://127.0.0.1:5188';
const client = {id: 'pa-cafe-test', name: 'PA Cafe', redirect: 'https://cafe.example/oauth/urai/callback'};
const confidential = {id: 'server-app', name: 'Server App', redirect: 'https://server.example/cb', secret: 's'.repeat(64)};
const look = {family: 'grok', style: 'chibi', nicknameOnly: false, locale: 'zh-TW'};
const sha256 = (value: string) => createHash('sha256').update(value).digest();
const verifier = 'v'.repeat(64), challenge = sha256(verifier).toString('base64url');
type Session = {id: string; readToken: string; writeToken: string; nickname: string};
type Created = {id: string; url: string; revokeToken: string; profile: boolean};
type Tokens = {access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string};
type Owner = {session: Session; cookie: string; card: Created};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-mbti-oauth-'));
  mf = new Miniflare({modules: true, script: 'export default {fetch(){return new Response("test")}}', d1Databases: {DB: 'oauth-test'}, d1Persist: directory, compatibilityDate: '2026-05-15', cf: false});
  db = await mf.getD1Database('DB') as unknown as D1Database;
  for (const migration of (await readdir(new URL('../drizzle/', import.meta.url))).filter((p) => p.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL('../drizzle/' + migration, import.meta.url), 'utf8');
    for (const q of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.prepare(q).run();
  }
  const insert = 'INSERT INTO oauth_clients (id,name,redirect_uris,secret_hash,created_at) VALUES (?1,?2,?3,?4,?5)';
  await db.prepare(insert).bind(client.id, client.name, JSON.stringify([client.redirect]), null, now).run();
  await db.prepare(insert).bind(confidential.id, confidential.name, JSON.stringify([confidential.redirect]), sha256(confidential.secret).toString('hex'), now).run();
});
after(async () => { await mf.dispose(); await rm(directory, {recursive: true, force: true}); });

function request(path: string, method: string, payload?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + path, {method, headers: {'content-type': 'application/json', origin, ...headers}, ...(payload === undefined ? {} : {body: JSON.stringify(payload)})});
}
const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => new Request(origin + path, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded', ...headers}, body: new URLSearchParams(fields)});
const cookiesOf = (response: Response) => response.headers.getSetCookie().map((c) => c.split(';')[0]);

// A visitor who finished an observation in this browser: the remembered-result cookie is what identifies them, there is no account.
async function owner(nickname: string, includeProfile: boolean | null = true, kind: 'observed' | 'fixture' = 'observed'): Promise<Owner> {
  const session = await (await handleSession(db, request('/api/sessions', 'POST', {nickname, protocolVersion: '3.0'}), undefined, 'session', now)).json() as Session;
  const sent = await handleSession(db, request(`/api/collect/${session.id}`, 'POST', {...makeLevelFixture(nickname), kind}, {authorization: `Bearer ${session.writeToken}`, 'idempotency-key': 'oauth-test-key-' + session.id.slice(0, 8)}), session.id, 'collect', now);
  assert.equal(sent.status, 201);
  const cookie = cookiesOf(await handleRemembered(db, request('/api/remembered', 'POST', {sessionId: session.id, readToken: session.readToken}), now))[0];
  const made = kind === 'observed' && includeProfile !== null ? await (await createPublicCard(db, request('/api/remembered/card', 'POST', {...look, includeProfile}, {cookie}), now)).json() as Created : {id: '', url: '', revokeToken: '', profile: false};
  return {session, cookie, card: made};
}
const authorizeParams = (app = client, extra: Record<string, string> = {}) => ({client_id: app.id, redirect_uri: app.redirect, response_type: 'code', scope: 'profile.read', state: 'xyz-state', code_challenge: challenge, code_challenge_method: 'S256', ...extra});
const consent = (cookie: string, body: Record<string, unknown> = authorizeParams(), at = now) => handleConsent(db, request('/api/remembered/oauth', 'POST', body, {cookie}), at);
async function approve(who: Owner, app = client, at = now) {
  const response = await consent(who.cookie, authorizeParams(app), at);
  assert.equal(response.status, 201);
  const back = new URL((await response.json() as {redirect: string}).redirect);
  return {code: back.searchParams.get('code')!, back, manage: cookiesOf(response)[0]};
}
const exchange = (code: string, fields: Record<string, string> = {}, at = now, app = client) => handleToken(db, form('/oauth/token', {grant_type: 'authorization_code', code, redirect_uri: app.redirect, client_id: app.id, code_verifier: verifier, ...fields}), at);
const refresh = (token: string, at = now, app = client) => handleToken(db, form('/oauth/token', {grant_type: 'refresh_token', refresh_token: token, client_id: app.id}), at);
const profile = (token: string, at = now) => handleProfile(db, new Request(origin + '/api/me/profile', {headers: {authorization: 'Bearer ' + token}}), at);
async function authorized(nickname: string) {
  const who = await owner(nickname), {code, manage} = await approve(who);
  const tokens = await (await exchange(code)).json() as Tokens;
  return {who, tokens, manage};
}

test('the profile snapshot is private by default and carries only the team-board numbers once published', async () => {
  const who = await owner('小克', false);
  assert.equal(who.card.profile, false);
  assert.equal((await loadPublicCard(db, who.card.id, now))!.profile, null);
  const published = await (await createPublicCard(db, request('/api/remembered/card', 'POST', {...look, includeProfile: true}, {cookie: who.cookie}), now)).json() as Created;
  assert.deepEqual([published.id, published.profile], [who.card.id, true]);
  const shown = (await loadPublicCard(db, who.card.id, now))!.profile!;
  const board = teamSnapshot(toReport({...makeLevelFixture('小克'), kind: 'observed'}));
  assert.deepEqual(shown, {observedPeriod: board.observedPeriod, scope: board.scope, modelFamily: board.modelFamily, client: board.client, stats: board.stats});
  assert.equal(/T00\d|tasks|"date"|context/.test(JSON.stringify(shown)), false);
  // A caller that does not mention the snapshot (an older tab, the compare flow) leaves it as it was; an explicit false removes it.
  const kept = await (await createPublicCard(db, request('/api/remembered/card', 'POST', look, {cookie: who.cookie}), now)).json() as Created;
  assert.equal(kept.profile, true);
  const removed = await (await createPublicCard(db, request('/api/remembered/card', 'POST', {...look, includeProfile: false}, {cookie: who.cookie}), now)).json() as Created;
  assert.equal(removed.profile, false);
  assert.equal((await db.prepare('SELECT profile FROM public_cards WHERE id=?1').bind(who.card.id).first<{profile: string | null}>())!.profile, null);
});

test('discovery and the authorization request: only registered clients and exact redirect URIs, code flow with PKCE S256 only', async () => {
  const meta = oauthMetadata('https://urai.dnplus.dev');
  assert.deepEqual([meta.issuer, meta.authorization_endpoint, meta.token_endpoint, meta.revocation_endpoint], ['https://urai.dnplus.dev', 'https://urai.dnplus.dev/oauth/authorize', 'https://urai.dnplus.dev/oauth/token', 'https://urai.dnplus.dev/oauth/revoke']);
  assert.deepEqual([meta.code_challenge_methods_supported, meta.response_types_supported, meta.scopes_supported], [['S256'], ['code'], ['profile.read']]);
  const check = (extra: Record<string, string | undefined>) => checkAuthorizeRequest(db, {...authorizeParams(), ...extra}, origin);
  assert.equal((await check({})).kind, 'ok');
  // An unknown client or a redirect address that is not registered never gets the visitor sent to it.
  assert.deepEqual(await check({client_id: 'nobody'}), {kind: 'invalid', reason: 'client'});
  assert.deepEqual(await check({redirect_uri: client.redirect + '/extra'}), {kind: 'invalid', reason: 'redirect_uri'});
  assert.deepEqual(await check({redirect_uri: undefined}), {kind: 'invalid', reason: 'redirect_uri'});
  const errorOf = async (extra: Record<string, string | undefined>) => { const r = await check(extra); assert.equal(r.kind, 'redirect'); const url = new URL((r as {url: string}).url); assert.ok(url.href.startsWith(client.redirect + '?')); assert.equal(url.searchParams.get('state'), 'xyz-state'); return url.searchParams.get('error'); };
  assert.equal(await errorOf({response_type: 'token'}), 'unsupported_response_type');
  assert.equal(await errorOf({scope: 'profile.read report.read'}), 'invalid_scope');
  assert.equal(await errorOf({code_challenge_method: 'plain'}), 'invalid_request');
  assert.equal(await errorOf({code_challenge: undefined}), 'invalid_request');
  for (const [uri, ok] of [['https://cafe.example/cb', true], ['http://127.0.0.1:8787/cb', true], ['http://cafe.example/cb', false], ['https://cafe.example/cb#frag', false], ['javascript:alert(1)', false], ['not a url', false]] as const) assert.equal(validRedirectUri(uri), ok, uri);
});

test('authorizing: the visitor approves, the app trades the code with its PKCE verifier, and /api/me/profile returns the snapshot, its date and the /c/<id> page', async () => {
  const who = await owner('Nova');
  const {code, back} = await approve(who);
  assert.ok(back.href.startsWith(client.redirect + '?'));
  assert.deepEqual([back.searchParams.get('state'), back.searchParams.get('iss')], ['xyz-state', origin]);
  assert.match(code, /^[0-9a-f]{64}$/);
  // The code is useless without the verifier, at another redirect address, for another client, or after it expires.
  assert.deepEqual([(await exchange(code, {code_verifier: 'w'.repeat(64)})).status, (await exchange(code, {code_verifier: ''})).status], [400, 400]);
  assert.equal((await exchange(code, {redirect_uri: 'https://cafe.example/other'})).status, 400);
  assert.equal((await exchange(code, {client_id: confidential.id, client_secret: confidential.secret})).status, 400);
  assert.equal((await exchange(code, {}, now + CODE_TTL_MS + 1)).status, 400);
  const issued = await exchange(code);
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get('cache-control'), 'no-store');
  const tokens = await issued.json() as Tokens;
  assert.deepEqual([tokens.token_type, tokens.expires_in, tokens.scope], ['Bearer', ACCESS_TTL_MS / 1000, 'profile.read']);
  // A code works once.
  const again = await exchange(code);
  assert.deepEqual([again.status, (await again.json() as {error: string}).error], [400, 'invalid_grant']);

  const response = await profile(tokens.access_token);
  assert.equal(response.status, 200);
  const body = await response.json() as {id: string; url: string; generatedAt: string; expiresAt: string; nickname: string; card: {type: string; pattern: string; rarity: string} | null; snapshot: {stats: {sessions: number}; observedPeriod: {from: string}}};
  const report = toReport({...makeLevelFixture('Nova'), kind: 'observed'});
  assert.deepEqual([body.id, body.url, body.generatedAt, body.expiresAt], [who.card.id, `${origin}/c/${who.card.id}`, new Date(now).toISOString(), new Date(now + CARD_TTL_MS).toISOString()]);
  assert.deepEqual([body.nickname, body.card!.type, body.card!.pattern, body.card!.rarity], ['Nova', report.assessment.type, report.assessment.pattern, 'epic']);
  assert.deepEqual(body.snapshot, (await loadPublicCard(db, who.card.id, now))!.profile);
  assert.equal(body.snapshot.stats.sessions, 40);
  // Nothing private rides along: no tasks, no session id, no tokens, no report text.
  const text = JSON.stringify(body);
  for (const secret of [who.session.id, who.session.readToken, 'tasks', 'T001', 'caveat', 'usageEvidence', 'email']) assert.equal(text.includes(secret), false, secret);
  // Stored tokens are hashes only.
  const stored = JSON.stringify(await db.prepare('SELECT * FROM oauth_grants').all());
  for (const secret of [tokens.access_token, tokens.refresh_token, code]) assert.equal(stored.includes(secret), false);
});

test('the browser side: no result, a private snapshot or a demo cannot be authorized; an explicit publish creates the card', async () => {
  assert.equal((await consent('')).status, 404);
  const foreign = await handleConsent(db, request('/api/remembered/oauth', 'POST', authorizeParams(), {origin: 'https://evil.example'}), now);
  assert.equal(foreign.status, 403);
  const hidden = await owner('Rex', false);
  const refused = await consent(hidden.cookie);
  assert.deepEqual([refused.status, (await refused.json() as {code: string}).code], [409, 'profile_private']);
  assert.equal((await consent(hidden.cookie, {...authorizeParams(), redirect_uri: 'https://evil.example/cb'})).status, 400);
  assert.equal((await consent(hidden.cookie, {...authorizeParams(), code_challenge_method: 'plain'})).status, 400);
  // Saying yes to publishing on the consent page turns the snapshot on and keeps the card's address and look.
  assert.equal((await consent(hidden.cookie, {...authorizeParams(), publish: true})).status, 201);
  const card = (await loadPublicCard(db, hidden.card.id, now))!;
  assert.deepEqual([card.profile !== null, card.family, card.style], [true, 'grok', 'chibi']);

  const fresh = await owner('Kai', null);
  const state = await (await handleConsent(db, request('/api/remembered/oauth', 'GET', undefined, {cookie: fresh.cookie}), now)).json() as {result: {nickname: string; shareable: boolean; card: unknown; snapshot: {stats: {sessions: number}}}; grants: unknown[]};
  assert.deepEqual([state.result.nickname, state.result.shareable, state.result.card, state.result.snapshot.stats.sessions, state.grants], ['Kai', true, null, 40, []]);
  const made = await consent(fresh.cookie, {...authorizeParams(), publish: true, locale: 'en'});
  assert.equal(made.status, 201);
  const row = await db.prepare('SELECT id,card,profile FROM public_cards WHERE session_id=?1').bind(fresh.session.id).first<{id: string; card: string; profile: string | null}>();
  assert.ok(row!.profile);
  assert.deepEqual([JSON.parse(row!.card).locale, JSON.parse(row!.card).nicknameOnly], ['en', false]);

  const demo = await owner('示範', true, 'fixture');
  assert.equal((await consent(demo.cookie, {...authorizeParams(), publish: true})).status, 422);
});

test('revoking: the visitor can take an app back on urai, the app can revoke its own token, and either way the API answers 401', async () => {
  const {who, tokens, manage} = await authorized('Ada');
  assert.equal((await profile(tokens.access_token)).status, 200);
  const list = async (cookie: string) => (await (await handleConsent(db, request('/api/remembered/oauth', 'GET', undefined, {cookie}), now)).json() as {grants: {id: string; client: string}[]}).grants;
  const grants = await list(who.cookie);
  assert.deepEqual(grants.map((g) => g.client), ['PA Cafe']);
  // After the 7-day result cookie is gone, the long-lived management cookie still lists the grant; a stranger sees nothing and cannot revoke it.
  assert.deepEqual(await list(manage), grants);
  assert.deepEqual(await list(''), []);
  const revokeGrant = (cookie: string) => handleConsent(db, request('/api/remembered/oauth?grant=' + grants[0].id, 'DELETE', undefined, {cookie}), now);
  assert.equal((await revokeGrant('urai_oauth=' + 'a'.repeat(64))).status, 404);
  assert.equal((await profile(tokens.access_token)).status, 200);
  assert.equal((await revokeGrant(manage)).status, 200);
  const denied = await profile(tokens.access_token);
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate')!, /^Bearer .*error="invalid_token"/);
  assert.equal((await refresh(tokens.refresh_token)).status, 400);
  assert.deepEqual(await list(who.cookie), []);
  // The card itself is untouched: only the app lost access.
  assert.ok(await loadPublicCard(db, who.card.id, now));

  const second = await authorized('Bea');
  const revoked = await handleRevoke(db, form('/oauth/revoke', {token: second.tokens.refresh_token, client_id: client.id}));
  assert.equal(revoked.status, 200);
  assert.equal((await profile(second.tokens.access_token)).status, 401);
  // Revocation never reveals whether a token existed, and another client cannot revoke this one's tokens.
  assert.equal((await handleRevoke(db, form('/oauth/revoke', {token: 'f'.repeat(64), client_id: client.id}))).status, 200);
  const third = await authorized('Cy');
  await handleRevoke(db, form('/oauth/revoke', {token: third.tokens.access_token, client_id: confidential.id, client_secret: confidential.secret}));
  assert.equal((await profile(third.tokens.access_token)).status, 200);
});

test('token expiry: an access token stops after an hour with 401, the refresh token rotates, and replaying a spent one ends the authorization', async () => {
  const {tokens} = await authorized('Dee');
  assert.equal((await profile(tokens.access_token, now + ACCESS_TTL_MS - 1)).status, 200);
  const expired = await profile(tokens.access_token, now + ACCESS_TTL_MS);
  assert.equal(expired.status, 401);
  assert.match(expired.headers.get('www-authenticate')!, /expired/);
  const later = now + ACCESS_TTL_MS + 1000;
  const renewed = await (await refresh(tokens.refresh_token, later)).json() as Tokens;
  assert.notEqual(renewed.refresh_token, tokens.refresh_token);
  assert.equal((await profile(renewed.access_token, later)).status, 200);
  assert.equal((await profile(tokens.access_token, later)).status, 401);
  // The old refresh token was spent by the rotation; seeing it again revokes everything issued since.
  assert.equal((await refresh(tokens.refresh_token, later)).status, 400);
  assert.equal((await profile(renewed.access_token, later)).status, 401);
  assert.equal((await refresh(renewed.refresh_token, later)).status, 400);
  // Missing, malformed and unknown tokens are all 401.
  assert.equal((await handleProfile(db, new Request(origin + '/api/me/profile'), now)).status, 401);
  assert.equal((await handleProfile(db, new Request(origin + '/api/me/profile', {headers: {authorization: 'Bearer nope'}}), now)).status, 401);
  assert.equal((await profile('0'.repeat(64))).status, 401);
});

test('withdrawing or clearing the card ends access with 401; an expired card or a snapshot switched off answers 404', async () => {
  const withdrawn = await authorized('Eve');
  const gone = await revokePublicCard(db, request('/api/cards/' + withdrawn.who.card.id, 'DELETE', undefined, {authorization: `Bearer ${withdrawn.who.card.revokeToken}`}), withdrawn.who.card.id);
  assert.equal(gone.status, 200);
  assert.equal((await profile(withdrawn.tokens.access_token)).status, 401);
  assert.equal((await refresh(withdrawn.tokens.refresh_token)).status, 400);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM oauth_grants WHERE card_id=?1').bind(withdrawn.who.card.id).first<{n: number}>())!.n, 0);

  const cleared = await authorized('Fay');
  assert.equal((await handleRemembered(db, request('/api/remembered', 'DELETE', undefined, {cookie: cleared.who.cookie}), now)).status, 200);
  assert.equal(await loadPublicCard(db, cleared.who.card.id, now), null);
  assert.equal((await profile(cleared.tokens.access_token)).status, 401);

  const ended = await authorized('Gus');
  await handleSession(db, request('/api/sessions/' + ended.who.session.id, 'DELETE', undefined, {authorization: `Bearer ${ended.who.session.readToken}`}), ended.who.session.id, 'session', now);
  assert.equal((await profile(ended.tokens.access_token)).status, 401);

  // A card that reached its 365 days: the app held a fresh token, so the answer is 404, and the authorization is cleaned up with it.
  const old = await authorized('Hal');
  const end = now + CARD_TTL_MS;
  const fresh = await (await refresh(old.tokens.refresh_token, end - 1000)).json() as Tokens;
  const missing = await profile(fresh.access_token, end);
  assert.deepEqual([missing.status, (await missing.json() as {error: string}).error], [404, 'card_not_found']);
  assert.equal((await profile(fresh.access_token, end)).status, 401);
  assert.equal((await refresh(fresh.refresh_token, end)).status, 400);

  // Switching the snapshot off keeps the card and the authorization, but there is nothing to read until it is published again.
  const hidden = await authorized('Ivy');
  const off = await createPublicCard(db, request('/api/remembered/card', 'POST', {...look, includeProfile: false}, {cookie: hidden.who.cookie}), now);
  assert.equal(off.status, 201);
  const none = await profile(hidden.tokens.access_token);
  assert.deepEqual([none.status, (await none.json() as {error: string}).error], [404, 'profile_not_public']);
  await createPublicCard(db, request('/api/remembered/card', 'POST', {...look, includeProfile: true, nicknameOnly: true}, {cookie: hidden.who.cookie}), now);
  const back = await profile(hidden.tokens.access_token);
  assert.equal(back.status, 200);
  // A nickname-only card keeps its type and rarity off the API, as it does on the page.
  assert.equal((await back.json() as {card: unknown}).card, null);
});

test('a client registered with a secret must present it, by form field or HTTP Basic', async () => {
  const who = await owner('Jo');
  const first = await approve(who, confidential);
  const bare = await exchange(first.code, {}, now, confidential);
  assert.deepEqual([bare.status, (await bare.json() as {error: string}).error], [401, 'invalid_client']);
  assert.equal((await exchange(first.code, {client_secret: 'wrong'}, now, confidential)).status, 401);
  const tokens = await (await exchange(first.code, {client_secret: confidential.secret}, now, confidential)).json() as Tokens;
  assert.equal((await profile(tokens.access_token)).status, 200);
  const basic = 'Basic ' + Buffer.from(`${confidential.id}:${confidential.secret}`).toString('base64');
  const renewed = await handleToken(db, form('/oauth/token', {grant_type: 'refresh_token', refresh_token: tokens.refresh_token}, {authorization: basic}), now);
  assert.equal(renewed.status, 200);
  assert.equal((await handleToken(db, form('/oauth/token', {grant_type: 'password', client_id: client.id}), now)).status, 400);
  assert.equal((await handleToken(db, request('/oauth/token', 'POST', {grant_type: 'authorization_code'}), now)).status, 400);
});
