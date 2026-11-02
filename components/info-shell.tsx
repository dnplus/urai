import type {ReactNode} from "react";
import {translator, locales, localeNames, type Locale} from "../lib/i18n.ts";
import {localized} from "../lib/site-content.ts";
import {CreatorLinks} from "./creator-links.tsx";

// Plain anchors on purpose: vinext's client-side <Link> navigation throws in this build, so every page change is a full load.
// Server-rendered frame for the public pages: plain links for crawlers, one language per URL, the disclaimer on every page.
export function InfoShell({locale, path, children}: {locale: Locale; path: string; children: ReactNode}) {
  const t = translator(locale);
  const nav: [string, string][] = [["/types", "16 種類型"], ["/levels", "卡片稀有度"], ["/method", "怎麼判斷"], ["/art-gallery", "插畫圖庫"]];
  return <div className="info-root" lang={locale}>
    <header className="info-header">
      <a className="brand" href={localized("/", locale)}><span aria-hidden="true">✧</span>{t("你的 AI 夥伴風格指南")}<span aria-hidden="true">✧</span></a>
      <nav aria-label={t("網站導覽")}>{nav.map(([href, label]) => <a key={href} href={href === "/art-gallery" ? href : localized(href, locale)} aria-current={path === href ? "page" : undefined}>{t(label)}</a>)}</nav>
    </header>
    <main className="info-page">{children}</main>
    <footer className="info-footer">
      <nav aria-label={t("語言")}>{locales.map((l) => <a key={l} href={localized(path, l)} hrefLang={l} aria-current={l === locale ? "true" : undefined}>{localeNames[l]}</a>)}</nav>
      <CreatorLinks t={t} locale={locale}/>
      <p>{t("並非人格測驗，與任何人格測驗機構無關；四碼只借用常見的 16 型命名，類型、規則與文案皆為本專案自訂。")}</p>
    </footer>
  </div>;
}
export function Cta({locale}: {locale: Locale}) {
  return <a className="primary info-cta" href={localized("/", locale)}>{translator(locale)("測測你的 Agent 是哪一型")}</a>;
}
export function JsonLd({data}: {data: unknown}) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(data).replace(/</g, "\\u003c")}}/>;
}
