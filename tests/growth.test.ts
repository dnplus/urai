import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import messages from '../lib/messages.json' with {type: 'json'};
import {handleSession} from '../lib/session-service.ts';
import {createPublicCard, loadPublicCard, compareTarget} from '../lib/public-card-service.ts';
import {compareAssessments, compareKinds, UNKNOWN_LINE} from '../lib/compare.ts';
import {decidedAssessment} from '../lib/assessment.ts';
import {badgeSvg, badgeColors} from '../lib/badge.ts';
import {badgeMarkdown, comparePost} from '../lib/share-kit.ts';
import {countStep, funnelSource, isCrawler} from '../lib/funnel.ts';
import {tagged} from '../lib/export-card.ts';
import {makeLevelFixture} from '../lib/fixture.ts';
import type {Assessment} from '../lib/contract.ts';

let mf: Miniflare; let db: D1Database; let directory: string;
const now = Date.parse('2026-10-10T12:00:00Z');
const origin = 'http://127.0.0.1:5188';
const dictionary = messages as Record<string, string[]>;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-partner-growth-'));
  mf = new Miniflare({modules: true, script: 'export default {fetch(){return new Response("test")}}', d1Databases: {DB: 'growth-test'}, d1Persist: directory, compatibilityDate: '2026-05-15', cf: false});
  db = await mf.getD1Database('DB') as unknown as D1Database;
  for (const migration of (await readdir(new URL('../drizzle/', import.meta.url))).filter((p) => p.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL('../drizzle/' + migration, import.meta.url), 'utf8');
    for (const q of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.prepare(q).run();
  }
});
after(async () => { await mf.dispose(); await rm(directory, {recursive: true, force: true}); });

const request = (path: string, method: string, payload?: unknown, headers: Record<string, string> = {}) =>
  new Request(origin + path, {method, headers: {'content-type': 'application/json', origin, ...headers}, ...(payload === undefined ? {} : {body: JSON.stringify(payload)})});
const counts = async () => (await db.prepare('SELECT source, step, count FROM funnel ORDER BY source, step').all<{source: string; step: string; count: number}>()).results;
const partial = (pattern: string): Assessment => ({type: null, pattern, status: 'incomplete', axes: [...pattern].map((value, i) => value === '?' ? {axis: (['EI', 'SN', 'TF', 'JP'] as const)[i], value: '?', strength: null} : {axis: (['EI', 'SN', 'TF', 'JP'] as const)[i], value, strength: 'clear'}) as Assessment['axes']});

test('a comparison names the pairing by how many known axes match', () => {
  assert.equal(compareAssessments(decidedAssessment('INTJ'), decidedAssessment('INTJ')).kind, '分身搭檔');
  assert.equal(compareAssessments(decidedAssessment('INTJ'), decidedAssessment('INTP')).kind, '默契搭檔');
  assert.equal(compareAssessments(decidedAssessment('INTJ'), decidedAssessment('ISFJ')).kind, '互補搭檔');
  assert.equal(compareAssessments(decidedAssessment('INTJ'), decidedAssessment('ESFP')).kind, '反差搭檔');
  const unclear = compareAssessments(partial('I???'), decidedAssessment('ESFP'));
  assert.deepEqual([unclear.kind, unclear.known, unclear.same], ['還在認識的搭檔', 1, 0]);
  assert.deepEqual(unclear.axes.map((a) => a.status), ['diff', 'unknown', 'unknown', 'unknown']);
  assert.equal(unclear.axes[1].line, UNKNOWN_LINE);
  const mixed = compareAssessments(decidedAssessment('ENTJ'), decidedAssessment('INTP'));
  assert.deepEqual([mixed.same, mixed.known], [2, 4]);
});

test('every comparison line and pairing name has four translations', () => {
  const lines = new Set<string>([UNKNOWN_LINE, ...compareKinds]);
  for (const a of ['INTJ', 'ESFP', 'ENFJ', 'ISTP'] as const) for (const b of ['INTJ', 'ESFP', 'ENFJ', 'ISTP'] as const) for (const row of compareAssessments(decidedAssessment(a), decidedAssessment(b)).axes) lines.add(row.line);
  assert.equal(lines.size, 1 + compareKinds.length + 12);
  for (const line of lines) assert.equal(dictionary[line]?.length, 4, line);
  const post = comparePost('小克', '默契搭檔', 3, 4, 'https://x.example/vs/a/b', 'en');
  assert.ok(post.includes('In-sync partners') && post.includes('https://x.example/vs/a/b') && post.includes('#AIPartnerStyle'));
});

test('the badge shows the code and level, and a revoked card becomes an invitation', () => {
  const svg = badgeSvg('INTJ · Epic', badgeColors.epic);
  assert.match(svg, /^<svg [^>]*role="img" aria-label="AI Partner Style: INTJ · Epic"/);
  assert.ok(svg.includes(badgeColors.epic) && !svg.includes('<script'));
  assert.ok(badgeSvg('<x>&', badgeColors.missing).includes('&lt;x&gt;&amp;'));
  assert.equal(badgeMarkdown('https://x.example/c/abc'), '[![AI Partner Style](https://x.example/c/abc/badge.svg)](https://x.example/c/abc?via=badge)');
});

test('entry points are counted per day without any identifier, and crawlers are not people', async () => {
  assert.equal(funnelSource('badge'), 'badge');
  assert.equal(funnelSource('../etc'), null);
  assert.equal(isCrawler('Twitterbot/1.0'), true);
  assert.equal(isCrawler('facebookexternalhit/1.1'), true);
  assert.equal(isCrawler(null), true);
  assert.equal(isCrawler('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'), false);
  assert.equal(tagged('https://x.example/', 'qr'), 'https://x.example/?via=qr');
  assert.equal(tagged('https://x.example/c/abc', 'qr'), 'https://x.example/c/abc?via=qr');
  await countStep(db, 'card_view', 'badge', now);
  await countStep(db, 'card_view', 'badge', now);
  await countStep(db, 'landing', null, now);

  // A visitor who arrived through a QR keeps that source from session to result to shared card.
  const created = await handleSession(db, request('/api/sessions', 'POST', {nickname: '小克', protocolVersion: '3.0', via: 'qr'}), undefined, 'session', now);
  assert.equal(created.status, 201);
  const s = await created.json() as {id: string; readToken: string; writeToken: string};
  assert.equal((await handleSession(db, request('/api/sessions', 'POST', {nickname: '小克', protocolVersion: '3.0', via: 'spam'}), undefined, 'session', now)).status, 400);
  const sent = await handleSession(db, request(`/api/collect/${s.id}`, 'POST', {...makeLevelFixture('小克'), kind: 'observed'}, {authorization: `Bearer ${s.writeToken}`, 'idempotency-key': 'growth-test-key-0001'}), s.id, 'collect', now);
  assert.equal(sent.status, 201);
  const card = await createPublicCard(db, request('/api/remembered/card', 'POST', {sessionId: s.id, readToken: s.readToken, family: 'grok', style: 'chibi', nicknameOnly: false, locale: 'zh-TW'}), now);
  assert.equal(card.status, 201);
  // The homepage demo creates a real session, then submits the canned fixture. That finish is not a completion.
  const demo = await handleSession(db, request('/api/sessions', 'POST', {nickname: '示範', protocolVersion: '3.0'}), undefined, 'session', now);
  assert.equal(demo.status, 201);
  const d = await demo.json() as {id: string; writeToken: string};
  const demoSent = await handleSession(db, request(`/api/collect/${d.id}`, 'POST', makeLevelFixture('示範'), {authorization: `Bearer ${d.writeToken}`, 'idempotency-key': 'growth-test-key-demo01'}), d.id, 'collect', now);
  assert.equal(demoSent.status, 201);
  assert.deepEqual(await counts(), [
    {source: 'badge', step: 'card_view', count: 2},
    {source: 'direct', step: 'landing', count: 1},
    {source: 'direct', step: 'session', count: 1},
    {source: 'qr', step: 'result', count: 1},
    {source: 'qr', step: 'session', count: 1},
    {source: 'qr', step: 'share', count: 1},
  ]);
  // The finished result is tallied by shape only: lean axes lowercase, plus rarity, model family and client.
  assert.deepEqual((await db.prepare('SELECT day, pattern, rarity, family, client, count FROM result_tally').all()).results, [
    {day: '2026-10-10', pattern: 'INTJ', rarity: 'epic', family: 'openai', client: 'codex', count: 1},
  ]);
  const columns = (await db.prepare('PRAGMA table_info(funnel)').all<{name: string}>()).results.map((c) => c.name);
  assert.deepEqual(columns, ['day', 'source', 'step', 'count']);

  // The compare target exposes only what the public page shows, and nothing when the type is hidden.
  const {id} = await card.json() as {id: string};
  const target = compareTarget(id, (await loadPublicCard(db, id, now))!);
  assert.deepEqual(Object.keys(target).sort(), ['assessment', 'family', 'id', 'nickname', 'style']);
  assert.equal(compareTarget(id, {...(await loadPublicCard(db, id, now))!, nicknameOnly: true}).assessment, null);
});
