import type {Report} from './assessment.ts';
import {rarityFor} from './rarity.ts';

// Where a visitor came in, and how far they got. Only daily totals are kept, never who.
// link: a shared /c/ link or a compare link. qr: the QR on a downloaded image. badge: a README badge.
// Visitors without one of these tags are counted under 'direct'.
export const funnelSources = ['link', 'qr', 'badge'] as const;
export type FunnelSource = typeof funnelSources[number];
export type FunnelStep = 'card_view' | 'landing' | 'session' | 'result' | 'share';
export const funnelSource = (value: unknown): FunnelSource | null => funnelSources.find((s) => s === value) ?? null;

// Link unfurlers fetch the card page to draw the preview; they are not people who saw it.
const CRAWLER = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|line\/|kakaotalk|headless/i;
export const isCrawler = (userAgent: string | null) => !userAgent || CRAWLER.test(userAgent);

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

export async function countStep(db: D1Database, step: FunnelStep, source: FunnelSource | null, now = Date.now()) {
  try {
    await db.prepare('INSERT INTO funnel (day, source, step, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT(day, source, step) DO UPDATE SET count = count + 1')
      .bind(day(now), source ?? 'direct', step).run();
  } catch {
    // A missed count never blocks the visitor.
  }
}

// The result a submission produced, as one row of a daily tally. Lowercase letters mark a lean axis, '?' an unsettled one.
export function resultTally(report: Pick<Report, 'assessment' | 'usageLevel' | 'metrics'>) {
  return {
    pattern: report.assessment.axes.map((axis) => axis.strength === 'lean' ? axis.value.toLowerCase() : axis.value).join(''),
    rarity: report.usageLevel.value === null ? 'unrated' : rarityFor(report.usageLevel.value),
    family: report.metrics.mostUsedModelFamily,
    client: report.metrics.mostUsedClient,
  };
}

export async function countResult(db: D1Database, report: Pick<Report, 'assessment' | 'usageLevel' | 'metrics'>, now = Date.now()) {
  const row = resultTally(report);
  try {
    await db.prepare('INSERT INTO result_tally (day, pattern, rarity, family, client, count) VALUES (?1, ?2, ?3, ?4, ?5, 1) ON CONFLICT(day, pattern, rarity, family, client) DO UPDATE SET count = count + 1')
      .bind(day(now), row.pattern, row.rarity, row.family, row.client).run();
  } catch {
    // A missed count never blocks the submission.
  }
}

// The landing page keeps the entry point for this tab, so the session it creates later is credited to it.
export const VIA_KEY = 'ai-partner-via-v1';
