import {brandLink} from "../lib/creator.ts";
import type {Locale, Translate} from "../lib/i18n.ts";

// The brand credit: this tool is part of Ginseng Try Catch. Plain anchors so it renders the same on server pages and in the client app.
export function CreatorLinks({t, locale}: {t: Translate; locale: Locale}) {
  return <p className="creator-links">
    <a href={brandLink("/", locale)} target="_blank" rel="noopener">{t("人蔘 Try Catch 的作品")}</a>
    <a href={brandLink("/lab", locale)} target="_blank" rel="noopener">{t("更多小工具")}</a>
    <a href={brandLink("/newsletter", locale)} target="_blank" rel="noopener">{t("訂閱電子報")}</a>
  </p>;
}
