"use client";
import {useEffect, useMemo, useState, type FormEvent} from "react";
import {ArrowLeft, Copy, RefreshCw} from "lucide-react";
import {useLocale, LocaleSwitch} from "./locale-provider.tsx";
import {Turnstile} from "./turnstile.tsx";
import {TURNSTILE_ACTION} from "../lib/contract.ts";
import {artFor, displayArt, defaultFamily, personaFor, modelLabels, clientLabels} from "../lib/catalog.ts";
import {CreatorLinks} from "./creator-links.tsx";
import {rarityFor, rarityLabel, rarityNames, rarityOrder, UNRATED} from "../lib/rarity.ts";
import {compactNumber} from "../lib/objective-stats.ts";
import {noticeText} from "../lib/i18n.ts";
import type {TeamSnapshot} from "../lib/team-service.ts";

type Entry = {id: string; member: string; createdAt: number; snapshot: TeamSnapshot};
type Board = {id: string; name: string; joinCode: string; createdAt: number; expiresAt: number; entries: Entry[]};
type Key = {id: string; token: string};
const keyFrom = (hash: string): Key | null => { const m = hash.match(/^#([0-9a-f-]{36})\.([0-9a-f]{64})$/); return m ? {id: m[1], token: m[2]} : null; };
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

function Code({snapshot}: {snapshot: TeamSnapshot}) {
  return <span className="team-code">{snapshot.assessment.axes.map((axis) => <span key={axis.axis} className={axis.strength === "lean" ? "lean" : ""}>{axis.value}</span>)}</span>;
}

function Member({name, entries, onRemove}: {name: string; entries: Entry[]; onRemove: (id: string) => Promise<void>}) {
  const {t, locale} = useLocale();
  const [confirm, setConfirm] = useState("");
  const [latest, ...earlier] = entries;
  const s = latest.snapshot, level = s.usageLevel.value;
  const art = artFor(defaultFamily(s.modelFamily, s.client), s.assessment.type, "chibi");
  const n = (value: number | null, bound = false) => value === null ? "—" : (bound && s.stats.partial ? "≥ " : "") + compactNumber(value, locale);
  const tokens = s.stats.inputTokens === null && s.stats.outputTokens === null ? "—" : compactNumber((s.stats.inputTokens ?? 0) + (s.stats.outputTokens ?? 0), locale);
  return <article className="team-member" data-rarity={rarityFor(level)}>
    <div className="team-member-art">{art ? <img src={displayArt(art, "thumb")!} alt="" loading="lazy"/> : <span aria-hidden="true">✧</span>}</div>
    <div className="team-member-body">
      <header><h2>{name}</h2><span className="team-level">{t(rarityLabel(level))}<small>{t("卡片稀有度")}</small></span></header>
      <p className="team-type"><Code snapshot={s}/> <span>{t(personaFor(s.assessment.type).name)}</span> · <span className="team-agent">{s.nickname}</span></p>
      <dl className="team-stats">
        <div><dt>{t("工作階段")}</dt><dd>{n(s.stats.sessions)}</dd></div>
        <div><dt>tokens</dt><dd>{tokens}</dd></div>
        <div><dt>{t("自動化")}</dt><dd>{n(s.stats.automation, true)}</dd></div>
        <div><dt>{t("重用資產")}</dt><dd>{n(s.stats.assetReuse, true)}</dd></div>
      </dl>
      <p className="team-meta">{[s.modelFamily !== "unknown" ? t(modelLabels[s.modelFamily]) : "", s.client !== "unknown" ? t(clientLabels[s.client]) : "", s.observedPeriod.from + " — " + s.observedPeriod.to].filter(Boolean).map((part, i) => <span key={part}>{i > 0 && " · "}{part}</span>)}</p>
      {earlier.length > 0 && <ol className="team-history" aria-label={t("過去的分享")}>{earlier.map((e) => <li key={e.id}>{day(e.createdAt)} · {e.snapshot.assessment.pattern} · LV {e.snapshot.usageLevel.value ?? "?"}</li>)}</ol>}
      <footer><span>{t("分享於 {date}", {date: day(latest.createdAt)})}</span>{entries.map((e) => e.id).includes(confirm)
        ? <button className="quiet-button danger-action" onClick={() => void onRemove(confirm)}>{t("確定移除")}</button>
        : <button className="quiet-button" onClick={() => setConfirm(latest.id)}>{t("移除")}</button>}</footer>
    </div>
  </article>;
}

export function TeamApp({turnstileSiteKey}: {turnstileSiteKey: string}) {
  const {t, locale, ready} = useLocale();
  const [key, setKey] = useState<Key | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [mount, setMount] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [origin, setOrigin] = useState("");

  async function load(next: Key) {
    setBusy(true);
    try {
      const response = await fetch(`/api/teams/${next.id}`, {headers: {Authorization: `Bearer ${next.token}`}, cache: "no-store", redirect: "error"});
      const data = await response.json() as Board & {error?: string};
      if (response.ok) { setBoard(data); setNotice(""); } else { setBoard(null); setNotice(data.error ?? "看板不存在或已失效。"); }
    } catch { setNotice("暫時無法處理，請稍後再試。"); }
    setBusy(false);
  }
  useEffect(() => {
    const sync = () => {
      const next = keyFrom(location.hash);
      setOrigin(location.origin);
      setKey(next);
      if (next) void load(next);
    };
    sync();
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/teams", {method: "POST", headers: {"Content-Type": "application/json", "CF-Turnstile-Response": token}, body: JSON.stringify({name: name.trim()}), redirect: "error"});
      const data = await response.json() as {id?: string; viewToken?: string; error?: string};
      if (response.ok && data.id && data.viewToken) location.hash = `${data.id}.${data.viewToken}`;
      else setNotice(data.error ?? "暫時無法處理，請稍後再試。");
    } catch { setNotice("暫時無法處理，請稍後再試。"); }
    setToken(""); setMount((m) => m + 1); setBusy(false);
  }
  async function remove(path: string) {
    if (!key) return;
    const response = await fetch(path, {method: "DELETE", headers: {Authorization: `Bearer ${key.token}`}, redirect: "error"});
    if (!response.ok) { setNotice("暫時無法處理，請稍後再試。"); return; }
    if (path === `/api/teams/${key.id}`) { history.replaceState(null, "", "/team"); setKey(null); setBoard(null); setConfirmDelete(false); setNotice("看板已刪除。"); }
    else void load(key);
  }
  async function copy(text: string, done: string) {
    try { await navigator.clipboard.writeText(text); setNotice(done); } catch { setNotice("自動複製未成功，請選取下方文字手動複製。"); }
  }

  const members = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const entry of board?.entries ?? []) groups.set(entry.member, [...(groups.get(entry.member) ?? []), entry]);
    return [...groups.entries()];
  }, [board]);
  const latest = members.map(([, entries]) => entries[0].snapshot);
  const tally = (letter: string) => latest.filter((s) => s.assessment.axes.some((axis) => axis.value === letter)).length;
  const rarities = [null, ...rarityOrder].map((rarity) => [rarity, latest.filter((s) => rarity === null ? s.usageLevel.value === null : s.usageLevel.value !== null && rarityFor(s.usageLevel.value) === rarity).length] as const).filter(([, count]) => count > 0);
  const invite = board ? `${origin}/?team=${board.joinCode}` : "";

  return <div className="app-root team-root" data-ready={ready}>
    <header className="journey-header"><a className="back-button" href="/" aria-label={t("回到觀察")}><ArrowLeft size={22}/></a><div className="brand"><span aria-hidden="true">✧</span>{t("團隊看板")}<span aria-hidden="true">✧</span></div></header>
    <main className="team-page">
      {!key && <section className="screen team-create">
        <h1>{t("建立團隊看板")}</h1>
        <p className="lead">{t("成員用邀請連結測完後，可以自己選擇分享到這裡。看板只顯示卡片與統計，不含任何對話內容。")}</p>
        <form onSubmit={create} className="identity-form">
          <input className="nickname-input" aria-label={t("看板名稱")} placeholder={t("看板名稱")} value={name} maxLength={24} required onChange={(e) => setName(e.target.value)}/>
          <Turnstile key={mount} siteKey={turnstileSiteKey} action={TURNSTILE_ACTION} language={locale.toLowerCase()} onToken={setToken} onError={() => setNotice("人機驗證載入失敗，請重新整理頁面。")}/>
          <button className="primary wide" disabled={busy || !token || !name.trim()}>{busy ? t("建立中…") : t("建立看板")}</button>
        </form>
        <p className="small-note">{t("看板保留 180 天。數字由成員本機的 collect.py 自動計算，網站無法驗證原始紀錄。")}</p>
      </section>}
      {key && board && <section className="team-board">
        <div className="team-head">
          <div><h1>{board.name}</h1><p className="small-note">{t("{count} 位成員 · 保留到 {date}", {count: members.length, date: day(board.expiresAt)})}</p></div>
          <button className="quiet-button" disabled={busy} onClick={() => void load(key)}><RefreshCw size={15}/>{t("重新整理")}</button>
        </div>
        <div className="team-links">
          <div><b>{t("邀請成員")}</b><p>{t("把這個連結傳給成員，測完後由他們自己決定要不要分享。")}</p><code>{invite}</code><button className="secondary-action" onClick={() => void copy(invite, "邀請連結已複製。")}><Copy size={16}/>{t("複製邀請連結")}</button></div>
          <div><b>{t("看板網址")}</b><p>{t("這個網址就是看板的鑰匙，請收藏，只分享給管理者。")}</p><button className="secondary-action" onClick={() => void copy(location.href, "看板網址已複製。")}><Copy size={16}/>{t("複製看板網址")}</button></div>
        </div>
        {members.length > 0 && <div className="team-summary">
          <p>{rarities.map(([rarity, count]) => <span key={String(rarity)} className="team-chip" data-rarity={rarity ?? "common"}>{t(rarity ? rarityNames[rarity] : UNRATED)} × {count}</span>)}</p>
          <p>{[["E", "I"], ["S", "N"], ["T", "F"], ["J", "P"]].map(([a, b]) => <span key={a} className="team-chip">{a} {tally(a)} · {b} {tally(b)}</span>)}</p>
        </div>}
        {members.length === 0 ? <p className="team-empty">{t("還沒有人分享。把邀請連結傳給成員吧。")}</p>
          : <div className="team-grid">{members.map(([member, entries]) => <Member key={member} name={member} entries={entries} onRemove={(id) => remove(`/api/teams/${key.id}/entries/${id}`)}/>)}</div>}
        <p className="small-note team-footnote">{t("數字由成員本機的 collect.py 自動計算，網站無法驗證原始紀錄；看趨勢比看單次更有意義。")}</p>
        <div className="team-danger">{confirmDelete
          ? <><span>{t("刪除後所有分享都會消失，無法復原。")}</span><button className="quiet-button danger-action" onClick={() => void remove(`/api/teams/${key.id}`)}>{t("確定刪除看板")}</button><button className="quiet-button" onClick={() => setConfirmDelete(false)}>{t("取消")}</button></>
          : <button className="quiet-button" onClick={() => setConfirmDelete(true)}>{t("刪除看板")}</button>}</div>
      </section>}
      {notice && <p className="inline-notice" role="status">{noticeText(locale, notice)}</p>}
    </main>
    <footer className="journey-footer"><LocaleSwitch/><CreatorLinks t={t} locale={locale}/></footer>
  </div>;
}
