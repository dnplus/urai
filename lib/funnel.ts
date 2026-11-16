// Where a visitor came in, and how far they got. Only daily totals are kept, never who.
// link: a shared /c/ link or a compare link. qr: the QR on a downloaded image. badge: a README badge.
// direct: everyone else (typed the address, a search result, a bookmark), so the sum over sources is the whole site.
export const funnelSources = ['link', 'qr', 'badge', 'direct'] as const;
export type FunnelSource = typeof funnelSources[number];
export type FunnelStep = 'card_view' | 'landing' | 'session' | 'result' | 'share';
export const funnelSource = (value: unknown): FunnelSource | null => funnelSources.find((s) => s === value) ?? null;

// Link unfurlers fetch the card page to draw the preview; they are not people who saw it.
const CRAWLER = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|line\/|kakaotalk|headless/i;
export const isCrawler = (userAgent: string | null) => !userAgent || CRAWLER.test(userAgent);

export async function countStep(db: D1Database, step: FunnelStep, source: FunnelSource | null, now = Date.now()) {
  if (!source) return;
  try {
    await db.prepare('INSERT INTO funnel (day, source, step, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT(day, source, step) DO UPDATE SET count = count + 1')
      .bind(new Date(now).toISOString().slice(0, 10), source, step).run();
  } catch {
    // A missed count never blocks the visitor.
  }
}

// The landing page keeps the entry point for this tab, so the session it creates later is credited to it.
export const VIA_KEY = 'ai-partner-via-v1';
