import {env} from 'cloudflare:workers';
import {handleRevoke,oauthPreflight} from '../../../lib/oauth-service.ts';
export async function POST(request:Request){return handleRevoke(env.DB,request);}
export const OPTIONS=oauthPreflight;
