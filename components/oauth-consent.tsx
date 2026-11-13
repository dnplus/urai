"use client";
import {useEffect, useState} from "react";
import {ArrowRight} from "lucide-react";
import {useLocale, LocaleSwitch} from "./locale-provider.tsx";
import {CreatorLinks} from "./creator-links.tsx";
import {ProfileStats} from "./profile-stats.tsx";
import {noticeText} from "../lib/i18n.ts";
import type {AuthorizeParams} from "../lib/oauth-service.ts";
import type {PublicProfile} from "../lib/public-card-service.ts";

export type ConsentState = {result: {nickname: string; shareable: boolean; snapshot: PublicProfile; card: {id: string; profile: boolean} | null} | null; grants: {id: string; client: string; createdAt: number}[]};
type ConsentRequest = {params: AuthorizeParams; clientName: string; redirectHost: string; denyUrl: string};

export function OAuthConsent({request}: {request: ConsentRequest | null}) {
  const {t, ready, locale} = useLocale();
  const [state, setState] = useState<ConsentState | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!request) return;
    let active = true;
    fetch("/api/remembered/oauth", {cache: "no-store", redirect: "error"}).then(async (r) => { const data = await r.json() as ConsentState; if (active) { if (r.ok) setState(data); else setNotice("暫時無法處理，請稍後再試。"); } }).catch(() => { if (active) setNotice("暫時無法處理，請稍後再試。"); });
    return () => { active = false; };
  }, [request]);
  const result = state?.result, isPublic = !!result?.card?.profile;
  async function allow() {
    if (!request || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/remembered/oauth", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({...request.params, publish: !isPublic, locale}), redirect: "error"});
      const data = await response.json().catch(() => ({})) as {redirect?: string; error?: string};
      if (response.ok && data.redirect) { location.assign(data.redirect); return; }
      setNotice(data.error ?? "暫時無法處理，請稍後再試。");
    } catch { setNotice("暫時無法處理，請稍後再試。"); }
    setBusy(false);
  }
  return <div className="app-root public-root oauth-root" data-ready={ready}>
    <header className="journey-header"><div className="brand"><span aria-hidden="true">✧</span>{t("你的 AI 夥伴風格指南")}<span aria-hidden="true">✧</span></div></header>
    <main className="oauth-page">
      {!request ? <section className="screen oauth-screen">
        <h1>{t("這個授權連結無效。")}</h1>
        <p className="lead">{t("應用程式沒有登記，或回傳網址和登記的不一樣。為了安全，不會把你帶回去。")}</p>
        <a className="primary" href="/">{t("回到首頁")}<ArrowRight size={20}/></a>
      </section> : <section className="screen oauth-screen" data-state={!state ? "loading" : !result ? "empty" : "ready"}>
        <p className="eyebrow">{t("授權請求")}</p>
        <h1>{t("「{app}」想讀取你的公開 AI 工作履歷", {app: request.clientName})}</h1>
        <p className="oauth-host">{t("同意後會回到 {host}", {host: request.redirectHost})}</p>
        {state && !result && <>
          <p className="lead">{t("這個瀏覽器裡沒有最近 7 天的觀察結果。請先完成一次觀察，再回到應用程式重新授權。")}</p>
          <a className="primary" href="/">{t("開始觀察")}<ArrowRight size={20}/></a>
          <a className="quiet-button" href={request.denyUrl}>{t("取消並返回")}</a>
        </>}
        {result && !result.shareable && <>
          <p className="lead">{t("示範資料或舊版結果不能公開。請重新觀察後再授權。")}</p>
          <a className="quiet-button" href={request.denyUrl}>{t("取消並返回")}</a>
        </>}
        {result?.shareable && <>
          <div className="oauth-card">
            <p className="oauth-who">{t("{nickname} 的履歷快照", {nickname: result.nickname})}</p>
            <ProfileStats profile={result.snapshot}/>
            <ul className="oauth-scope">
              <li>{t("會讀到：上面這些數字、觀察期間、產生日期，以及公開卡片頁的網址與卡面內容。")}</li>
              <li>{t("讀不到：私人報告、任務內容、對話、你的 Email 或任何帳號資料。")}</li>
              <li>{t("可隨時在「已授權的應用」撤銷；撤回公開卡片也會一併失效。")}</li>
            </ul>
            {!isPublic && <p className="oauth-publish">{result.card ? t("你的履歷快照目前沒有公開。按下同意會把上面的數字加到你的公開卡片頁，任何拿到連結的人都看得到。") : t("你還沒有公開卡片。按下同意會建立公開卡片頁並附上上面的數字，任何拿到連結的人都看得到。")}</p>}
          </div>
          <button className="primary" disabled={busy} onClick={() => void allow()}>{busy ? t("處理中…") : isPublic ? t("允許") : t("公開並允許")}<ArrowRight size={20}/></button>
          <a className="quiet-button" href={request.denyUrl}>{t("不允許")}</a>
        </>}
        {notice && <p className="inline-notice" role="status">{noticeText(locale, notice)}</p>}
        <p className="small-note"><a href="/oauth/grants">{t("管理已授權的應用")}</a></p>
      </section>}
    </main>
    <footer className="journey-footer"><LocaleSwitch/><CreatorLinks t={t} locale={locale}/></footer>
  </div>;
}
