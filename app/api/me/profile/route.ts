import {env} from 'cloudflare:workers';
import {handleProfile,oauthPreflight} from '../../../../lib/oauth-service.ts';
export async function GET(request:Request){return handleProfile(env.DB,request);}
export const OPTIONS=oauthPreflight;
