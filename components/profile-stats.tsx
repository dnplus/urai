"use client";
import {useLocale} from "./locale-provider.tsx";
import {compactNumber} from "../lib/objective-stats.ts";
import {modelLabels, clientLabels} from "../lib/catalog.ts";
import type {PublicProfile} from "../lib/public-card-service.ts";

// The published snapshot, row for row what the private report lists: counts the collector computed, nothing an agent judged.
export function ProfileStats({profile}: {profile: PublicProfile}) {
  const {t, locale} = useLocale();
  const {stats} = profile;
  const shown = (value: number | null, bound = false) => value === null ? null : (bound && stats.partial ? "≥ " : "") + compactNumber(value, locale);
  const pair = (a: string | null, b: string | null) => a === null && b === null ? null : (a ?? t("未知")) + " / " + (b ?? t("未知"));
  const rows = ([
    ["期間內工作階段", shown(stats.sessions)],
    ["輸入 / 輸出 tokens", pair(shown(stats.inputTokens), shown(stats.outputTokens))],
    ["自動化 / 子代理", pair(shown(stats.automation, true), shown(stats.subagents, true))],
    ["寫下 / 重用資產", pair(shown(stats.assetWrites, true), shown(stats.assetReuse, true))],
    ["最常用模型家族", profile.modelFamily === "unknown" ? null : t(modelLabels[profile.modelFamily])],
    ["最常用客戶端", profile.client === "unknown" ? null : t(clientLabels[profile.client])],
  ] as [string, string | null][]).filter((row): row is [string, string] => row[1] !== null);
  return <section className="profile-stats" aria-label={t("AI 工作履歷快照")}>
    <h2>{t("AI 工作履歷快照")}<small>{profile.observedPeriod.from} — {profile.observedPeriod.to}</small></h2>
    <dl className="metrics-list">{rows.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}
