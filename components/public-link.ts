"use client";
import {useState} from "react";
import type {ArtStyle, Family} from "../lib/catalog.ts";
import type {Locale} from "../lib/i18n.ts";

// The verifiable link for one result, shared by the download button and the share dialog; the revoke token lives in this tab only.
export type PublicLink = {id: string; url: string; revokeToken: string; look: string; profile?: boolean};
export type LinkSource = {resultId: string; sessionId?: string; readToken?: string};
const KEY = "agent-mbti-public-card-v1";
function stored(resultId: string): PublicLink | null { try { return (JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, PublicLink>)[resultId] ?? null; } catch { return null; } }
function store(resultId: string, link: PublicLink | null) {
  try { const all = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, PublicLink>; if (link) all[resultId] = link; else delete all[resultId]; sessionStorage.setItem(KEY, JSON.stringify(all)); } catch { /* the link still works; this tab just forgets its revoke token */ }
}
export const lookOf = (family: Family, style: ArtStyle, nicknameOnly: boolean) => JSON.stringify([family, style, nicknameOnly]);

export function usePublicLink(source: LinkSource | null) {
  const [link, setLink] = useState<{resultId: string; value: PublicLink | null} | null>(null);
  const [linking, setLinking] = useState(false);
  const current = source ? (link?.resultId === source.resultId ? link.value : stored(source.resultId)) : null;
  // includeProfile left out keeps whatever the card already publishes.
  async function make(options: {family: Family; style: ArtStyle; nicknameOnly: boolean; locale: Locale; includeProfile?: boolean}): Promise<{message: string; value: PublicLink | null}> {
    if (!source || linking) return {message: "", value: null};
    setLinking(true);
    try {
      const response = await fetch("/api/remembered/card", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({...(source.sessionId && source.readToken ? {sessionId: source.sessionId, readToken: source.readToken} : {}), ...options}), redirect: "error"});
      const data = await response.json().catch(() => ({})) as {id?: string; url?: string; revokeToken?: string; profile?: boolean; error?: string};
      if (!response.ok || !data.id || !data.url || !data.revokeToken) return {message: data.error ?? "暫時無法處理，請稍後再試。", value: null};
      const value = {id: data.id, url: data.url, revokeToken: data.revokeToken, look: lookOf(options.family, options.style, options.nicknameOnly), profile: !!data.profile};
      store(source.resultId, value); setLink({resultId: source.resultId, value});
      return {message: current ? "公開卡片已更新。" : "可驗證連結已建立。", value};
    } catch { return {message: "暫時無法處理，請稍後再試。", value: null}; } finally { setLinking(false); }
  }
  const create = async (options: Parameters<typeof make>[0]) => (await make(options)).message;
  // The compare link needs this person's own public card; reuse it when one exists.
  const ensure = async (options: Parameters<typeof make>[0]) => current ?? (await make(options)).value;
  async function revoke() {
    if (!source || !current || linking) return "";
    setLinking(true);
    try {
      const response = await fetch("/api/cards/" + current.id, {method: "DELETE", headers: {Authorization: "Bearer " + current.revokeToken}, redirect: "error"});
      if (!response.ok && response.status !== 404) return "暫時無法處理，請稍後再試。";
      store(source.resultId, null); setLink({resultId: source.resultId, value: null});
      return "連結已撤回。";
    } catch { return "暫時無法處理，請稍後再試。"; } finally { setLinking(false); }
  }
  return {link: current, linking, create, ensure, revoke};
}
