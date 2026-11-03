# 你的 AI 夥伴風格指南

Your AI Partner Style Guide：讓你的 Agent 讀自己的本機紀錄，看你帶它做事的方式屬於 16 型中的哪一型，拿到一張可驗證、可分享的角色卡。

由 [dnplus](https://ginseng.dnplus.dev) 製作。

以本人授權的使用紀錄，觀察你帶領 Agent 的合作方式。三個主步驟：命名與選填偏好 → 將專屬指令交給自己的 Agent → 同一屏揭曉完整卡片、簡短解讀與完整報告。一般／Q 版切換、下載、分享都留在第三步。

不需登入，也不收集 Email。每次觀察建立一組匿名會話：讀取權杖只留在建立連結的瀏覽器，寫入權杖只交給 Agent 提交一次摘要。部署在自己的 Cloudflare 帳號（Workers + D1 + 靜態資源），正式網址為 https://urai.dnplus.dev 。

## 本機使用

需要 Node 22.13 以上。

```sh
npm ci
cp .dev.vars.example .dev.vars   # Turnstile 測試用 secret，永遠通過
npm run build
npm run db:migrate:local         # 套用 drizzle/*.sql 到 .wrangler/state 的本機 D1
npm run preview                  # 已建置的 Worker：http://127.0.0.1:5188
```

開發時可改用 `npm run dev`（Vite + HMR）。改了 `wrangler.jsonc` 後執行 `npm run cf-typegen` 更新 `worker-configuration.d.ts`。改了 `db/schema.ts` 後執行 `npm run db:generate` 產生新 migration。

本機用 Cloudflare 公開的 Turnstile 測試金鑰（`wrangler.jsonc` 的 `TURNSTILE_SITE_KEY` 預設值與 `.dev.vars.example`），不連線任何遠端資源。

## 部署

正式站是 https://urai.dnplus.dev（Worker 自訂網域）。舊網址 `agent-mbti.dnplus.workers.dev` 的頁面由 `proxy.ts` 301 轉到新網域；`/api` 與 `/collector` 不轉，讓執行中的 Agent 照舊送出。D1 `agent-mbti` 已綁在 `wrangler.jsonc`，Turnstile secret 已設在 Worker 上，正式 site key 由 `npm run deploy` 以 `--var` 帶入，所以本機一直用測試金鑰。

每次更新只需 `npm run deploy`；有新 migration 時先跑 `npm run db:migrate:remote`。部署到別的帳號或網域時，要換掉 `wrangler.jsonc` 的 `database_id`、deploy 指令裡的 site key，並重設 `TURNSTILE_SECRET_KEY`。

## 濫用防護

- 建立連結（人按下按鈕、會產生權杖的那一步）需要 Turnstile；伺服器以 siteverify 驗證 secret、action `create_session` 與主機名稱。
- 每個 IP（`CF-Connecting-IP`）每分鐘最多建立 5 個連結；Agent 的提交與進度回報每分鐘 60 次。超過回 429 並在介面顯示當地語言的提示。Agent 端不需 Turnstile。
- 沒有全站會話總量上限：任何固定上限都可能被分散來源灌滿，或在正常流量高峰擋下真人。會話 30 分鐘到期，過期資料在下次建立時清除。

## 判定與資料

借用常見的 16 型四碼，描述你帶 Agent 的方式（`agent-workstyle-v2`）。只看你的訊息，不看 Agent 自己的習慣；規則、門檻、稱號及描述是本專案的定義，並非心理測驗。

- E/I 思考方式：邊聊邊想（在對話裡理清想法，看中間結果改方向或範圍）／想好再說（先把目標與限制想清楚，一次交代，之後少插手）。
- S/N：給具體做法（檔案、步驟、指令、範例）／給目標與方向，路線交給 Agent。
- T/F：以明確檢查驗收（測試、數字、規格、差異）／以感受、品味、受眾體驗驗收。沒有驗收就是 unclear。
- J/P：當成有結構或會留下來的工作（計畫、流程、可重用資產）／開放式探索、一次性使用。

每個任務每軸強迫選一邊或 `unclear`。伺服器每軸只數非 unclear 的選擇：少於 3 個或打平為 `?`；多數勝出，勝方 ×3 ≥ 總數 ×2 且差至少 2 為 clear，其餘為 lean（卡面以淡色標示）。四個字母都有結果才成為 16 型代碼。使用者不會看到百分比或次數。tokens、模型家族與客戶端不參與分型。伺服器另外拒收 collect.py 不可能產生的數字（例如自動化工作階段多於掃描的檔案、任務多於讀過的紀錄），能擋下隨手改過的摘要，擋不住刻意的偽造。

**卡片稀有度**和類型分開判定，對外只顯示普通、稀有、史詩、傳說或待鑑定，不顯示數字等級。內部依 `usage-level-v2` 分成六階證據：前四階看 Agent 在授權紀錄中看到的人為證據（未查核就採用、出錯後重試、兩個獨立任務確認結果可用、同一任務先講清範圍與完成標準再驗證修正），後兩階只看 `collect.py` 計算並原樣帶入摘要的 `systemEvidence`：史詩需至少一個工作階段寫下技能、規則或腳本等資產，且至少兩個工作階段用到其他階段寫下的資產；傳說另需至少三個自動化工作階段、跨度 14 天以上、至少一種排程／CI／hook／heartbeat 機制，以及自動化開始後仍有資產更新。看不出證據時是待鑑定，不會落到普通。

[觀察設計](docs/DESIGN.md)、[collector 技能](public/collector/SKILL.md)、[空白模板](public/collector-template.json)、[JSON schema](public/collector-schema.json)、[第三方聲明](THIRD_PARTY_NOTICES.md)。schema 3.0 的每個 task 帶 `axes`，可選 `usageEvidence` 與 `systemEvidence`；缺少時卡片保持待鑑定。更早的舊型別不會被偷偷轉成新的四碼。

## 已實作

- Vinext（Vite 上的 Next.js App Router）、React、Cloudflare Workers、D1；會話有效 30 分鐘，讀寫分離的 256-bit 權杖，只存雜湊。私人讀取只需讀取權杖。
- 外部 Agent 的 callback 只需其短效寫入權杖，不能讀取結果。一次原子提交、相同 key／內容可重試；嚴格 JSON、24 KiB 上限、來源／日期／引用與結果一致性驗證。
- 三步流程、真實進度、返回、斷線重試、到期換新目的地；寫入權杖不持久保存。30 分鐘不是掃描耗時保證。
- 最近結果保存最多 7 天，以 HttpOnly、SameSite=Strict、HTTPS Secure 且限 `/api/remembered` 的 Cookie 讀取。可清除或開始新觀察。localStorage 只有語言偏好；sessionStorage 有短效讀取權限及介面偏好，不含原始紀錄。
- 同一套 SVG composition 驅動預覽和 PNG，預設顯示產品名、四碼、稀有度、稱號、暱稱、短句。暱稱模式需明確選取。CSS 3D 厚度、柔影、角度虹彩、選擇性 foil、桌面拖曳／手機觸控／方向鍵；reduced-motion 靜態卡。
- 六家族 × 16 型 × 一般／Q 版，共 192 張不同插畫。換造型不重新判定；未知使用中性卡面。`/art-gallery` 可檢視完整圖庫。
- 繁中、簡中、日文、韓文、英文；流程、指令、報告、稀有度、分享與下載均隨語言切換。
- 1080×1620 卡片、1080×1350 直式、1080×1920 限時、1080² 正方形、1200×630 橫式 PNG。QR 和文字指向目前網站的首頁（取自 `location.origin`），沒有私人結果或權杖。系統支援檔案分享時使用 Web Share，否則下載並提供文字；沒有自動發文。
- Collector 指令預設最近 60 個本地日（當地 00:00 到現在）、IANA 時區、所有支援且本人所有／主機允許存取的本機來源、Tokscale。一次說明並取得範圍與傳送授權，仍遵守主機原生核准。缺少工具、拒絕或一次安裝失敗時繼續現有證據，不捏造用量。

## 團隊看板

`/team` 建立看板（名稱＋Turnstile），得到兩個連結：給成員的邀請連結 `/?team=<code>`，以及只給管理者的看板網址 `/team#<id>.<token>`（權杖在 `#` 後，不會送進伺服器紀錄）。成員從邀請連結完成觀察後，可在揭曉頁自行選擇分享，並隨時撤回。伺服器依該次結果產生快照：卡片、四軸、稀有度，以及 collector 自己計算的數字（期間內工作階段、token、自動化、子代理、寫下與重用的資產），不含任務、時間軸或任何對話內容；示範資料不能分享。管理者可移除單筆或刪除整個看板，看板保留 180 天。數字來自成員本機，網站無法驗證原始紀錄，看趨勢比看單次有意義，不適合當成招募或考核依據。

## 可驗證卡片與社群分享

揭曉後在分享視窗可建立「可驗證連結」`/c/<隨機ID>`：伺服器依存下來的結果畫出卡片（可轉動的全息卡），下載的 PNG 上的 QR 與分享文字都改指向這頁，修過的圖對不上紀錄。連結貼到社群會展開成伺服器產生的 1200×630 預覽圖（`/c/<id>/og`，`next/og` 的 satori + resvg），圖上只有類型、型名與稀有度，不畫暱稱；暱稱在 `og:title`。同一份結果只有一張公開卡片，重建保留網址並換新撤回權杖；可隨時撤回，清除結果時一併刪除，最長保留 365 天，示範資料不能建立。個人卡片頁 `noindex`。「交給 Agent 分享」複製一段指令給你的 Agent：帶連結與建議文案，要求發文前先給你確認；網站本身從不代發。

預覽用的插畫 JPEG 在 `npm run build` 時由 `scripts/build-og-assets.mjs` 產生（satori 不支援 WebP），不進版本控制。預覽字型是固定字串的子集，存在 `public/og/fonts/`；改了型名、稀有度名稱或預覽文案後執行 `npm run og:fonts`，`tests/og.test.ts` 會檢查涵蓋範圍。

## 和他比一比、README 徽章與擴散量測

公開卡片頁的主按鈕是「測完和 {暱稱} 比一比」，連到 `/?vs=<卡片ID>`。訪客測完後，揭曉頁會多一塊雙人比較：四軸逐一對照，依相同的軸數命名（分身／默契／互補／反差搭檔）。按「分享比較結果」時，網站會替訪客建立（或沿用）自己的公開卡片，再產生比較連結 `/vs/<A>/<B>`。這頁和它的 1200×630 預覽圖（`/vs/<A>/<B>/og`）都由伺服器依兩張卡的紀錄畫出，任一張撤回就失效，也維持 `noindex`。比較時讀取的 `GET /api/cards/<id>` 只回公開頁已顯示的內容；只顯示暱稱的卡片不提供類型，也就不能比較。

分享視窗的「README 徽章」會複製 `[![AI Partner Style](…/c/<id>/badge.svg)](…/c/<id>?via=badge)`。徽章只用拉丁字母，顏色跟著稀有度；卡片撤回或過期後，徽章會變成「take the test」，不會在別人的 README 裡壞掉。

擴散量測只記每日總數，不記任何識別資料：`funnel` 表的每一列是「日期 × 來源 × 步驟 → 次數」。來源有三種標記：`link`（貼出去的卡片或比較連結）、`qr`（下載圖片上的 QR，網址帶 `?via=qr`）、`badge`（README 徽章）；沒有標記的訪客記為 `direct`。步驟依序是 `card_view`（真人打開卡片或比較頁；連結預覽爬蟲不算）、`landing`（真人進首頁）、`session`、`result`、`share`。來源記在這個分頁的 sessionStorage，建立連結時隨請求送出，存在會話上，所以後續的提交與公開卡片都會算回同一個來源。另有 `result_tally` 表記每天完成的結果形狀：「日期 × 四碼 × 稀有度 × 模型家族 × 客戶端 → 次數」，四碼中傾向的軸用小寫、未定的軸是 `?`，同樣沒有任何 id。用 `npm run stats` 查正式站的總覽、各來源漏斗、每日數字、16 型與四軸分布、稀有度、模型與客戶端佔比；加 `-- --local` 查本機，加 `-- --days 7` 只看最近 7 天。

預覽圖（`/og`、`/c/<id>/og`、`/vs/<A>/<B>/og`）會先確認卡片還在，再查 Cache API 的快取。快取鍵包含卡片內容的雜湊，所以重建卡面會換一張新圖。正式站實測第二次讀取會回 `cf-cache-status: HIT`。

## 公開頁面與 AEO

首頁、`/types`（16 型總覽）、`/types/<代碼>`、`/levels`、`/method`（流程、計分、限制與常見問答）與 `/art-gallery` 開放索引；結果、`/team` 與個人卡片頁維持 `noindex`。內容頁由伺服器依 `catalog`、`workstyle`、`usage-level` 與 `lib/site-content.ts` 產生，五種語言各有網址（`?lang=zh-CN|ja|ko|en`，預設繁中），附 canonical、hreflang、各型的 OG 預覽（`/og?type=…`）與 JSON-LD（WebApplication、DefinedTermSet／DefinedTerm、BreadcrumbList、FAQPage）。`/sitemap.xml`、`/robots.txt`（`Content-Signal: search=yes, ai-input=yes`）與 `/llms.txt` 由同一份資料產生，不會和頁面脫節。每頁頁尾標明並非人格測驗、與任何人格測驗機構無關，並附上製作者連結（`lib/creator.ts`）。

## 卡面稀有度

稀有度決定外框：普通與待鑑定是一般外框，稀有加虹彩外框與四角星芒，史詩再加星點與虹彩徽章，傳說是金框。卡面徽章、分享文字、預覽圖、README 徽章與團隊看板都只寫稀有度名稱。下載的 PNG 與預覽一致；預覽時史詩與傳說卡另有一道光沿邊框繞行。選擇只顯示暱稱時，稀有度一起隱藏。

## 驗證與限制

執行 `npm run typecheck`、`npm test`、`npm run verify:art`、`npm run test:browser`、`node scripts/smoke-built.mjs http://127.0.0.1:5188`。`test:browser` 會沿用 5188 上已啟動的 preview，否則自行建置、套用本機 migration 後啟動。測試只使用隔離 Chrome、專用虛構資料、本機 D1 與 Turnstile 測試金鑰；每個模擬訪客帶不同的 `CF-Connecting-IP`。HTTP smoke 限 loopback。

測試與驗證腳本的輸出寫到 `evidence/`，不納入版本控制。

本專案交付的是 Agent 指令和最小摘要驗證／提交協定。網站本身不掃描紀錄。`collect.py` 在時間預算內抽樣本地日誌，供合作風格分類。抽樣順序由每個檔案路徑的雜湊決定，同一批紀錄重跑會讀到同一批 session，新紀錄只會逐步替換，重測結果因此比較穩定（分類仍由 Agent 判讀，換模型仍可能有差異）。token 取自 Tokscale 的 client／model 總量。它不算完整會話數。24 個 task、48 個四軸 observation、64 個成果 observation、24 KiB 是上傳限制，不是模型讀取紀錄的成本上限。

圖片是 ApprenTice 同人衍生，角色參考 ZipZipPipe；DeepSeek 另含上善無形。CC BY-NC-SA 4.0：非商業、署名及相同方式分享。GPT 龍娘是 Codex 主題改編，並非官方角色；上游權利鏈未全面核實，沒有模型業者背書。[素材來源](public/art-provenance.md)。

真人證據校準、動畫匯出尚未完成。資料過期後拒絕讀寫，於後續請求清理；沒有宣稱到期瞬間背景刪除。

網站素材採原尺寸 WebP（品質 98、透明度一致），原始 PNG 全數保存在 `art-source/`。編碼、來源 hash 與素材大小的取捨見 [ART-DELIVERY](docs/ART-DELIVERY.md)。
