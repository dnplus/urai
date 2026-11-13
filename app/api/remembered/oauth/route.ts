import {env} from 'cloudflare:workers';
import {guardWrite} from '../../../../lib/abuse-guard.ts';
import {handleConsent} from '../../../../lib/oauth-service.ts';
export async function GET(request:Request){return handleConsent(env.DB,request);}
export async function POST(request:Request){return (await guardWrite(env,request))??handleConsent(env.DB,request);}
export const DELETE=POST;
