// Reads the anonymous daily counts from D1 and prints who came in, how far they got, and which results they drew.
// npm run stats             production D1
// npm run stats -- --local  the local D1 under .wrangler/state
// npm run stats -- --days 7 limit everything to the last 7 days (UTC)
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2);
const local=args.includes('--local');
const daysArg=args.indexOf('--days'),days=daysArg>=0?Number(args[daysArg+1]):null;
if(days!==null&&!(Number.isInteger(days)&&days>0))throw new Error('--days needs a positive whole number');
const since=days?new Date(Date.now()-(days-1)*864e5).toISOString().slice(0,10):'0000-00-00';

function query(sql){
 const target=local?['--local','--persist-to','.wrangler/state']:['--remote'];
 const out=execFileSync('npx',['wrangler','d1','execute','DB',...target,'--config','wrangler.jsonc','--json','--command',sql],{encoding:'utf8',stdio:['ignore','pipe','inherit']});
 return JSON.parse(out)[0].results;
}
const funnel=query(`SELECT day, source, step, count FROM funnel WHERE day >= '${since}'`);
const results=query(`SELECT day, pattern, rarity, family, client, count FROM result_tally WHERE day >= '${since}'`);

// CJK characters take two terminal columns, so columns are padded by display width.
const cells=text=>[...String(text)].reduce((n,c)=>n+(/[\u1100-\uffff]/.test(c)?2:1),0);
const padEnd=(text,width)=>String(text)+' '.repeat(Math.max(0,width-cells(text)));
const padStart=(text,width)=>' '.repeat(Math.max(0,width-cells(text)))+String(text);
const sum=rows=>rows.reduce((n,r)=>n+r.count,0);
const pct=(n,total)=>total?(n/total*100).toFixed(1).padStart(5)+'%':'    –';
const bar=(n,max,width=24)=>'█'.repeat(max?Math.round(n/max*width):0);
const by=(rows,key)=>{const m=new Map();for(const r of rows){const k=typeof key==='function'?key(r):r[key];m.set(k,(m.get(k)??0)+r.count);}return [...m].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));};
const heading=text=>console.log('\n'+text+'\n'+'─'.repeat(cells(text)));
function table(entries,total=sum(entries.map(([,count])=>({count})))){
 const max=Math.max(0,...entries.map(([,n])=>n)),width=Math.max(4,...entries.map(([k])=>cells(k)));
 for(const [label,n] of entries)console.log('  '+padEnd(label,width)+String(n).padStart(6)+'  '+pct(n,total)+'  '+bar(n,max));
 if(!entries.length)console.log('  （沒有資料）');
}

const steps=['card_view','landing','session','result','share'];
const stepNames={card_view:'看卡',landing:'進首頁',session:'開始',result:'完成',share:'公開分享'};
const sources=[...new Set(funnel.map(r=>r.source))].sort();
const stepTotal=(step,source)=>sum(funnel.filter(r=>r.step===step&&(!source||r.source===source)));
const allDays=[...new Set([...funnel,...results].map(r=>r.day))].sort();

console.log(`AI 夥伴風格指南 · ${local?'本機':'正式站'} · ${days?`最近 ${days} 天（UTC，自 ${since}）`:'全部'}${allDays.length?` · 資料期間 ${allDays[0]} – ${allDays.at(-1)}`:''}`);

heading('總覽');
const played=sum(results);
console.log(`  完成觀察  ${played} 人（每日彙總表）`);
console.log(`  開始觀察  ${stepTotal('session')} 次，完成率 ${pct(stepTotal('result'),stepTotal('session')).trim()}`);
console.log(`  公開分享  ${stepTotal('share')} 張，分享率 ${pct(stepTotal('share'),stepTotal('result')).trim()}`);
console.log('  註：direct 與每日彙總表從加上它的那次部署才開始累積。');

heading('漏斗 · 依來源');
console.log('  '+padEnd('來源',8)+steps.map(s=>padStart(stepNames[s],9)).join('')+padStart('完成率',9));
for(const source of [...sources,null]){
 const row=steps.map(step=>padStart(stepTotal(step,source),9));
 console.log('  '+padEnd(source??'合計',8)+row.join('')+padStart(pct(stepTotal('result',source),stepTotal('session',source)),9));
}

heading('每日');
console.log('  '+padEnd('日期',10)+['進首頁','開始','完成','分享'].map(s=>padStart(s,8)).join('')+'  完成');
for(const day of allDays.slice(-14).reverse()){
 const n=step=>sum(funnel.filter(r=>r.day===day&&r.step===step));
 console.log('  '+day+['landing','session','result','share'].map(step=>String(n(step)).padStart(8)).join('')+'  '+bar(sum(results.filter(r=>r.day===day)),Math.max(1,...allDays.map(d=>sum(results.filter(r=>r.day===d)))),16));
}
if(allDays.length>14)console.log(`  …只列最近 14 天，共 ${allDays.length} 天`);

heading(`16 型分布（${played} 人）`);
const typeOf=r=>r.pattern.toUpperCase();
const complete=results.filter(r=>!r.pattern.includes('?'));
table(by(complete,typeOf),played);
const unsettled=results.filter(r=>r.pattern.includes('?'));
if(unsettled.length){console.log('  未定型（有軸是 ?）');table(by(unsettled,'pattern'),played);}

heading('四軸');
const axes=[['EI','E','I'],['SN','S','N'],['TF','T','F'],['JP','J','P']];
for(const [i,[name,left,right]] of axes.entries()){
 const count=test=>sum(results.filter(r=>test(r.pattern[i])));
 const l=count(c=>c?.toUpperCase()===left),r=count(c=>c?.toUpperCase()===right),q=count(c=>c==='?');
 const lean=count(c=>c===left.toLowerCase()||c===right.toLowerCase());
 console.log(`  ${name}  ${left} ${String(l).padStart(4)} ${pct(l,played)}   ${right} ${String(r).padStart(4)} ${pct(r,played)}   ? ${String(q).padStart(4)}   傾向（非明確）${pct(lean,l+r).trim()}`);
}

heading('稀有度');
const rarityNames={common:'普通',rare:'稀有',epic:'史詩',legendary:'傳說',unrated:'待鑑定'};
table(['legendary','epic','rare','common','unrated'].map(k=>[rarityNames[k],sum(results.filter(r=>r.rarity===k))]),played);

heading('最常用模型家族');
table(by(results,'family'),played);

heading('最常用客戶端');
table(by(results,'client'),played);
