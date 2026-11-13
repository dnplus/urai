import {env} from 'cloudflare:workers';
import {handleToken,oauthPreflight} from '../../../lib/oauth-service.ts';
export async function POST(request:Request){return handleToken(env.DB,request);}
export const OPTIONS=oauthPreflight;
