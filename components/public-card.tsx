"use client";
import {ArrowRight} from "lucide-react";
import {useLocale, LocaleSwitch} from "./locale-provider.tsx";
import {HoloCard} from "./holo-card.tsx";
import {CreatorLinks} from "./creator-links.tsx";
import {personaFor} from "../lib/catalog.ts";
import {measuredCode} from "../lib/card-composition.ts";
import {rarityLabel} from "../lib/rarity.ts";
import type {PublicCard} from "../lib/public-card-service.ts";

export function PublicCardView({id, via, data}: {id: string; via: string; data: PublicCard | null}) {
  const {t, ready, locale} = useLocale();
  const card = data?.card;
  return <div className="app-root public-root" data-ready={ready}>
    <header className="journey-header"><div className="brand"><span aria-hidden="true">✧</span>{t("你的 AI 夥伴風格指南")}<span aria-hidden="true">✧</span></div></header>
    <main className="public-card-page">
      {data && card ? <section className="final-screen public-card">
        <div className="final-card-area"><div className="reveal-art"><HoloCard report={card} style={data.style} family={data.family} nicknameOnly={data.nicknameOnly}/></div></div>
        <div className="final-copy">
          <p className="eyebrow public-verified">{t("由網站依提交紀錄產生 · {date}", {date: new Date(data.createdAt).toISOString().slice(0, 10)})}</p>
          <h1>{card.nickname}</h1>
          {!data.nicknameOnly && <p className="final-subtitle">{measuredCode(card, t)} · {t(personaFor(card.assessment.type).name)} · {t(rarityLabel(card.usageLevel.value))}</p>}
          {!data.nicknameOnly && <div className="brief-reading">{card.brief.map((line) => <p key={line}>{t(line)}</p>)}</div>}
          <a className="primary public-cta" href={data.nicknameOnly ? `/?via=${via}` : `/?vs=${id}&via=${via}`}>{data.nicknameOnly ? t("測測你的 Agent 是哪一型") : t("測完和 {nickname} 比一比", {nickname: card.nickname})}<ArrowRight size={20}/></a>
          <p className="small-note">{t("這張卡由網站依當次提交的摘要畫出，和本人下載的圖片內容一致才是真的。摘要由本人的 Agent 在本機計算，網站無法檢視原始紀錄。")}</p>
        </div>
      </section> : <section className="screen recovery-screen">
        <div className="sealed-card" aria-hidden="true"><span>✧</span></div>
        <h1>{t("這張卡已撤回或過期。")}</h1>
        <a className="primary" href="/">{t("測測你的 Agent 是哪一型")}<ArrowRight size={20}/></a>
      </section>}
    </main>
    <footer className="journey-footer"><LocaleSwitch/><CreatorLinks t={t} locale={locale}/></footer>
  </div>;
}
