import {NextResponse, type NextRequest} from 'next/server';
import {siteRedirect} from './lib/site-host.ts';

export function proxy(request: NextRequest) {
  const target = siteRedirect(request.url);
  if (target) return NextResponse.redirect(target, 301);
  const response = NextResponse.next();
  // The consent and revocation pages must never be framed by another site, or a click there could be steered.
  if (request.nextUrl.pathname.startsWith('/oauth/')) {
    response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
    response.headers.set('X-Frame-Options', 'DENY');
  }
  return response;
}
