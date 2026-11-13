import {oauthMetadata} from '../../../lib/oauth-service.ts';
// RFC 8414 discovery: where to send the visitor, where to trade the code, and that PKCE S256 is the only way in.
export function GET(request:Request){
 return new Response(JSON.stringify(oauthMetadata(new URL(request.url).origin)),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*'}});
}
