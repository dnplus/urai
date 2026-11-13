import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import messages from "../lib/messages.json" with {type:"json"};
import copy from "../lib/collector-copy.json" with {type:"json"};
import {locales,resolveLocale,translate,noticeText,bodyFonts} from "../lib/i18n.ts";
import {collectorInstructions,collectorConfirmation} from "../lib/collector-instructions.ts";
import {createCollectorScope,SESSION_TTL_MS} from "../lib/collector-scope.ts";
import {COLLECTOR_SCRIPT_SHA256} from "../lib/collector-script-hash.ts";
import {describeProgress} from "../lib/collector-progress.ts";
import {artSlots} from "../lib/art-catalog.ts";

test("browser language priority, region/script variants and explicit fallback",()=>{
  for(const [input,expected] of [[["zh-Hant-HK"],"zh-TW"],[["zh-CN"],"zh-CN"],[["zh-Hans"],"zh-CN"],[["zh-SG"],"zh-CN"],[["zh"],"zh-TW"],[["ja-JP"],"ja"],[["ko-KR"],"ko"],[["fr-FR","en-GB"],"en"],[["ko","ja"],"ko"],[[],"en"]] as const)assert.equal(resolveLocale(input),expected);
});
test("all authored UI, report, art and error strings have four complete translations with matching parameters",()=>{
  const dictionary=messages as Record<string,string[]>;
  const params=(text:string)=>[...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m=>m[1]).sort();
  for(const [key,values] of Object.entries(dictionary)){
    assert.equal(values.length,4,key);
    for(const text of values){assert.ok(text.trim(),key);assert.deepEqual(params(text),params(key),key);}
  }
  for(const file of ["components/persona-app.tsx","components/collector-scope-options.tsx","components/holo-card.tsx","components/art-gallery.tsx","components/locale-provider.tsx","lib/catalog.ts","lib/workstyle.ts","lib/collector-progress.ts","lib/session-service.ts","lib/abuse-guard.ts","lib/assessment.ts","lib/export-card.ts","lib/card-composition.ts","lib/usage-level.ts","components/card-share.tsx","components/team-app.tsx","components/team-invite.ts","lib/team-service.ts","lib/objective-stats.ts","components/public-card.tsx","components/public-link.ts","lib/public-card-service.ts","lib/share-kit.ts","lib/og-image.tsx","lib/og-text.ts","components/info-shell.tsx","lib/site-content.ts","app/types/page.tsx","app/types/[code]/page.tsx","app/levels/page.tsx","app/method/page.tsx","app/page.tsx","lib/compare.ts","components/compare-view.tsx","components/compare-page.tsx","components/creator-links.tsx","app/vs/[a]/[b]/page.tsx","app/c/[id]/page.tsx","components/profile-stats.tsx","components/oauth-consent.tsx","components/oauth-grants.tsx","lib/oauth-service.ts"]){
    const sf=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=(node:ts.Node)=>{
      if((ts.isStringLiteral(node)||ts.isJsxText(node))&&/[\u3400-\u9fff]/.test(node.text)){
        const source=node.text.replace(/\s+/g," ").trim();
        if(!["、上善無形","。","，"].includes(source))assert.ok(dictionary[source],file+": "+source);
      }
      ts.forEachChild(node,visit);
    };visit(sf);
  }
  for(const slot of artSlots){assert.ok(dictionary[slot.theme]);assert.ok(dictionary[slot.description]);}
});
test("parameters retain names and codes literally without recursive translation, and unexpected errors stay private",()=>{
  assert.equal(translate("en","這次偏向 {type}。",{type:"INTJ"}),"This time, leaning toward INTJ.");
  const name="月 {type} 빛";assert.ok(translate("en","{name}卡片，{style}，使用方向鍵或拖曳旋轉",{name,style:"Chibi"}).includes(name));
  for(const locale of locales){assert.ok(!noticeText(locale,"secret-path /private/actual-user-data").includes("private"));assert.notEqual(noticeText(locale,"請檢查暱稱、Email 與結果用途同意。"),"");}
});
test("every localized collector prompt points at one verified script and one skill",()=>{
  const session={id:"public-test-id",nickname:"Lumi 月 빛",readToken:"NEVER_REVEAL_READ_CAPABILITY",writeToken:"WRITE_ONLY_TEST_TOKEN",expiresAt:Date.parse("2026-10-10T12:30:00Z")};
  const scope=createCollectorScope(session.expiresAt-SESSION_TTL_MS);
  const origin="http://127.0.0.1:5188";
  const skill=fs.readFileSync("public/collector/SKILL.md","utf8");
  for(const part of ["Read only the user turns as evidence.","T001","\"axes\": { \"EI\"","24 KiB","Idempotency-Key","awaiting_host_approval","agent-workstyle-v2","Myers & Briggs Foundation","Fewer than 3 picks","differ by at least 2","`version` is `3.0`"])assert.ok(skill.includes(part),part);
  for(const part of ["collaborative_iteration","ownerRequest","both_available","O001","agent-workstyle-v1"])assert.ok(!skill.includes(part),part);
  for(const locale of locales){
    const prompt=collectorInstructions(session,origin,false,locale);
    const renewal=collectorInstructions(session,origin,true,locale);
    const lines=prompt.split("\n");
    const read=`Read ${origin}/collector/SKILL.md, download ${origin}/collector/collect.py, verify sha256 ${COLLECTOR_SCRIPT_SHA256}, then follow SKILL.md.`;
    assert.equal(lines.length,6);
    assert.equal(lines[0],copy[locale].intro);
    assert.equal(lines[1],copy[locale].destination.replace("{origin}",origin).replace("{id}",session.id).replace("{nickname}",session.nickname).replace("{expires}","2026-10-10T12:30:00.000Z"));
    assert.equal(lines[2],copy[locale].token.replace("{token}",session.writeToken));
    assert.equal(lines[3],`from=${scope.from} to=${scope.to} tz=UTC sources=codex,claude-code,antigravity,cursor,chatgpt,other tokscale=install`);
    assert.equal(lines[4],read);
    assert.equal(lines[5],collectorConfirmation(scope,locale));
    assert.deepEqual(renewal.split("\n"),[...lines.slice(0,5),copy[locale].renew,lines[5]]);
    assert.equal(prompt.includes(session.nickname),true);
    assert.equal(prompt.includes(JSON.stringify(session.nickname)),false);
    assert.equal(prompt.includes("NEVER_REVEAL_READ_CAPABILITY"),false);
    assert.equal(prompt.includes("{origin}"),false);
    assert.equal(prompt.includes("{nickname}"),false);
    assert.notEqual(prompt,renewal);
    assert.ok(bodyFonts[locale].includes("sans-serif"));
  }
});
test("real approval and stale progress are localized independently of the observed state",()=>{
  const progress={phase:"awaiting_host_approval" as const,sequence:1,updatedAt:1000,approvalKind:"network" as const};
  for(const locale of locales){
    const active=describeProgress(progress,1001,locale),stale=describeProgress(progress,91001,locale);
    assert.equal(active.title,translate(locale,"Agent 回報需要主機核准"));
    assert.ok(active.details.includes(translate(locale,"連線")));
    assert.equal(stale.title,translate(locale,"暫時沒有新的進度"));
    assert.equal(stale.stale,true);
  }
});
