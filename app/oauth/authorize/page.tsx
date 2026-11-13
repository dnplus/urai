import {env} from 'cloudflare:workers';
import {redirect} from 'next/navigation';
import {requestOrigin} from '../../../lib/request-origin.ts';
import {checkAuthorizeRequest,type AuthorizeParams} from '../../../lib/oauth-service.ts';
import {OAuthConsent} from '../../../components/oauth-consent.tsx';

export const dynamic='force-dynamic';
export const metadata={title:'授權讀取公開履歷｜你的 AI 夥伴風格指南',robots:{index:false,follow:false}};
const first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
export default async function AuthorizePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=await searchParams;
 const params:AuthorizeParams={client_id:first(query.client_id),redirect_uri:first(query.redirect_uri),response_type:first(query.response_type),scope:first(query.scope),state:first(query.state),code_challenge:first(query.code_challenge),code_challenge_method:first(query.code_challenge_method)};
 const check=await checkAuthorizeRequest(env.DB,params,await requestOrigin());
 // A known app with a faulty request hears about it at its own address; an unknown app or address is never sent the visitor.
 if(check.kind==='redirect')redirect(check.url);
 return <OAuthConsent request={check.kind==='ok'?{params,clientName:check.client.name,redirectHost:new URL(check.redirectUri).host,denyUrl:check.denyUrl}:null}/>;
}
