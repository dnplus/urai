"use client";
import {useEffect, useState} from "react";
import {ArrowLeft} from "lucide-react";
import {useLocale, LocaleSwitch} from "./locale-provider.tsx";
import {CreatorLinks} from "./creator-links.tsx";
import {noticeText} from "../lib/i18n.ts";
import type {ConsentState} from "./oauth-consent.tsx";

// Where a visitor sees which apps may read the public profile, and takes that back.
export function OAuthGrants() {
  const {t, ready, locale} = useLocale();
  const [state, setState] = useState<ConsentState | null>(null);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const response = await fetch("/api/remembered/oauth", {cache: "no-store", redirect: "error"});
      if (!response.ok) throw new Error();
      setState(await response.json() as ConsentState);
    } catch { setNotice("暫時無法處理，請稍後再試。"); }
  }
  // The list lives on the server and is read with this browser's cookies, so it loads after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/remembered/oauth?grant=" + encodeURIComponent(id), {method: "DELETE", redirect: "error"});
      if (!response.ok && response.status !== 404) setNotice("暫時無法處理，請稍後再試。");
      else { setNotice("授權已撤銷。"); setConfirm(""); await load(); }
    } catch { setNotice("暫時無法處理，請稍後再試。"); }
    setBusy(false);
  }
  const card = state?.result?.card;
  return <div className="app-root public-root oauth-root" data-ready={ready}>
    <header className="journey-header"><a className="back-button" href="/" aria-label={t("回到觀察")}><ArrowLeft size={22}/></a><div className="brand"><span aria-hidden="true">✧</span>{t("你的 AI 夥伴風格指南")}<span aria-hidden="true">✧</span></div></header>
    <main className="oauth-page">
      <section className="screen oauth-screen" data-state={state ? "ready" : "loading"}>
        <h1>{t("已授權的應用")}</h1>
        <p className="lead">{t("這些應用可以讀取你的公開 AI 工作履歷快照。撤銷後，它手上的權杖立刻失效。")}</p>
        {state && (state.grants.length === 0 ? <p className="oauth-empty">{t("這個瀏覽器目前沒有授權任何應用。")}</p>
          : <ul className="oauth-grants">{state.grants.map((grant) => <li key={grant.id}>
            <div><b>{grant.client}</b><small>{t("授權於 {date}", {date: new Date(grant.createdAt).toISOString().slice(0, 10)})} · profile.read</small></div>
            {confirm === grant.id
              ? <button className="quiet-button danger-action" disabled={busy} onClick={() => void revoke(grant.id)}>{t("確定撤銷")}</button>
              : <button className="quiet-button" onClick={() => setConfirm(grant.id)}>{t("撤銷授權")}</button>}
          </li>)}</ul>)}
        {card && <p className="small-note">{card.profile ? t("履歷快照目前公開在你的卡片頁。") : t("履歷快照目前沒有公開，已授權的應用也讀不到。")} <a href={"/c/" + card.id}>{t("查看公開卡片頁")}</a></p>}
        {notice && <p className="inline-notice" role="status">{noticeText(locale, notice)}</p>}
        <p className="small-note">{t("授權記在這個瀏覽器裡。換了瀏覽器或清除 Cookie 後，可以回到原本的應用解除綁定，或撤回公開卡片讓所有授權失效。")}</p>
      </section>
    </main>
    <footer className="journey-footer"><LocaleSwitch/><CreatorLinks t={t} locale={locale}/></footer>
  </div>;
}
