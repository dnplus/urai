"use client";
import { useLocale, LocaleSwitch } from "./locale-provider.tsx";
import {localized} from "../lib/site-content.ts";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Copy, Download, FileText, ShieldCheck, Sparkles, Terminal, X } from "lucide-react";
import {CardShare} from "./card-share.tsx";
import {Turnstile} from "./turnstile.tsx";
import {levelDescriptions,nextStepFor} from "../lib/usage-level.ts";
import { HoloCard } from "./holo-card.tsx";
import {CreatorLinks} from "./creator-links.tsx";
import {RARITY_LEAD, rarityLabel} from "../lib/rarity.ts";
import {CardShuffle} from "./card-shuffle.tsx";
import { usePersonaSession } from "./use-persona-session.ts";
import { collectorInstructions } from "../lib/collector-instructions.ts";
import {CollectorScopeOptions} from "./collector-scope-options.tsx";
import {createCollectorScope,collectorScopeSchema,defaultScopeOptions,scopeOptionsSchema,SESSION_TTL_MS,type CollectorScope} from "../lib/collector-scope.ts";
import { makeLevelFixture, demoReport } from "../lib/fixture.ts";
import { CAVEAT, toCardObservation, type Report } from "../lib/assessment.ts";
import { families, personas, personaFor, modelLabels, clientLabels, artFor, displayArt, artCounts, defaultFamily, type ArtStyle, type Family } from "../lib/catalog.ts";
import { axisDefinitions, letterLabels, letterTips, contextLabels } from "../lib/workstyle.ts";
import { downloadCard } from "../lib/export-card.ts";
import { selfContrast } from "../lib/card-composition.ts";
import { typeCodes, TURNSTILE_ACTION, type TypeCode } from "../lib/contract.ts";
import { describeProgress } from "../lib/collector-progress.ts";
import {noticeText} from "../lib/i18n.ts";
import {objectiveStats,compactNumber} from "../lib/objective-stats.ts";
import {useTeamInvite,type TeamInvite} from "./team-invite.ts";
import {usePublicLink} from "./public-link.ts";
import {useCompare} from "./use-compare.ts";
import {CompareView} from "./compare-view.tsx";
import {compareAssessments} from "../lib/compare.ts";
import {comparePost} from "../lib/share-kit.ts";
import { reportCollectorProgress, submitAuthorizedSummary } from "../lib/collector-runner.ts";
type Stage = "cover" | "identity" | "instructions" | "fixture" | "waiting" | "reveal";
// Origin and time zone never change while the page is open; the server renders the fallbacks.
const unchanging = () => () => {};
const browserOrigin = () => location.origin;
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const UI_KEY = "agent-mbti-view-v3";
const gaps: Record<string, string> = { web_history_unavailable: "未涵蓋網頁版對話", partial_window: "觀察期間不完整", no_artifact_inspection: "未檢視實作成果", no_tokscale: "沒有 Tokscale 彙總", unattributed_runs: "部分執行無法歸屬", insufficient_records: "紀錄不足", other_sources_missing: "其他工具尚未涵蓋" };
function ReportSummary({report}:{report:Report}){
  const {t,locale}=useLocale();
  const count=(value:number|null)=>value===null?t("未知"):value.toLocaleString(locale);
  const list=(values:string[])=>values.join(locale.startsWith("zh")||locale==="ja"?"、":", ");
  const {metrics}=report,stats=objectiveStats(report);
  // Counts from a system pass cut short by its budget are lower bounds; unknown counts and unsettled families stay hidden.
  const shown=(value:number|null,bound=false)=>value===null?null:(bound&&stats.partial?"≥ ":"")+compactNumber(value,locale);
  const pair=(a:string|null,b:string|null)=>a===null&&b===null?null:(a??t("未知"))+" / "+(b??t("未知"));
  const names:[string,string,Record<string,string>][]=[["最常用模型家族",metrics.mostUsedModelFamily,modelLabels],["最常用客戶端",metrics.mostUsedClient,clientLabels]];
  const rows=([
    ["期間內工作階段",shown(stats.sessions)],
    ["輸入 / 輸出 tokens",pair(shown(stats.inputTokens),shown(stats.outputTokens))],
    ["自動化 / 子代理",pair(shown(stats.automation,true),shown(stats.subagents,true))],
    ["寫下 / 重用資產",pair(shown(stats.assetWrites,true),shown(stats.assetReuse,true))],
    ...names.filter(([,key])=>key!=="unknown").map(([label,key,labels])=>[label,t(labels[key])]),
  ] as [string,string|null][]).filter((row):row is [string,string]=>row[1]!==null);
  return <>
    <details className="report-details"><summary><FileText size={22} aria-hidden="true"/><span><b>{t("完整觀察報告")}</b><small>{t("四軸怎麼判斷、稀有度從哪來、這次看了多少紀錄")}</small></span><ChevronDown className="report-chevron" size={18} aria-hidden="true"/></summary><div className="report-content">
      <p className="report-period">{report.observedPeriod.from} — {report.observedPeriod.to}</p>
      <h2>{t("卡片稀有度")} · {t(rarityLabel(report.usageLevel.value))}</h2><p>{t(report.usageLevel.basis?levelDescriptions[report.usageLevel.basis]:"使用等級尚待更多成果線索。")}</p>
      <h2>{t("你怎麼帶它，它怎麼做事。")}</h2>
      {report.assessment.axes.map((axis,i)=><section className="axis-finding" key={axis.axis}>
        <h3>{t(axisDefinitions[i].name)} · {axis.value==="?"?t(letterLabels["?"]):axis.value+" "+t(letterLabels[axis.value])}{axis.strength==="lean"&&" · "+t("傾向")}</h3>
        <p>{t(axis.value==="?"?axisDefinitions[i].prompt:letterTips[axis.value])}</p>
      </section>)}
      <h2>{t("這次看到了多少？")}</h2><p>{t("證據覆蓋：{scope}。判讀 {judged} 段對話，掃過 {read} 個紀錄；來源：{sources}。",{scope:t(report.coverage.scope==="adequate"?"涵蓋授權範圍":report.coverage.scope==="partial"?"部分資料":"資料不足"),judged:stats.judged,read:count(stats.read),sources:list(report.coverage.sources.map(s=>t(clientLabels[s])))||t("尚未取得")})}</p>
      {rows.length>0&&<dl className="metrics-list">{rows.map(([label,value])=><div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl>}
      <details className="evidence-details"><summary>{t("看任務脈絡")}</summary>{report.tasks.map(task=><section className="task-evidence" key={task.id}><h3>{task.id} · {t(contextLabels[task.context])}</h3><p>{task.date} · {t(clientLabels[task.source])}</p></section>)}</details>
      <h2>{t("還沒看到的部分")}</h2><p>{report.coverage.gaps.length?list(report.coverage.gaps.map(g=>t(gaps[g])))+(locale.startsWith("zh")||locale==="ja"?"。":"."):t("沒有回報額外缺口；不代表已讀取所有紀錄。")} {t("網站只檢查 Agent 摘要的一致性，沒有檢視原始紀錄。")}</p>
      <p className="fineprint">{t(CAVEAT)}{t("每軸只看你的訊息，每個任務選一邊；少於三個任務或打平就保留問號。用量與模型家族不參與分型。")}</p>
    </div></details>
  </>;
}
function TeamShare({invite,sessionId,onShare,onWithdraw}:{invite:TeamInvite;sessionId:string;onShare:(member:string)=>Promise<string>;onWithdraw:()=>Promise<string>}){
  const {t,locale}=useLocale();
  const [member,setMember]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const shared=invite.shared?.sessionId===sessionId?invite.shared:null;
  async function run(action:()=>Promise<string>){setBusy(true);setError(await action());setBusy(false);}
  return <section className="team-share" aria-live="polite">
    <p className="team-share-title">{t(shared?"已分享到「{team}」看板":"分享到「{team}」看板",{team:invite.name})}</p>
    {shared?<div className="team-share-row"><span>{t("顯示名稱：{member}",{member:shared.member})}</span><button className="quiet-button" disabled={busy} onClick={()=>run(onWithdraw)}>{t("撤回分享")}</button></div>
    :<><p className="team-share-note">{t("會分享卡片、等級，以及工作階段、token、自動化等統計，不含任何對話內容，可隨時撤回。")}</p>
      <form className="team-share-row" onSubmit={e=>{e.preventDefault();void run(()=>onShare(member.trim()));}}><input aria-label={t("你在團隊中的名字")} placeholder={t("你在團隊中的名字")} value={member} maxLength={24} required onChange={e=>setMember(e.target.value)}/><button className="primary" disabled={busy||!member.trim()}>{t("分享")}</button></form></>}
    {error&&<p className="small-note" role="status">{noticeText(locale,error)}</p>}
  </section>;
}
export function PersonaApp({turnstileSiteKey}:{turnstileSiteKey:string}) {
    const { t, locale, ready: localeReady } = useLocale();
    const flow = usePersonaSession();
    const team = useTeamInvite();
    const compare = useCompare();
    const [stage, setStage] = useState<Stage>("cover");
    const [nickname, setNickname] = useState("");
    const [style, setStyle] = useState<ArtStyle>("chibi");
    const [family, setFamily] = useState<Family>("codex");
    const [nicknameOnly, setNicknameOnly] = useState(false);
    const [manual, setManual] = useState(false);
    const [copied, setCopied] = useState(false);
    const [notice, setNotice] = useState("");
    const [turnstileToken, setTurnstileToken] = useState("");
    const [turnstileMount, setTurnstileMount] = useState(0);
    const [exporting, setExporting] = useState(false);
    const [demo, setDemo] = useState(false);
    const [resumeMode, setResumeMode] = useState(false);
    const [fixtureConsent, setFixtureConsent] = useState(false);
    const [sending, setSending] = useState(false);
    const origin = useSyncExternalStore(unchanging, browserOrigin, () => "");
    const timeZone = useSyncExternalStore(unchanging, browserTimeZone, () => "UTC");
    const [scopeOptions,setScopeOptions]=useState(defaultScopeOptions);
    const [collectionScope,setCollectionScope]=useState<CollectorScope|null>(null);
    const [selfType,setSelfType]=useState<TypeCode|null>(null);
    const about = useRef<HTMLDialogElement>(null);
    const focus = useRef<HTMLElement>(null);
    const received = useRef<string | null>(null);
    const initialized = useRef(false);
    const restoreStage = useRef<Stage | null>(null);
    const fixtureKey = useRef("");
    const active = flow.session;
    const result = flow.result;
    const publicLink = usePublicLink(result ? {resultId: result.id, ...(active?.id === result.id ? {sessionId: active.id, readToken: active.readToken} : {})} : null);
    const card = result?.card ?? toCardObservation(demoReport);
    const expired = !!active && flow.expired && !result;
    const progress = stage === "identity" ? 1 : ["instructions", "fixture", "waiting"].includes(stage) ? 2 : 3;
    const effectiveScope=active?(collectionScope??createCollectorScope(active.expiresAt-SESSION_TTL_MS,timeZone)):null;
    const instructions = active ? collectorInstructions(active, origin, resumeMode, locale,effectiveScope!) : "";
    const agentState = describeProgress(flow.agentProgress, flow.clock, locale);
    useEffect(() => {
        if (!flow.ready || initialized.current)
            return;
        initialized.current = true;
        if (active) {
            // Resume the tab's own view of this session once the stored session has loaded.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setNickname(active.nickname);
            setStage("instructions");
            try {
                const saved = JSON.parse(sessionStorage.getItem(UI_KEY) ?? "null");
                if (saved?.id === active.id) {
                    if (saved.stage === "reveal") restoreStage.current = "reveal";
                    if (["regular", "chibi"].includes(saved.style))
                        setStyle(saved.style);
                    if (families.some(f => f.id === saved.family))
                        setFamily(saved.family);
                    setNicknameOnly(saved.nicknameOnly === true);
                    setDemo(saved.demo === true);
                    setResumeMode(saved.resumeMode === true);
                    const scope=collectorScopeSchema.safeParse(saved.collectionScope);
                    if(scope.success){setCollectionScope(scope.data);setScopeOptions(scope.data.options);}
                    setSelfType(typeCodes.find(code=>code===saved.selfType)??null);
                }
            }
            catch { }
        }
    }, [flow.ready, active]);
    useEffect(() => {
        if (!result || received.current === result.id)
            return;
        received.current = result.id;
        if (!restoreStage.current)
            setFamily(defaultFamily(result.card.modelFamily, result.report?.metrics.mostUsedClient));
        setStage("reveal");
        restoreStage.current = null;
        setNotice("");
        setManual(false);
    }, [result, active]);
    useEffect(() => {
        if (active && initialized.current) {
            try {
                sessionStorage.setItem(UI_KEY, JSON.stringify({ id: active.id, stage, style, family, nicknameOnly, demo, resumeMode,collectionScope,selfType }));
            }
            catch { }
        }
    }, [active, stage, style, family, nicknameOnly, demo, resumeMode,collectionScope,selfType]);
    useEffect(() => {
        if (!flow.ready)
            return;
        window.scrollTo({ top: 0, behavior: "instant" });
        const timer = setTimeout(() => focus.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }), 50);
        return () => clearTimeout(timer);
    }, [stage, flow.ready]);
    function go(next: Stage) { setNotice(""); flow.setError(""); setStage(next); }
    function back() {
        const previous: Record<Stage, Stage> = { cover: "cover", identity: "cover", instructions: "identity", fixture: "instructions", waiting: "instructions", reveal: "cover" };
        go(previous[stage]);
    }
    function start() {
        if (result)
            go("reveal");
        else if (flow.lastResult){ flow.openLast(); go("reveal"); }
        else if (active)
            go("instructions");
        else
            go("identity");
    }
    // The comparison link needs this person's own public card, so sharing it creates (or reuses) one.
    async function shareCompare() {
        const theirs = compare.target;
        if (!theirs?.assessment) return;
        const mine = await publicLink.ensure({family, style, nicknameOnly: false, locale});
        if (!mine) { setNotice("暫時無法處理，請稍後再試。"); return; }
        const result = compareAssessments(card.assessment, theirs.assessment);
        const url = origin + "/vs/" + theirs.id + "/" + mine.id;
        const text = comparePost(theirs.nickname, result.kind, result.same, result.known, url, locale);
        try {
            if (navigator.share) { await navigator.share({text}); return; }
        } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
        try { await navigator.clipboard.writeText(text); setNotice("比較連結已複製。"); } catch { setNotice("無法自動複製，請選取下方文字。"); }
    }
    async function startNew(){if(await flow.startFresh()){received.current=null;restoreStage.current=null;setNickname("");setResumeMode(false);setDemo(false);setNicknameOnly(false);setCollectionScope(null);setSelfType(null);sessionStorage.removeItem(UI_KEY);go("identity");}}
    async function create(event: FormEvent) {
        event.preventDefault();
        setNotice("");
        if (active && !flow.expired) {
            go("instructions");
            return;
        }
        if(!scopeOptionsSchema.safeParse(scopeOptions).success){setNotice("請選擇至少一個來源，觀察天數需為 1–365 天。");return;}
        const next = await flow.create({nickname}, turnstileToken);
        setTurnstileToken("");
        setTurnstileMount(n => n + 1);
        if (next) {
            if(!resumeMode||!collectionScope)setCollectionScope(createCollectorScope(next.expiresAt-SESSION_TTL_MS,timeZone,scopeOptions));
            fixtureKey.current = crypto.randomUUID();
            setNicknameOnly(false);
            setSelfType(null);
            setFixtureConsent(false);
            setManual(false);
            go("instructions");
        }
    }
    async function copy() {
        try {
            await navigator.clipboard.writeText(instructions);
            // Stay on this page: if the clipboard is lost, the prompt is still one click away.
            setCopied(true);
            setNotice("已複製，貼到你的 Agent。");
        }
        catch {
            setManual(true);
            setNotice("自動複製未成功，請選取下方指令手動複製。");
        }
    }
    // The scope only shapes the prompt, so it can change after the link exists; the copy button then copies the new prompt.
    function changeScope(next: typeof scopeOptions) {
        setScopeOptions(next);
        setCopied(false);
        if (active && scopeOptionsSchema.safeParse(next).success) setCollectionScope(createCollectorScope(active.expiresAt - SESSION_TTL_MS, timeZone, next));
    }
    async function erase(next: Stage = "cover") {
        if (await flow.erase()) {
            sessionStorage.removeItem(UI_KEY);
            received.current = null;
            restoreStage.current = null;
            setFixtureConsent(false);
            setManual(false);
            setNotice("");
            setStage(next);
            if (next === "cover") {
                setDemo(false);
                setResumeMode(false);
                setNickname("");
                setScopeOptions(defaultScopeOptions());setCollectionScope(null);setSelfType(null);
            }
            about.current?.close();
            return true;
        }
        return false;
    }
    async function renew() {
        if (await erase("identity"))
            setResumeMode(true);
    }
    async function sendFixture() {
        if (!active?.writeToken || !fixtureConsent || sending)
            return;
        setSending(true);
        setNotice("");
        try {
            fixtureKey.current ||= crypto.randomUUID();
            const sample = makeLevelFixture(active.nickname);
            const target = { origin, id: active.id, writeToken: active.writeToken, expiresAt: active.expiresAt, nickname: active.nickname };
            const grant = { scopeApproved: true as const, sourceOwnershipConfirmed: true as const, origin, sessionId: active.id, expiresAt: active.expiresAt, nickname: active.nickname, sources: sample.coverage.sources, period: sample.observedPeriod };
            go("waiting");
            await reportCollectorProgress(grant, target, { sequence: 1, phase: "validating", approvalKind: null });
            const outcome = await submitAuthorizedSummary(sample, grant, target, fixtureKey.current);
            if (outcome.status !== "accepted")
                throw new Error(outcome.status === "expired" ? "這個連結已失效，請換新連結後重新授權。" : "範例尚未確認送達，請重試。");
            flow.retry();
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setSending(false);
        }
    }
    async function exportPng() {
        if (!result)
            return;
        setExporting(true);
        setNotice("");
        try {
            await downloadCard(result.card, style, family, nicknameOnly, publicLink.link?.url ?? origin + "/", locale);
            setNotice("圖片已準備下載，含角色署名與授權。");
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setExporting(false);
        }
    }
    // Silent until there is something to say: the agent reported a step, needs a host approval, or the site lost its connection.
    const reported = flow.agentProgress.phase !== "not_connected";
    const waitingPanel = <>
        {(reported || flow.connection === "retrying") && <div className={"waiting-status " + flow.connection} role="status"><i />{flow.connection === "retrying" ? t("網站暫時連不上收件服務") : agentState.title}</div>}
        {flow.agentProgress.phase === "awaiting_host_approval" && !agentState.stale && <p className="lead waiting-explanation">{agentState.details}</p>}
    </>;
    return <div className="app-root" data-ready={flow.ready && localeReady} data-stage={stage} inert={!flow.ready || !localeReady}>
    <header className="journey-header">
      {stage !== "cover" && stage!=="reveal" && <button className="back-button" aria-label={t("返回上一步")} disabled={flow.busy || sending} onClick={back}><ArrowLeft size={22}/></button>}
      <div className="brand"><span aria-hidden="true">✧</span>{t("你的 AI 夥伴風格指南")}<span aria-hidden="true">✧</span></div>
      {demo && stage !== "cover" && <span className="demo-badge">{t("示範")}</span>}
    </header>
    {stage !== "cover" && stage !== "reveal" && <div className="journey-progress" aria-label={t("第 {step} 個階段，共 3 個階段",{step:progress})}><div><i style={{ width: `${progress / 3 * 100}%` }}/></div><span>{progress} / 3</span></div>}
    <main ref={focus} className={`journey journey-${stage}`}>
      {compare.target&&(stage==="cover"||stage==="identity")&&<p className="team-pill"><span>{t("測完會和 {nickname} 比一比",{nickname:compare.target.nickname})}</span><button className="quiet-button" onClick={compare.leave}>{t("不比了")}</button></p>}
      {team.invite&&(stage==="cover"||stage==="identity")&&<p className="team-pill"><span>{t("團隊觀察 · {team}",{team:team.invite.name})}</span><button className="quiet-button" onClick={team.leave}>{t("不參加")}</button></p>}
      {stage === "cover" && <section className="cover-screen screen" aria-labelledby="cover-title">
        <h1 id="cover-title" tabIndex={-1}>{t("你的 Agent，")}<br />{t("是哪種夥伴風格？")}</h1>
        <p className="cover-tagline">{t("讓你的 Agent 讀完你們的對話，")}<br className="mobile-break"/>{t("說說你是哪種搭檔。")}</p><div className="cover-art"><HoloCard report={toCardObservation(demoReport)} style="chibi" family="codex" nicknameOnly teaser/></div>
        <button className="primary" onClick={start}>{flow.lastResult ? t("打開上次的卡片") : active ? t("繼續這次觀察") : t("開始觀察")}<ArrowRight size={22}/></button><ul className="cover-promises"><li><Terminal size={15} aria-hidden="true"/>{t("用 Claude Code、Codex 等 Agent")}</li><li><ShieldCheck size={15} aria-hidden="true"/>{t("對話不離開你的電腦")}</li><li><Sparkles size={15} aria-hidden="true"/>{t("免登入，抽一張角色卡")}</li></ul>{flow.lastResult&&<div className="remembered-actions"><button className="quiet-button" onClick={startNew}>{t("開始新的觀察")}</button><button className="quiet-button" onClick={()=>erase()}>{t("清除上次結果")}</button></div>}
      </section>}
      {stage !== "cover" && expired ? <section className="screen recovery-screen"><div className="sealed-card" aria-hidden="true"><span>✧</span></div><h1 tabIndex={-1}>{t("這道光，")}<br />{t("暫時收起了。")}</h1><p className="lead">{t("連結已到期或失效。請讓 Agent 保留已整理的最小摘要，")}<br />{t("換新連結後，只需明確核准新的收件目的地。")}</p><button className="primary" disabled={flow.busy} onClick={renew}>{t("沿用分析，換新連結")}<ArrowRight size={20}/></button></section> : <>
      {stage === "identity" && <section className="identity-screen screen">
        <img className="identity-art" src={displayArt(artFor("codex", "INTJ", "chibi"))!} alt=""/>
        <h1 tabIndex={-1}>{active ? <>{t("你的連結，")}<br />{t("還在等你。")}</> : <>{t("這位搭檔，")}<br />{t("該怎麼稱呼？")}</>}</h1>{resumeMode && !active && <p className="small-note renewal-note">{t("將建立新的收件連結。舊連結不延長；新指令會要求你明確核准新目的地，已保存的最小摘要可繼續使用。")}</p>}
        <form onSubmit={create} className="identity-form">
          <label className="sr-only" htmlFor="nickname">{t("Agent 的名字")}</label><input id="nickname" className="nickname-input" autoComplete="off" placeholder={t("Agent 的名字")} value={active?.nickname ?? nickname} onInvalid={e=>e.currentTarget.setCustomValidity(t("請填寫 Agent 的名字。"))} onInput={e=>e.currentTarget.setCustomValidity("")} onChange={e => setNickname(e.target.value)} required maxLength={24} readOnly={!!active}/>
          <p className="field-caption">{t("這個名字會出現在卡片上")}</p>
          {!active&&<Turnstile key={turnstileMount} siteKey={turnstileSiteKey} action={TURNSTILE_ACTION} language={locale.toLowerCase()} onToken={setTurnstileToken} onError={()=>setNotice("人機驗證載入失敗，請重新整理頁面。")}/>}
          <button className="primary wide" disabled={flow.busy||!active&&!turnstileToken}>{flow.busy ? t("建立中…") : active ? t("繼續這個連結") : t("建立我的連結")}<ArrowRight size={20}/></button>
        </form>
      </section>}
      {stage === "instructions" && active && <section className="instructions-screen screen">
        <CardShuffle/>
        <h1 tabIndex={-1}>{demo ? <>{t("先選好，")}<br />{t("這次觀察的範圍。")}</> : <>{t("把這段指令，")}<br />{t("交給你的 Agent。")}</>}</h1>
        {demo ? <p className="lead">{t("使用虛構資料，走過同一個收件流程。")}</p> : <ol className="handoff-steps">{["複製專屬指令","貼到 Claude Code、Codex 等 Agent","它問你時，回覆「同意」"].map((step,i)=><li key={step}><b aria-hidden="true">{i+1}</b>{t(step)}</li>)}</ol>}
        {active.writeToken ? <>
          <button className="primary" disabled={!demo&&!scopeOptionsSchema.safeParse(scopeOptions).success} onClick={demo ? () => go("fixture") : copy}>{demo ? t("查看示範範圍") : copied ? t("再複製一次") : t("複製專屬指令")}{demo ? <ArrowRight size={20}/> : <Copy size={19}/>}</button>
          {!demo && !resumeMode && <CollectorScopeOptions value={scopeOptions} onChange={changeScope} timeZone={timeZone}/>}
          {!demo && <details className="instruction-disclosure" open={manual} onToggle={e => setManual(e.currentTarget.open)}><summary>{t("查看／手動複製指令")}</summary><textarea className="instruction-box" aria-label={t("貼給 Agent 的指令")} value={instructions} readOnly onFocus={e => e.currentTarget.select()}/></details>}
        </> : <button className="primary" disabled={flow.busy} onClick={renew}>{t("重新取得指令")}<Copy size={19}/></button>}
        {!demo && waitingPanel}
      </section>}
      {stage === "fixture" && active && <section className="fixture-screen screen">
        <p className="eyebrow">{t("虛構資料 · 沒有讀取你的紀錄")}</p><h1 tabIndex={-1}>{t("一次同意，")}<br />{t("接著等它揭曉。")}</h1><p className="lead">{t("確認這次範圍，剩下的自動完成。")}</p>
        <div className="scope-card"><p><b>{t("來源與期間")}</b><span>{t("網站內建的 3 個虛構任務，2026/10/01–10/09。沒有你的對話。")}</span></p><p><b>{t("傳送內容")}</b><span>{t("暱稱、日期、來源與缺口、用量彙總、抽象任務與四軸判斷、階段狀態。")}</span></p><p><b>{t("目的地")}</b><span>{t("目前網站的這個收件連結，有效至 {time}。",{time:new Date(active.expiresAt).toLocaleTimeString(locale,{hour12:false})})}</span></p></div>
        <label className="check-field"><input type="checkbox" checked={fixtureConsent} onChange={e => setFixtureConsent(e.target.checked)}/>{t("我同意此範圍的虛構摘要自動驗證並傳送。")}</label>
        <button className="primary" disabled={!fixtureConsent || sending} onClick={sendFixture}>{sending ? t("處理中…") : t("同意並開始示範")}<ArrowRight size={20}/></button>
      </section>}
      {stage === "waiting" && <section className="waiting-screen screen">
        <CardShuffle/>
        <h1 tabIndex={-1}>{flow.connection === "retrying" ? <>{t("正在重新連上，")}<br />{t("請稍等一下。")}</> : <>{t("等它帶回，")}<br />{t("你們的合作線索。")}</>}</h1>
        {waitingPanel}
      </section>}
      {stage === "reveal" && result && <section className="reveal-screen screen final-screen">
        <div className="final-card-area"><div className="reveal-art"><HoloCard report={card} style={style} family={family} nicknameOnly={nicknameOnly} reveal/></div><div className="style-switch" aria-label={t("卡片畫風")}><button aria-pressed={style==="regular"} onClick={()=>setStyle("regular")}>{t("一般")}</button><button aria-pressed={style==="chibi"} onClick={()=>setStyle("chibi")}>{t("Q 版")}</button></div></div>
        <div className="final-copy">{card.kind==="fixture"&&<p className="eyebrow">{t("示範資料 · 非個人評估")}</p>}<h1 tabIndex={-1}>{card.nickname}</h1><p className="final-subtitle">{t(personaFor(card.assessment.type).name)}</p>{selfContrast(card,t)&&<p className="self-contrast">{selfContrast(card,t)}</p>}<div className="brief-reading">{card.brief.map(line=><p key={line}>{t(line)}</p>)}</div><p className="next-step"><b>{t("下一步")}</b><span>{t(nextStepFor(card.usageLevel))}</span></p>{compare.target?.assessment&&!nicknameOnly&&<CompareView t={t} mine={{label:t("你"),assessment:card.assessment}} theirs={{label:compare.target.nickname,assessment:compare.target.assessment}}>{card.kind==="observed"&&<button className="secondary-action" disabled={publicLink.linking} onClick={shareCompare}>{t("分享比較結果")}</button>}</CompareView>}{team.invite&&card.kind==="observed"&&active&&<TeamShare invite={team.invite} sessionId={active.id} onShare={member=>team.share(active.id,active.readToken,member)} onWithdraw={team.withdraw}/>}
        <div className="final-actions"><button className="primary" onClick={exportPng} disabled={exporting||!!card.assessment.type&&!artFor(family,card.assessment.type,style)}>{exporting?t("製作圖片中…"):t("下載我的角色卡")}<Download size={20}/></button><CardShare card={card} style={style} family={family} nicknameOnly={nicknameOnly} home={origin+"/"} link={publicLink.link} linking={publicLink.linking} onCreateLink={()=>publicLink.create({family,style,nicknameOnly,locale})} onRevokeLink={publicLink.revoke}/></div>
        {result.report&&<div className="inline-report"><ReportSummary report={result.report}/></div>}
        <details className="card-options"><summary>{t("卡片選項")}</summary><div><label htmlFor="card-family">{t("卡面主題")}</label><select id="card-family" value={family} onChange={e=>setFamily(e.target.value as Family)}>{families.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select><label className="check-field"><input type="checkbox" checked={nicknameOnly} onChange={e=>setNicknameOnly(e.target.checked)}/>{t("只顯示暱稱，隱藏分型")}</label><p>{t("此選項也會隱藏等級與短句。")}</p></div></details>
        <div className="result-management"><button className="quiet-button" onClick={startNew}>{t("開始新的觀察")}</button><button className="quiet-button" disabled={flow.busy} onClick={()=>erase()}>{t("清除這次結果")}</button></div>{flow.rememberError&&<p className="small-note">{t("此裝置暫時無法記住結果，請先下載卡片。")}</p>}</div>
      </section>}
      </>}
      {(flow.error || notice) && <p className="inline-notice" role="status">{noticeText(locale,flow.error || notice)}</p>}
    </main>
    <footer className="journey-footer"><LocaleSwitch /><button onClick={() => about.current?.showModal()}>{t("關於這份觀察")}</button><a className="journey-link" href={localized("/types",locale)}>{t("16 種類型")}</a><CreatorLinks t={t} locale={locale}/></footer>
    <dialog ref={about} className="about-dialog" aria-labelledby="about-title"><button className="icon-button dialog-close" onClick={() => about.current?.close()} aria-label={t("關閉說明")}><X size={22}/></button><h2 id="about-title">{t("你怎麼帶它，")}<br />{t("它就怎麼做事。")}</h2><p>{t("這是一段以授權使用紀錄為依據的合作觀察。借用四組字母，以自訂規則描述合作風格，並非人格測驗。網站只接收你事前明確授權範圍內的最小摘要，授權後自動驗證與傳送。")}</p>
      <details><summary>{t("觀察依據與 16 種風格")}</summary><p>{t("借用 E/I 思考方式、S/N 指令焦點、T/F 驗收依據、J/P 工作框架，只看你帶 Agent 時說了什麼。這不是人格診斷，也不是模型的固定性格。")}</p><p>{t("每個任務每軸選一邊，看不出來就跳過。少於三個任務或打平保留問號，差距不大標成傾向。舊結果需要重新分析。")}<a href="/collector/SKILL.md" target="_blank" rel="noreferrer">{t("完整觀察方式 ↗")}</a></p><div className="about-types">{Object.entries(personas).map(([code, p]) => <div key={code}><b>{code}</b><span>{t(p.name)}</span></div>)}</div></details>
      <details><summary>{t("稀有度怎麼來")}</summary><p>{t(RARITY_LEAD)}</p></details>
      <details><summary>{t("角色來源與非商業授權")}</summary><p>{t("六個家族 × 16 型 × 一般／Q 版，共 192 格專屬插畫。目前")}{artCounts.ready}{t("張完成")}{artCounts.complete ? t("。") : t("，其餘製作中，缺圖不以其他型替代。")}{t("插畫依構圖選配，與分型計算獨立。Codex 使用 GPT 娘的同人改編，並非官方 Codex 角色。圖片改編參考")}<a href="https://github.com/Apprentice-Geo/AI-Fanworks/tree/main/ApprenTice/images" target="_blank" rel="noreferrer">ApprenTice</a>{t("；角色原作參考 ZipZipPipe，DeepSeek 另含上善無形。")}</p><p>{t("AI 輔助再創作，")}<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a>{t("，限非商業、署名及相同方式分享。上游權利鏈尚未全面核實，沒有模型業者背書。")}</p><a href="/art-provenance.md" target="_blank" rel="noreferrer">{t("完整素材來源 ↗")}</a><br /><a href="/art-gallery">{t("瀏覽全部插畫圖庫 ↗")}</a></details>
      <details><summary>{t("資料如何使用")}</summary><p>{t("提交連結 30 分鐘後失效。此裝置可用安全 Cookie 開啟最近結果，最長保留 7 天；可隨時清除。原始紀錄與提交權杖不存入瀏覽器儲存空間，結果沒有公開網址。")}</p><p>{t("不需登入，也不收集 Email。結果只能由建立連結的這個瀏覽器讀取，除非你主動分享到團隊看板；分享的只有卡片與統計，可隨時撤回。Agent 只能透過短效專屬連結提交一次摘要，不能讀取結果。")}</p></details>
      {!active && <button className="quiet-button demo-entry" onClick={() => { setDemo(true); setNickname(t("示範搭檔")); about.current?.close(); go("identity"); }}>{t("使用虛構資料體驗")}<ArrowRight size={16}/></button>}
      {(active||flow.lastResult) && <button className="quiet-button danger-action" disabled={flow.busy} onClick={() => erase()}>{t("結束觀察並刪除資料")}</button>}
      {flow.error && <p role="alert">{noticeText(locale,flow.error)}</p>}
    </dialog>
  </div>;
}
