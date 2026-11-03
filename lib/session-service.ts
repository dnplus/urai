import { createSchema, progressSchema, selfTypeSchema, PROTOCOL_VERSION } from "./contract.ts";
import { countStep, countResult, funnelSource } from "./funnel.ts";
import { toReport, toCardObservation, storedSelfType, validateSubmission, type Report } from "./assessment.ts";

export const TTL_MS = 30 * 60 * 1000;
const MAX_BYTES = 24 * 1024;
const secureHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Vary": "Origin" };
type Row = { id: string; protocol_version: string; progress_phase: string; progress_sequence: number; progress_at: number | null; approval_kind: string | null; read_hash: string; write_hash: string; nickname: string; expires_at: number; report: string | null; payload_hash: string | null; idempotency_key: string | null; submitted_at: number | null; self_type: string | null; via: string | null };
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: secureHeaders });
export const failure = (status: number, message: string): never => { throw new HttpError(status, message); };
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(",")}}` : JSON.stringify(value);
const equal = (a: string, b: string) => { let n = a.length ^ b.length; for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return n === 0; };

async function body(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) failure(415, "需要 JSON 格式。");
  if (Number(request.headers.get("content-length")) > MAX_BYTES) failure(413, "摘要超過大小限制。");
  const reader = request.body?.getReader();
  if (!reader) return failure(400, "缺少摘要。");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); failure(413, "摘要超過大小限制。"); }
    parts.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return failure(400, "JSON 格式無效。"); }
}
function sameOrigin(request: Request, required = false) {
  const origin = request.headers.get("origin");
  if ((required && !origin) || (origin && origin !== new URL(request.url).origin)) failure(403, "請從此網站操作。");
}
async function authorize(db: D1Database, request: Request, id: string, access: "read" | "write", now: number) {
  if (!/^[0-9a-f-]{36}$/.test(id)) failure(404, "會話不存在或已失效。");
  const row = await db.prepare("SELECT * FROM sessions WHERE id = ?1").bind(id).first<Row>();
  const token = request.headers.get("authorization")?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if (!row || !token || !equal(await digest(token), access === "read" ? row.read_hash : row.write_hash)) return failure(404, "會話不存在或已失效。");
  if (row.expires_at <= now) { await db.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run(); failure(410, "會話已到期，請重新開始。"); }
  return row;
}
export async function handleSession(db: D1Database, request: Request, id?: string, mode: "session" | "collect" | "progress" = "session", now = Date.now()): Promise<Response> {
  let phase = "access";
  try {
    sameOrigin(request, !id || request.method === "DELETE" || request.method === "PUT");
    if (!id) {
      if (request.method !== "POST") failure(405, "此操作不支援。");
      const parsed = createSchema.safeParse(await body(request));
      if (!parsed.success) return failure(400, "請檢查暱稱。");
      phase = "create_session";
      await db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now).run();
      const readToken = randomToken();
      const writeToken = randomToken();
      const newId = crypto.randomUUID();
      const expiresAt = now + TTL_MS;
      const via = parsed.data.via ?? null;
      await db.prepare("INSERT INTO sessions (id, read_hash, write_hash, nickname, created_at, expires_at, protocol_version, via) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(newId, await digest(readToken), await digest(writeToken), parsed.data.nickname, now, expiresAt, PROTOCOL_VERSION, via).run();
      await countStep(db, "session", via, now);
      return json({ id: newId, readToken, writeToken, expiresAt, nickname: parsed.data.nickname }, 201);
    }
    const row = await authorize(db, request, id, mode === "session" ? "read" : "write", now);
    phase = "session_storage";
    if (mode === "session" && request.method === "DELETE") {
      const statements=[db.prepare("DELETE FROM sessions WHERE id = ?1").bind(id)];
      if(new URL(request.url).searchParams.get("retainResult")!=="1")statements.push(db.prepare("DELETE FROM remembered_results WHERE id=?1").bind(id),db.prepare("DELETE FROM public_cards WHERE session_id=?1").bind(id));
      await db.batch(statements);return json({ deleted: true });
    }
    if (row.protocol_version !== PROTOCOL_VERSION) return json({ error: "觀察規則已更新。舊結果需要重新分析，請建立新連結。", code: "reassessment_required" }, 410);
    await db.prepare("DELETE FROM sessions WHERE expires_at <= ?1 AND id != ?2").bind(now, id).run();
    if (mode === "session" && request.method === "PUT") {
      const parsed = selfTypeSchema.safeParse(await body(request));
      if (!parsed.success) return failure(422, "請從 16 型中選一個，或選不確定。");
      await db.prepare("UPDATE sessions SET self_type=?1 WHERE id=?2").bind(parsed.data.selfType, id).run();
      return json(parsed.data);
    }
    if (mode === "progress") {
      if (request.method !== "POST") failure(405, "此操作不支援。");
      const parsed = progressSchema.safeParse(await body(request));
      if (!parsed.success) return failure(422, "進度只接受已觀察到的狀態，不接受紀錄內容。");
      const p = parsed.data;
      const updated = await db.prepare("UPDATE sessions SET progress_phase=?1, progress_sequence=?2, progress_at=?3, approval_kind=?4 WHERE id=?5 AND progress_sequence < ?2 AND report IS NULL AND expires_at > ?3").bind(p.phase, p.sequence, now, p.approvalKind, id).run();
      if (updated.meta.changes === 1) return json({ accepted: true, duplicate: false });
      const current = await db.prepare("SELECT * FROM sessions WHERE id=?1").bind(id).first<Row>();
      if (current?.report) return json({ accepted: true, complete: true });
      if (current?.progress_sequence === p.sequence && current.progress_phase === p.phase && current.approval_kind === p.approvalKind) return json({ accepted: true, duplicate: true });
      return failure(409, "此進度已被較新的回報取代。");
    }
    if (mode === "collect") {
      if (request.method !== "POST") failure(405, "此操作不支援。");
      const key = request.headers.get("idempotency-key");
      if (!key || !/^[A-Za-z0-9_-]{16,80}$/.test(key)) failure(400, "缺少有效的重試識別碼。");
      let data;
      phase = "read_summary";
      const input = await body(request);
      try { data = validateSubmission(input, now); } catch { return json({ error: "摘要不符合新版協定；請保留未知、檢查獨立任務與觀察，勿傳原文或其他欄位。" }, 422); }
      if (data.nickname !== row.nickname) failure(422, "暱稱與此會話不符。");
      phase = "save_summary";
      const payloadHash = await digest(canonical(data));
      const report = toReport(data), stored = JSON.stringify(report);
      const result = await db.prepare("UPDATE sessions SET report = ?1, payload_hash = ?2, idempotency_key = ?3, submitted_at = ?4 WHERE id = ?5 AND report IS NULL AND expires_at > ?4")
        .bind(stored, payloadHash, key, now, id).run();
      if (result.meta.changes === 1) {
        // A homepage demo stores a canned fixture. It is not an observation, so it must not move the result funnel or the type tally.
        if (report.kind === "observed") { await countStep(db, "result", funnelSource(row.via), now); await countResult(db, report, now); }
        return json({ accepted: true, duplicate: false }, 201);
      }
      const current = await db.prepare("SELECT payload_hash, idempotency_key FROM sessions WHERE id = ?1").bind(id).first<Row>();
      if (current?.payload_hash === payloadHash && current.idempotency_key === key) return json({ accepted: true, duplicate: true });
      failure(409, "此會話已收到一份結果；相同內容請使用原重試識別碼。");
    }
    if (request.method === "GET") {
      phase = "read_result";
      const report: Report | null = row.report ? JSON.parse(row.report) : null;
      return json({ id, expiresAt: row.expires_at, status: report ? "complete" : "pending", progress: { phase: report ? "complete" : row.progress_phase, sequence: row.progress_sequence, updatedAt: report ? row.submitted_at : row.progress_at, approvalKind: report ? null : row.approval_kind }, card: report ? toCardObservation(report, storedSelfType(row.self_type)) : null, report });
    }
    return failure(405, "此操作不支援。");
  } catch (error) {
    if (!(error instanceof HttpError)) console.warn(JSON.stringify({ event: "session_unavailable", phase, errorClass: error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : "Error" }));
    return error instanceof HttpError ? json({ error: error.message }, error.status) : json({ error: "暫時無法處理，請稍後再試。" }, 503);
  }
}

export const hashSecret=digest;
export const constantEqual=equal;
export const sameOriginRequest=sameOrigin;
export async function readSessionReport(db:D1Database,request:Request,id:string,readToken:string,now:number){
 const headers=new Headers(request.headers);headers.set('Authorization','Bearer '+readToken);
 const scoped=new Request(new URL('/api/sessions/'+id,request.url),{headers});
 return authorize(db,scoped,id,'read',now);
}

export const readJsonBody=body;
