// Who made the site: the Ginseng Try Catch brand. The footer, llms.txt and the home page's structured data link here.
export const CREATOR = {
  name: 'Ginseng Try Catch',
  site: 'https://ginseng.dnplus.dev',
} as const;

/**
 * A link into the brand site, tagged with `?ref=urai` so the site can tell visitors from this tool apart. Chinese
 * readers get the Chinese pages; everyone else the English ones (the brand site has zh-TW and en).
 */
export function brandLink(path: '/' | '/lab' | '/newsletter', locale: string) {
  const prefix = locale.startsWith('zh') ? '' : '/en';
  return `${CREATOR.site}${path === '/' ? prefix || '/' : prefix + path}?ref=urai`;
}
