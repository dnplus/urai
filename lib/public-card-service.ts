import {z} from 'zod';
import {json,HttpError,failure,hashSecret,constantEqual,sameOriginRequest,readJsonBody,readSessionReport} from './session-service.ts';
import {rememberedResult} from './remembered-service.ts';
import {countStep,funnelSource} from './funnel.ts';
import {toCardObservation,storedSelfType,type CardObservation,type Report} from './assessment.ts';
import {PROTOCOL_VERSION} from './contract.ts';
import {families,type ArtStyle,type Family} from './catalog.ts';
import {locales,type Locale} from './i18n.ts';

export const CARD_TTL_MS=365*86400000;
const PUBLIC_ID=/^[A-Za-z0-9_-]{22}$/;
const familyIds=families.map(f=>f.id) as [Family,...Family[]];
const createSchema=z.object({
 sessionId:z.string().regex(/^[0-9a-f-]{36}$/).optional(),readToken:z.string().regex(/^[0-9a-f]{64}$/).optional(),
 family:z.enum(familyIds),style:z.enum(['regular','chibi']),nicknameOnly:z.boolean(),locale:z.enum(locales),
}).strict();
export type PublicCard={card:CardObservation;family:Family;style:ArtStyle;nicknameOnly:boolean;locale:Locale;createdAt:number};
type Row={id:string;session_id:string;card:string;revoke_hash:string;created_at:number;expires_at:number};
const random=(bytes:number)=>crypto.getRandomValues(new Uint8Array(bytes));
const publicId=()=>btoa(String.fromCharCode(...random(16))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const hex=(bytes:number)=>Array.from(random(bytes),b=>b.toString(16).padStart(2,'0')).join('');

// Lives under /api/remembered so the remembered-result cookie reaches it when the session link has expired.
export async function createPublicCard(db:D1Database,request:Request,now=Date.now()):Promise<Response>{
 try{
  sameOriginRequest(request,true);
  if(request.method!=='POST')failure(405,'此操作不支援。');
  const parsed=createSchema.safeParse(await readJsonBody(request));
  if(!parsed.success)return failure(400,'請檢查卡片選項。');
  const input=parsed.data;
  let source:{id:string;report:string|null;self_type:string|null;via?:string|null}|null=null;
  if(input.sessionId&&input.readToken)source=await readSessionReport(db,request,input.sessionId,input.readToken,now);
  else source=await rememberedResult(db,request,now);
  const report=source?.report?JSON.parse(source.report) as Report:null;
  if(!source||!report)return failure(404,'找不到這份結果，請重新觀察。');
  if(report.version!==PROTOCOL_VERSION)failure(410,'觀察規則已更新，請重新觀察後再分享。');
  if(report.kind!=='observed')failure(422,'示範資料不能建立公開卡片。');
  await db.prepare('DELETE FROM public_cards WHERE expires_at<=?1').bind(now).run();
  const card:Omit<PublicCard,'createdAt'>={card:toCardObservation(report,storedSelfType(source.self_type)),family:input.family,style:input.style,nicknameOnly:input.nicknameOnly,locale:input.locale};
  // One public card per result: creating it again keeps the address, refreshes the look, and hands out a new revoke token.
  const revokeToken=hex(32);
  const saved=await db.prepare('INSERT INTO public_cards (id,session_id,card,revoke_hash,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(session_id) DO UPDATE SET card=excluded.card,revoke_hash=excluded.revoke_hash,expires_at=excluded.expires_at RETURNING id')
   .bind(publicId(),source.id,JSON.stringify(card),await hashSecret(revokeToken),now,now+CARD_TTL_MS).first<{id:string}>();
  // A saved result keeps no entry point, so its shares count as direct.
  await countStep(db,'share',funnelSource(source.via)??'direct',now);
  return json({id:saved!.id,url:new URL('/c/'+saved!.id,request.url).href,revokeToken},201);
 }catch(error){
  if(error instanceof HttpError)return json({error:error.message},error.status);
  return json({error:'暫時無法處理，請稍後再試。'},503);
 }
}

export async function revokePublicCard(db:D1Database,request:Request,id:string):Promise<Response>{
 try{
  sameOriginRequest(request,true);
  if(request.method!=='DELETE')failure(405,'此操作不支援。');
  const token=request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  const row=PUBLIC_ID.test(id)?await db.prepare('SELECT revoke_hash FROM public_cards WHERE id=?1').bind(id).first<Row>():null;
  if(!row||!token||!constantEqual(await hashSecret(token),row.revoke_hash))failure(404,'找不到這張公開卡片。');
  await db.prepare('DELETE FROM public_cards WHERE id=?1').bind(id).run();
  return json({deleted:true});
 }catch(error){
  if(error instanceof HttpError)return json({error:error.message},error.status);
  return json({error:'暫時無法處理，請稍後再試。'},503);
 }
}

export async function loadPublicCard(db:D1Database,id:string,now=Date.now()):Promise<PublicCard|null>{
 if(!PUBLIC_ID.test(id))return null;
 const row=await db.prepare('SELECT card,created_at,expires_at FROM public_cards WHERE id=?1').bind(id).first<Row>();
 if(!row||row.expires_at<=now)return null;
 return {...JSON.parse(row.card),createdAt:row.created_at};
}

// What a visitor arriving through ?vs= needs to compare against: only what the public card page already shows.
export function compareTarget(id:string,data:PublicCard){
 return {id,nickname:data.card.nickname,family:data.family,style:data.style,assessment:data.nicknameOnly?null:data.card.assessment};
}
export type CompareTarget=ReturnType<typeof compareTarget>;
