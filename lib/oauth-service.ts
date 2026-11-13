import {z} from 'zod';
import {json,HttpError,failure,hashSecret,constantEqual,sameOriginRequest,readJsonBody} from './session-service.ts';
import {rememberedResult} from './remembered-service.ts';
import {saveCard,profileSnapshot,type PublicCard,type PublicProfile} from './public-card-service.ts';
import {defaultFamily} from './catalog.ts';
import {locales} from './i18n.ts';
import {rarityFor} from './rarity.ts';
import {PROTOCOL_VERSION} from './contract.ts';
import type {Report} from './assessment.ts';

// OAuth 2.1 for one thing only: an app the visitor approves may read that visitor's own public work profile.
// Authorization code with PKCE (S256); no implicit or password grants. Codes and tokens are stored as hashes.
export const OAUTH_SCOPE='profile.read';
export const CODE_TTL_MS=5*60000;
export const ACCESS_TTL_MS=60*60000;
const MANAGE_COOKIE='urai_oauth';
const MANAGE_TTL_S=365*86400;
const TOKEN=/^[0-9a-f]{64}$/;
const CHALLENGE=/^[A-Za-z0-9_-]{43}$/;
const VERIFIER=/^[A-Za-z0-9._~-]{43,128}$/;
const hex=(bytes:number)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');

type ClientRow={id:string;name:string;redirect_uris:string;secret_hash:string|null};
type GrantRow={id:string;client_id:string;card_id:string;scope:string;manage_hash:string;created_at:number;code_hash:string|null;code_challenge:string|null;code_redirect_uri:string|null;code_expires_at:number|null;access_hash:string|null;access_expires_at:number|null;refresh_hash:string|null;previous_refresh_hash:string|null};
type CardRow={id:string;card:string;profile:string|null;created_at:number;expires_at:number};

export function oauthMetadata(origin:string){
 return {
  issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',revocation_endpoint:origin+'/oauth/revoke',
  scopes_supported:[OAUTH_SCOPE],response_types_supported:['code'],response_modes_supported:['query'],grant_types_supported:['authorization_code','refresh_token'],
  code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none','client_secret_basic','client_secret_post'],
  revocation_endpoint_auth_methods_supported:['none','client_secret_basic','client_secret_post'],authorization_response_iss_parameter_supported:true,
 };
}

// A redirect address is https, or http on the visitor's own machine for local development. It must match a registered one exactly.
export function validRedirectUri(value:string){
 try{const url=new URL(value);return !url.hash&&!url.username&&!url.password&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname));}catch{return false;}
}
function withParams(base:string,params:Record<string,string|undefined>){
 const url=new URL(base);for(const [key,value] of Object.entries(params))if(value!==undefined)url.searchParams.set(key,value);return url.href;
}

export type AuthorizeParams={client_id?:string;redirect_uri?:string;response_type?:string;scope?:string;state?:string;code_challenge?:string;code_challenge_method?:string};
export type AuthorizeCheck=
 // The client or its return address cannot be trusted, so the visitor is told here and never sent back.
 |{kind:'invalid';reason:'client'|'redirect_uri'}
 |{kind:'redirect';url:string}
 |{kind:'ok';client:{id:string;name:string};redirectUri:string;state?:string;codeChallenge:string;denyUrl:string};
export async function checkAuthorizeRequest(db:D1Database,params:AuthorizeParams,origin:string):Promise<AuthorizeCheck>{
 const client=params.client_id&&params.client_id.length<=64?await db.prepare('SELECT id,name,redirect_uris,secret_hash FROM oauth_clients WHERE id=?1').bind(params.client_id).first<ClientRow>():null;
 if(!client)return {kind:'invalid',reason:'client'};
 const redirectUri=params.redirect_uri;
 if(!redirectUri||!(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)||!validRedirectUri(redirectUri))return {kind:'invalid',reason:'redirect_uri'};
 const state=params.state&&params.state.length<=512?params.state:undefined;
 const back=(error:string,description:string)=>({kind:'redirect' as const,url:withParams(redirectUri,{error,error_description:description,state,iss:origin})});
 if(params.state&&!state)return back('invalid_request','state is too long');
 if(params.response_type!=='code')return back('unsupported_response_type','Only response_type=code is supported');
 if((params.scope??OAUTH_SCOPE)!==OAUTH_SCOPE)return back('invalid_scope','The only scope is '+OAUTH_SCOPE);
 if(params.code_challenge_method!=='S256'||!CHALLENGE.test(params.code_challenge??''))return back('invalid_request','PKCE is required: send code_challenge with code_challenge_method=S256');
 return {kind:'ok',client:{id:client.id,name:client.name},redirectUri,state,codeChallenge:params.code_challenge!,denyUrl:back('access_denied','The visitor declined').url};
}

const consentSchema=z.object({
 client_id:z.string().max(64),redirect_uri:z.string().max(2048),response_type:z.string().max(16),scope:z.string().max(64).optional(),state:z.string().max(512).optional(),
 code_challenge:z.string().max(128),code_challenge_method:z.string().max(8),
 // Publishing is a separate, explicit yes: without it, a card that keeps its numbers private cannot be authorized.
 publish:z.boolean().optional(),locale:z.enum(locales).optional(),
}).strict();

function manageToken(request:Request){
 const value=request.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(MANAGE_COOKIE+'='))?.slice(MANAGE_COOKIE.length+1);
 return value&&TOKEN.test(value)?value:null;
}
const manageCookie=(request:Request,value:string)=>`${MANAGE_COOKIE}=${value}; Path=/api/remembered/oauth; Max-Age=${MANAGE_TTL_S}; HttpOnly; SameSite=Strict${new URL(request.url).protocol==='https:'?'; Secure':''}`;
const sweep=(db:D1Database,now:number)=>db.prepare('DELETE FROM oauth_grants WHERE card_id NOT IN (SELECT id FROM public_cards WHERE expires_at>?1) OR (refresh_hash IS NULL AND (code_expires_at IS NULL OR code_expires_at<=?1))').bind(now).run();

// The browser side, under /api/remembered so the remembered-result cookie reaches it:
// GET says what this browser could share and which apps it has authorized, POST approves a request, DELETE revokes one app.
export async function handleConsent(db:D1Database,request:Request,now=Date.now()):Promise<Response>{
 try{
  sameOriginRequest(request,request.method!=='GET');
  const remembered=await rememberedResult(db,request,now),manage=manageToken(request);
  const card=remembered?await db.prepare('SELECT id,card,profile,created_at,expires_at FROM public_cards WHERE session_id=?1 AND expires_at>?2').bind(remembered.id,now).first<CardRow>():null;
  const manageHash=manage?await hashSecret(manage):'';
  if(request.method==='GET'){
   const report=remembered?JSON.parse(remembered.report) as Report:null;
   const {results}=await db.prepare('SELECT g.id,g.created_at,c.name FROM oauth_grants g JOIN oauth_clients c ON c.id=g.client_id JOIN public_cards p ON p.id=g.card_id WHERE g.refresh_hash IS NOT NULL AND p.expires_at>?3 AND (g.manage_hash=?1 OR g.card_id=?2) ORDER BY g.created_at DESC LIMIT 50')
    .bind(manageHash,card?.id??'',now).all<{id:string;created_at:number;name:string}>();
   return json({
    result:report?{nickname:report.nickname,shareable:report.kind==='observed'&&report.version===PROTOCOL_VERSION,snapshot:profileSnapshot(report),card:card?{id:card.id,profile:card.profile!==null}:null}:null,
    grants:results.map(row=>({id:row.id,client:row.name,createdAt:row.created_at})),
   });
  }
  if(request.method==='DELETE'){
   const id=new URL(request.url).searchParams.get('grant')??'';
   const removed=await db.prepare('DELETE FROM oauth_grants WHERE id=?1 AND (manage_hash=?2 OR card_id=?3)').bind(id,manageHash,card?.id??'').run();
   if(removed.meta.changes!==1)failure(404,'找不到這筆授權。');
   return json({deleted:true});
  }
  if(request.method!=='POST')failure(405,'此操作不支援。');
  const parsed=consentSchema.safeParse(await readJsonBody(request));
  if(!parsed.success)return failure(400,'授權請求無效。');
  const input=parsed.data,origin=new URL(request.url).origin;
  const check=await checkAuthorizeRequest(db,input,origin);
  if(check.kind!=='ok')return failure(400,'授權請求無效。');
  if(!remembered)return failure(404,'找不到這份結果，請重新觀察。');
  let cardId=card?.id;
  if(!card||card.profile===null){
   if(!input.publish)return json({error:'履歷快照尚未公開。',code:'profile_private'},409);
   const report=JSON.parse(remembered.report) as Report;
   // An existing card keeps its look; a new one takes the default art for the model family the report names.
   const look=card?(({family,style,nicknameOnly,locale})=>({family,style,nicknameOnly,locale}))(JSON.parse(card.card) as PublicCard)
    :{family:defaultFamily(report.metrics.mostUsedModelFamily,report.metrics.mostUsedClient),style:'regular' as const,nicknameOnly:false,locale:input.locale??'zh-TW'};
   cardId=(await saveCard(db,remembered,look,true,now)).id;
  }
  await sweep(db,now);
  const code=hex(32),secret=manage??hex(32);
  // Approving the same app again replaces its pending code; tokens it already holds keep working until it exchanges the new one.
  await db.prepare('INSERT INTO oauth_grants (id,client_id,card_id,scope,manage_hash,created_at,code_hash,code_challenge,code_redirect_uri,code_expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(client_id,card_id) DO UPDATE SET manage_hash=excluded.manage_hash,code_hash=excluded.code_hash,code_challenge=excluded.code_challenge,code_redirect_uri=excluded.code_redirect_uri,code_expires_at=excluded.code_expires_at')
   .bind(crypto.randomUUID(),check.client.id,cardId!,OAUTH_SCOPE,await hashSecret(secret),now,await hashSecret(code),check.codeChallenge,check.redirectUri,now+CODE_TTL_MS).run();
  const response=json({redirect:withParams(check.redirectUri,{code,state:check.state,iss:origin})},201);
  // This cookie lets the same browser list and revoke its authorizations after the 7-day result cookie is gone.
  response.headers.set('Set-Cookie',manageCookie(request,secret));
  return response;
 }catch(error){
  if(error instanceof HttpError)return json({error:error.message},error.status);
  console.warn(JSON.stringify({event:'oauth_consent_unavailable',errorClass:error instanceof TypeError?'TypeError':'Error'}));
  return json({error:'暫時無法處理，請稍後再試。'},503);
 }
}

// Token, revocation and profile responses are read by other sites' servers or pages. They carry no cookies, so any origin may call them.
const apiHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};
const api=(value:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{...apiHeaders,...extra}});
export const oauthPreflight=()=>new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'86400'}});
class OAuthError extends Error{
 status:number;code:string;
 constructor(code:string,description:string,status=400){super(description);this.code=code;this.status=status;}
}
const oauthFailure=(error:unknown,event:string)=>{
 if(error instanceof OAuthError)return api({error:error.code,error_description:error.message},error.status,error.status===401?{'WWW-Authenticate':'Basic realm="urai"'}:{});
 console.warn(JSON.stringify({event,errorClass:error instanceof TypeError?'TypeError':'Error'}));
 return api({error:'temporarily_unavailable',error_description:'Try again later'},503);
};
const pkceChallenge=async(verifier:string)=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

async function formOf(request:Request){
 if(request.method!=='POST')throw new OAuthError('invalid_request','Use POST',405);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))throw new OAuthError('invalid_request','Send application/x-www-form-urlencoded');
 const text=await request.text();
 if(text.length>8192)throw new OAuthError('invalid_request','Request is too large');
 return new URLSearchParams(text);
}
// A client with a registered secret must present it; one without is a public client identified by client_id and protected by PKCE.
async function clientOf(db:D1Database,request:Request,form:URLSearchParams){
 let id=form.get('client_id'),secret=form.get('client_secret');
 const basic=request.headers.get('authorization')?.match(/^Basic ([A-Za-z0-9+/=]+)$/)?.[1];
 if(basic){try{const [user,...rest]=atob(basic).split(':');id=decodeURIComponent(user);secret=decodeURIComponent(rest.join(':'));}catch{throw new OAuthError('invalid_client','Malformed client credentials',401);}}
 const client=id&&id.length<=64?await db.prepare('SELECT id,name,redirect_uris,secret_hash FROM oauth_clients WHERE id=?1').bind(id).first<ClientRow>():null;
 if(!client)throw new OAuthError('invalid_client','Unknown client',401);
 if(client.secret_hash&&!(secret&&constantEqual(await hashSecret(secret),client.secret_hash)))throw new OAuthError('invalid_client','Client authentication failed',401);
 return client;
}
const tokenResponse=(access:string,refresh:string)=>api({access_token:access,token_type:'Bearer',expires_in:ACCESS_TTL_MS/1000,refresh_token:refresh,scope:OAUTH_SCOPE});
const cardAlive=async(db:D1Database,cardId:string,now:number)=>!!await db.prepare('SELECT id FROM public_cards WHERE id=?1 AND expires_at>?2').bind(cardId,now).first();

export async function handleToken(db:D1Database,request:Request,now=Date.now()):Promise<Response>{
 try{
  const form=await formOf(request),client=await clientOf(db,request,form),grantType=form.get('grant_type');
  const access=hex(32),refresh=hex(32);
  if(grantType==='authorization_code'){
   const code=form.get('code')??'',verifier=form.get('code_verifier')??'';
   const grant=TOKEN.test(code)?await db.prepare('SELECT * FROM oauth_grants WHERE code_hash=?1').bind(await hashSecret(code)).first<GrantRow>():null;
   if(!grant||grant.client_id!==client.id||(grant.code_expires_at??0)<=now)throw new OAuthError('invalid_grant','The authorization code is invalid or has expired');
   if(form.get('redirect_uri')!==grant.code_redirect_uri)throw new OAuthError('invalid_grant','redirect_uri does not match the authorization request');
   if(!VERIFIER.test(verifier)||!constantEqual(await pkceChallenge(verifier),grant.code_challenge??''))throw new OAuthError('invalid_grant','code_verifier does not match the code_challenge');
   if(!await cardAlive(db,grant.card_id,now))throw new OAuthError('invalid_grant','The public card has been withdrawn');
   // The code is spent in the same statement that issues the tokens, so it can never be exchanged twice.
   const used=await db.prepare('UPDATE oauth_grants SET code_hash=NULL,code_challenge=NULL,code_redirect_uri=NULL,code_expires_at=NULL,access_hash=?1,access_expires_at=?2,refresh_hash=?3,previous_refresh_hash=NULL WHERE id=?4 AND code_hash=?5')
    .bind(await hashSecret(access),now+ACCESS_TTL_MS,await hashSecret(refresh),grant.id,grant.code_hash).run();
   if(used.meta.changes!==1)throw new OAuthError('invalid_grant','The authorization code is invalid or has expired');
   return tokenResponse(access,refresh);
  }
  if(grantType==='refresh_token'){
   const presented=form.get('refresh_token')??'',hash=TOKEN.test(presented)?await hashSecret(presented):'';
   const grant=hash?await db.prepare('SELECT * FROM oauth_grants WHERE (refresh_hash=?1 OR previous_refresh_hash=?1) AND client_id=?2').bind(hash,client.id).first<GrantRow>():null;
   if(!grant)throw new OAuthError('invalid_grant','The refresh token is invalid or has been revoked');
   // Refresh tokens rotate. Seeing a spent one again means it leaked, so the whole authorization ends.
   if(grant.refresh_hash!==hash||!await cardAlive(db,grant.card_id,now)){
    await db.prepare('DELETE FROM oauth_grants WHERE id=?1').bind(grant.id).run();
    throw new OAuthError('invalid_grant','The refresh token is invalid or has been revoked');
   }
   const rotated=await db.prepare('UPDATE oauth_grants SET access_hash=?1,access_expires_at=?2,refresh_hash=?3,previous_refresh_hash=?4 WHERE id=?5 AND refresh_hash=?4')
    .bind(await hashSecret(access),now+ACCESS_TTL_MS,await hashSecret(refresh),hash,grant.id).run();
   if(rotated.meta.changes!==1)throw new OAuthError('invalid_grant','The refresh token is invalid or has been revoked');
   return tokenResponse(access,refresh);
  }
  throw new OAuthError('unsupported_grant_type','Use authorization_code or refresh_token');
 }catch(error){return oauthFailure(error,'oauth_token_unavailable');}
}

// RFC 7009: revoking either token ends the whole authorization. Unknown tokens still answer 200.
export async function handleRevoke(db:D1Database,request:Request):Promise<Response>{
 try{
  const form=await formOf(request),client=await clientOf(db,request,form),token=form.get('token')??'';
  if(TOKEN.test(token)){const hash=await hashSecret(token);await db.prepare('DELETE FROM oauth_grants WHERE client_id=?1 AND (access_hash=?2 OR refresh_hash=?2)').bind(client.id,hash).run();}
  return api({});
 }catch(error){return oauthFailure(error,'oauth_revoke_unavailable');}
}

// GET /api/me/profile: the snapshot the visitor made public, when it was generated, and the page where anyone can check it.
export async function handleProfile(db:D1Database,request:Request,now=Date.now()):Promise<Response>{
 try{
  if(request.method!=='GET')return api({error:'invalid_request',error_description:'Use GET'},405);
  const challenge=(error?:string,description?:string)=>api({error:error??'invalid_token',error_description:description??'Send an access token as Authorization: Bearer'},401,{'WWW-Authenticate':`Bearer realm="urai", scope="${OAUTH_SCOPE}"`+(error?`, error="${error}", error_description="${description}"`:'')});
  const token=request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if(!token)return request.headers.has('authorization')?challenge('invalid_token','The access token is malformed'):challenge();
  const grant=await db.prepare('SELECT * FROM oauth_grants WHERE access_hash=?1').bind(await hashSecret(token)).first<GrantRow>();
  if(!grant)return challenge('invalid_token','The access token is invalid or has been revoked');
  if((grant.access_expires_at??0)<=now)return challenge('invalid_token','The access token has expired');
  const row=await db.prepare('SELECT id,card,profile,created_at,expires_at FROM public_cards WHERE id=?1').bind(grant.card_id).first<CardRow>();
  if(!row||row.expires_at<=now){
   // The card is gone for good, so the authorization goes with it; later calls get 401.
   await db.prepare('DELETE FROM oauth_grants WHERE id=?1').bind(grant.id).run();
   return api({error:'card_not_found',error_description:'The public card was withdrawn or has expired'},404);
  }
  if(!row.profile)return api({error:'profile_not_public',error_description:'The owner no longer publishes the profile snapshot'},404);
  const data=JSON.parse(row.card) as PublicCard,level=data.card.usageLevel.value;
  return api({
   id:row.id,url:new URL('/c/'+row.id,request.url).href,generatedAt:new Date(row.created_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),
   nickname:data.card.nickname,
   // Only what the public page shows: a nickname-only card keeps its type and rarity to itself.
   card:data.nicknameOnly?null:{type:data.card.assessment.type,pattern:data.card.assessment.pattern,axes:data.card.assessment.axes,rarity:level===null?'unrated':rarityFor(level)},
   snapshot:JSON.parse(row.profile) as PublicProfile,
  });
 }catch(error){return oauthFailure(error,'oauth_profile_unavailable');}
}
