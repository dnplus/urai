'use client';
import {useEffect,useRef,useState} from 'react';
import {X,Download,Share2,Copy,Link2} from 'lucide-react';
import {useLocale} from './locale-provider.tsx';
import {makeCardFile,saveCardFile,shareText,exportFormats,type ExportFormat} from '../lib/export-card.ts';
import {agentSharePrompt,badgeMarkdown} from '../lib/share-kit.ts';
import {lookOf,type PublicLink} from './public-link.ts';
import type {CardObservation} from '../lib/assessment.ts';
import type {ArtStyle,Family} from '../lib/catalog.ts';

export function CardShare({card,style,family,nicknameOnly,home,link,linking,onCreateLink,onRevokeLink}:{card:CardObservation;style:ArtStyle;family:Family;nicknameOnly:boolean;home:string;link?:PublicLink|null;linking?:boolean;onCreateLink?:(includeProfile:boolean)=>Promise<string>;onRevokeLink?:()=>Promise<string>}){
 const {t,locale}=useLocale(),dialog=useRef<HTMLDialogElement>(null),busy=useRef(false);
 const [open,setOpen]=useState(false),[format,setFormat]=useState<ExportFormat>('feed'),[prepared,setPrepared]=useState<{key:string;file:File}|null>(null),[notice,setNotice]=useState(''),[sharing,setSharing]=useState(false),[brief,setBrief]=useState(true),[profileChoice,setProfileChoice]=useState<boolean|null>(null);
 // The work-profile snapshot stays private until this box is ticked; an existing link shows what it currently publishes.
 const includeProfile=profileChoice??!!link?.profile;
 // With a verifiable link, the QR and the post point at the server-drawn card instead of the home page.
 const target=link?.url??home,look=lookOf(family,style,nicknameOnly);
 const text=shareText(card,nicknameOnly,target,locale,brief);
 const key=JSON.stringify([card,style,family,nicknameOnly,target,locale,format]),file=prepared?.key===key?prepared.file:null;
 useEffect(()=>{
  if(!open)return;let active=true;void makeCardFile(card,style,family,nicknameOnly,target,locale,format).then(r=>{if(active)setPrepared({key,file:r.file});}).catch(()=>{if(active)setNotice('圖片匯出失敗');});return ()=>{active=false;};
 },[open,format,card,style,family,nicknameOnly,target,locale,key]);
 function close(){dialog.current?.close();setOpen(false);}
 async function copy(value:string,done:string){try{await navigator.clipboard.writeText(value);setNotice(done);}catch{setNotice('無法自動複製，請選取下方文字。');}}
 async function run(action?:()=>Promise<string>){if(action){setNotice(await action());setProfileChoice(null);}}
 const createLink=onCreateLink&&(()=>onCreateLink(includeProfile));
 async function share(){
  if(!file||busy.current)return;busy.current=true;setSharing(true);setNotice('');
  try{
   if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:t('你的 AI 夥伴風格指南'),text});setNotice('已交給系統分享選單。');}
   else{saveCardFile(file);try{await navigator.clipboard.writeText(text);setNotice('圖片已下載，分享文字與首頁連結已複製。');}catch{setNotice('圖片已下載，請複製下方文字與首頁連結。');}}
  }catch(error){if(error instanceof DOMException&&error.name==='AbortError')setNotice('已取消分享。');else{saveCardFile(file);setNotice('系統分享未完成，已改為下載圖片。');}}
  finally{busy.current=false;setSharing(false);}
 }
 return <><button className="secondary-action" onClick={()=>{setNotice('');setOpen(true);dialog.current?.showModal();}}><Share2 size={18}/>{t('分享卡片')}</button><dialog ref={dialog} className="share-dialog" onClose={()=>setOpen(false)} aria-labelledby="share-title"><button className="icon-button dialog-close" aria-label={t('關閉分享')} onClick={close}><X size={22}/></button><h2 id="share-title">{t('挑個尺寸，分享這一面。')}</h2><div className="format-options" aria-label={t('分享尺寸')}>{Object.entries(exportFormats).filter(([key])=>key!=='card').map(([key,f])=><button key={key} aria-pressed={format===key} onClick={()=>{setNotice('');setFormat(key as ExportFormat);}}><span className={'format-icon '+key}/><b>{t(f.label)}</b><small>{f.width} × {f.height}</small></button>)}</div>
  {onCreateLink&&card.kind==='observed'&&<div className="verify-link">{link?<>
   <p><b>{t('可驗證連結')}</b><code>{link.url}</code></p>
   <div className="verify-actions"><button className="quiet-button" onClick={()=>copy(link.url,'連結已複製。')}><Copy size={14}/>{t('複製連結')}</button><button className="quiet-button" onClick={()=>copy(agentSharePrompt(card,link.url,locale,nicknameOnly),'已複製給 Agent 的分享指令。')}>{t('交給 Agent 分享')}</button><button className="quiet-button" onClick={()=>copy(badgeMarkdown(link.url),'徽章語法已複製，貼進 GitHub README 即可。')}>{t('README 徽章')}</button>{(link.look!==look||!!link.profile!==includeProfile)&&<button className="quiet-button verify-update" disabled={linking} onClick={()=>run(createLink)}>{t('更新公開卡面')}</button>}<button className="quiet-button" disabled={linking} onClick={()=>run(onRevokeLink)}>{t('撤回連結')}</button></div>
  </>:<>
   <p><b>{t('可驗證連結')}</b><span>{t('建立公開卡片頁：連結貼到社群會顯示卡片圖，收到的人也能點開確認這張卡是真的。可隨時撤回。')}</span></p>
   <button className="secondary-action" disabled={linking} onClick={()=>run(createLink)}><Link2 size={16}/>{linking?t('建立中…'):t('建立可驗證連結')}</button>
  </>}
   <label className="check-field profile-toggle"><input type="checkbox" checked={includeProfile} onChange={e=>setProfileChoice(e.target.checked)}/><span><b>{t('一併公開 AI 工作履歷快照')}</b>{t('把報告裡的統計數字（工作階段、tokens、自動化、子代理、寫下與重用的資產）放上公開卡片頁，也讓你授權的應用讀取。不含任務、時間軸與對話。')} <a href="/oauth/grants" target="_blank" rel="noopener">{t('管理已授權的應用')}</a></span></label>
  </div>}
  <label className="check-field"><input type="checkbox" checked={brief} onChange={e=>setBrief(e.target.checked)} disabled={nicknameOnly}/>{t('附上簡短解讀')}</label><textarea className="share-text" aria-label={t('分享文字')} value={text} readOnly onFocus={e=>e.currentTarget.select()}/><div className="share-actions"><button className="primary" onClick={share} disabled={!file||sharing}>{!file?t('製作圖片中…'):t('分享這個尺寸')}<Share2 size={18}/></button><button className="quiet-button" onClick={()=>{if(file)saveCardFile(file);}} disabled={!file||sharing}><Download size={16}/>{t('下載這個尺寸')}</button><button className="quiet-button" onClick={()=>copy(text,'分享文字與首頁連結已複製。')}><Copy size={15}/>{t('複製文字與連結')}</button></div>{notice&&<p role="status">{t(notice)}</p>}</dialog></>;
}
