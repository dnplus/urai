"use client";
import {ArrowRight} from "lucide-react";
import {useLocale, LocaleSwitch} from "./locale-provider.tsx";
import {HoloCard} from "./holo-card.tsx";
import {CompareView} from "./compare-view.tsx";
import {CreatorLinks} from "./creator-links.tsx";
import type {PublicCard} from "../lib/public-card-service.ts";

// Two public cards side by side. Either one being revoked closes the comparison.
export function ComparePageView({a, b, bId}: {a: PublicCard | null; b: PublicCard | null; bId: string}) {
  const {t, ready, locale} = useLocale();
  const both = a && b && !a.nicknameOnly && !b.nicknameOnly ? {a, b} : null;
  return <div className="app-root public-root" data-ready={ready}>
    <header className="journey-header"><a className="brand" href="/"><span aria-hidden="true">✧</span>{t("你的 AI 夥伴風格指南")}<span aria-hidden="true">✧</span></a></header>
    <main className="compare-page">
      {both ? <>
        <h1>{both.a.card.nickname} <span aria-hidden="true">×</span> {both.b.card.nickname}</h1>
        <div className="compare-cards">
          <HoloCard report={both.a.card} style={both.a.style} family={both.a.family}/>
          <HoloCard report={both.b.card} style={both.b.style} family={both.b.family}/>
        </div>
        <CompareView t={t} mine={{label: both.a.card.nickname, assessment: both.a.card.assessment}} theirs={{label: both.b.card.nickname, assessment: both.b.card.assessment}}/>
        <a className="primary public-cta" href={`/?vs=${bId}&via=link`}>{t("你也來比一比")}<ArrowRight size={20}/></a>
        <p className="small-note">{t("兩張卡都由網站依各自的提交紀錄畫出。")}</p>
      </> : <section className="screen recovery-screen">
        <div className="sealed-card" aria-hidden="true"><span>✧</span></div>
        <h1>{t("這組比較已失效：其中一張卡已撤回或過期。")}</h1>
        <a className="primary" href="/">{t("測測你的 Agent 是哪一型")}<ArrowRight size={20}/></a>
      </section>}
    </main>
    <footer className="journey-footer"><LocaleSwitch/><CreatorLinks t={t} locale={locale}/></footer>
  </div>;
}
