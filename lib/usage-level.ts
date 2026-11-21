import {z} from 'zod';
import type {Submission} from './contract.ts';
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
export const usageSignals=['unchecked_adoption','retry_after_error','useful_result_verified','context_scoped','acceptance_defined','targeted_correction_verified'] as const;
export const usageEvidenceSchema=z.object({version:z.literal('usage-level-v2'),observations:z.array(z.object({task:z.string().regex(/^T(00[1-9]|01[0-9]|02[0-4])$/),signal:z.enum(usageSignals)}).strict()).max(64)}).strict();
export const systemEvidenceSchema=z.object({automationSessions:count,subagentSessions:count,automationSpanDays:count,assetWriteSessions:count,assetReuseSessions:count,assetMaintainedAfterAutomation:count,gearKinds:z.number().int().min(0).max(4).nullable(),filesScanned:count,filesListed:count}).strict();
export const usageBases=['unchecked_adoption','retry_after_error','verified_results','scoped_correction','reused_assets','maintained_automation'] as const;
export const usageLevelSchema=z.object({version:z.literal('usage-level-v2'),value:z.number().int().min(0).max(5).nullable(),basis:z.enum(usageBases).nullable()}).strict();
export type UsageLevel=z.infer<typeof usageLevelSchema>;
type Basis=typeof usageBases[number];
type SystemEvidence=z.infer<typeof systemEvidenceSchema>;
type Evidence={system:SystemEvidence|undefined;tasks:(signal:typeof usageSignals[number])=>Set<string>};
export const levelNames=['直接採用','試探修正','穩定交付','精準協作','重用實作','維運系統'] as const;
export const levelDescriptions:Record<Basis,string>={unchecked_adoption:'有結果未經必要查核就直接採用。',retry_after_error:'發現出錯後，換個做法再試一次。',verified_results:'至少兩個獨立任務的結果經確認可用。',scoped_correction:'同一任務先講清範圍與完成標準，再驗證一處具體修正。',reused_assets:'寫下的技能、規則或腳本，被其他工作階段再次使用。',maintained_automation:'自動化無人值守跑了兩週以上，期間資產仍持續維護。'};
// One concrete habit that would satisfy the next rung of the ladder below.
export const nextSteps:Record<'unknown'|0|1|2|3|4|5,string>={unknown:'做完一件事後，親手確認結果真的能用，卡片就有線索可鑑定。',0:'發現結果不對時，指出哪裡錯，換個做法再試一次。',1:'在兩個不同任務裡，親自確認結果真的可用，例如跑測試或實際用一次。',2:'同一個任務先講清楚範圍和完成標準，再驗證一處具體修正。',3:'把常用的做法寫成技能、規則或腳本，讓其他工作階段也能重用。',4:'讓自動化靠排程、CI 或 hook 跑上兩週，期間持續維護那些資產。能讓事情來叫它，就別定時空轉。',5:'已是傳說卡。定期檢查自動化的產出，別讓它默默走樣。'};
export const nextStepFor=(level:UsageLevel)=>nextSteps[(level.value??'unknown') as keyof typeof nextSteps];
const atLeast=(value:number|null|undefined,minimum:number)=>value!=null&&value>=minimum;
const reusesAssets=({system}:Evidence)=>atLeast(system?.assetWriteSessions,1)&&atLeast(system?.assetReuseSessions,2);
const ladder:readonly {value:number;basis:Basis;holds:(evidence:Evidence)=>boolean}[]=[
 {value:5,basis:'maintained_automation',holds:e=>reusesAssets(e)&&atLeast(e.system?.automationSessions,3)&&atLeast(e.system?.automationSpanDays,14)&&atLeast(e.system?.gearKinds,1)&&atLeast(e.system?.assetMaintainedAfterAutomation,1)},
 {value:4,basis:'reused_assets',holds:reusesAssets},
 {value:3,basis:'scoped_correction',holds:({tasks})=>[...tasks('context_scoped')].some(task=>tasks('acceptance_defined').has(task)&&tasks('targeted_correction_verified').has(task))},
 {value:2,basis:'verified_results',holds:({tasks})=>tasks('useful_result_verified').size>=2},
 {value:1,basis:'retry_after_error',holds:({tasks})=>tasks('retry_after_error').size>0},
 {value:0,basis:'unchecked_adoption',holds:({tasks})=>tasks('unchecked_adoption').size>0},
];
export function deriveUsageLevel(data:Pick<Submission,'tasks'|'coverage'|'usageEvidence'|'systemEvidence'>):UsageLevel{
 if(data.coverage.scope==='insufficient')return {version:'usage-level-v2',value:null,basis:null};
 const known=new Set(data.tasks.filter(t=>t.source!=='unknown').map(t=>t.id));
 const rows=(data.usageEvidence?.observations??[]).filter(o=>known.has(o.task));
 const tasks=(signal:typeof usageSignals[number])=>new Set(rows.filter(o=>o.signal===signal).map(o=>o.task));
 const rung=ladder.find(rule=>rule.holds({system:data.systemEvidence,tasks}));
 return {version:'usage-level-v2',value:rung?.value??null,basis:rung?.basis??null};
}
