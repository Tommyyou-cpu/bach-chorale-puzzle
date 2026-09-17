/* eslint-disable @typescript-eslint/no-explicit-any -- D1 返回的 JSON 行与后台可编辑题目结构在运行时校验 */
import {
  CATEGORIES,
  DEFAULT_GAME_RULES,
  adminQuestion,
  drawQuestions,
  publicQuestion,
  scoreSelections,
  validateRules,
  seededRandom,
} from "./core.mjs";

type JsonObject = Record<string, any>;

export interface Env {
  DB: D1Database;
  R2?: R2Bucket;
  ASSETS?: R2Bucket;
  ALLOWED_ORIGINS?: string;
  PUBLIC_APP_ORIGIN?: string;
  ADMIN_BOOTSTRAP_USERNAME?: string;
  ADMIN_BOOTSTRAP_PASSWORD?: string;
  SESSION_SECRET?: string;
  SESSION_TTL_SECONDS?: string;
  AUTH_RATE_LIMIT?: string;
  AUTH_RATE_WINDOW_SECONDS?: string;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const PBKDF2_ITERATIONS = 120_000;
const DEFAULT_SESSION_TTL = 7_200;
const DEFAULT_RATE_LIMIT = 5;
const DEFAULT_RATE_WINDOW = 60;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const ALLOWED_ASSET_EXTENSIONS = new Set(["mp3", "wav", "musicxml", "xml", "svg"]);
const ALLOWED_ASSET_MIME_TYPES: Record<string, Set<string>> = {
  mp3: new Set(["audio/mpeg", "audio/mp3"]),
  wav: new Set(["audio/wav", "audio/x-wav", "audio/wave"]),
  musicxml: new Set(["application/xml", "text/xml", "application/vnd.recordare.musicxml+xml"]),
  xml: new Set(["application/xml", "text/xml", "application/vnd.recordare.musicxml+xml"]),
  svg: new Set(["image/svg+xml"]),
};

function object(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function array(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isoNow() {
  return new Date().toISOString();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: unknown) {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function parseMeasures(value: unknown): [number | null, number | null] {
  const text = String(value ?? "");
  const match = text.match(/(\d+)\D+(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

function questionVoices(question: JsonObject) {
  return Array.isArray(question.voiceOrder) && question.voiceOrder.length
    ? question.voiceOrder
    : Object.keys(object(question.voices));
}

function normalizeCandidate(candidate: unknown, fallbackId: string, variant: number) {
  const source = object(candidate);
  return {
    id: String(source.id ?? fallbackId),
    audio: String(source.audio ?? ""),
    audioFallback: String(source.audioFallback ?? source.audio ?? ""),
    score: String(source.score ?? ""),
    isOriginal: source.isOriginal === true,
    variant: integerOrNull(source.variant) ?? variant,
    decoyType: String(source.decoyType ?? (source.isOriginal === true ? "original" : "mixed")),
    explanation: String(source.explanation ?? ""),
    ...(source.optionId ? { optionId: String(source.optionId) } : {}),
  };
}

function normalizeQuestionInput(value: unknown, existing?: JsonObject): JsonObject {
  const source = { ...(existing ?? {}), ...object(value) };
  const voicesSource = object(source.voices);
  const voiceOrder = array(source.voiceOrder).map(String).filter(Boolean);
  const resolvedVoiceOrder = voiceOrder.length ? voiceOrder : Object.keys(voicesSource);
  const voices: JsonObject = {};
  for (const voice of resolvedVoiceOrder) {
    voices[voice] = array(voicesSource[voice]).map((candidate, index) => normalizeCandidate(candidate, `${voice}-option-${index + 1}`, index));
  }
  const measures = String(source.measures ?? "");
  const parsedMeasures = parseMeasures(measures);
  const measureStart = integerOrNull(source.measureStart) ?? parsedMeasures[0];
  const measureEnd = integerOrNull(source.measureEnd) ?? parsedMeasures[1];
  const genre = String(source.genre ?? source.category ?? "other");
  return {
    id: String(source.id ?? "").trim(),
    title: String(source.title ?? "").trim(),
    genre,
    voiceCount: integerOrNull(source.voiceCount) ?? resolvedVoiceOrder.length,
    voiceOrder: resolvedVoiceOrder,
    voiceLabels: object(source.voiceLabels),
    clefs: object(source.clefs),
    keySignature: String(source.keySignature ?? ""),
    timeSignature: String(source.timeSignature ?? "4/4"),
    bwv: String(source.bwv ?? ""),
    measures,
    measureStart,
    measureEnd,
    duration: numberOrNull(source.duration),
    bpm: integerOrNull(source.bpm),
    source: String(source.source ?? ""),
    sourceLabel: String(source.sourceLabel ?? source.sourceEdition ?? ""),
    analysis: String(source.analysis ?? ""),
    licenseNote: String(source.licenseNote ?? source.sourceLicense ?? ""),
    sourceEdition: String(source.sourceEdition ?? source.sourceLabel ?? ""),
    sourceLicense: String(source.sourceLicense ?? source.licenseNote ?? ""),
    maxRestByVoice: object(source.maxRestByVoice),
    voices,
    revision: integerOrNull(source.revision) ?? 1,
    enabled: source.enabled !== false,
    sortOrder: integerOrNull(source.sortOrder) ?? 0,
    createdAt: String(source.createdAt ?? isoNow()),
    updatedAt: isoNow(),
  };
}

function validateQuestion(question: JsonObject) {
  const errors: string[] = [];
  if (!question.id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(question.id)) errors.push("题目 ID 只能包含字母、数字、下划线和连字符");
  if (!question.title) errors.push("题目标题不能为空");
  if (!CATEGORIES.includes(question.genre)) errors.push("题目分类必须是 chorale、fugue 或 other");
  const voices = questionVoices(question);
  if (![3, 4].includes(voices.length)) errors.push("声部数量必须是 3 或 4");
  if (question.voiceCount !== voices.length) errors.push("voiceCount 必须等于 voiceOrder 的长度");
  const seenVoices = new Set<string>();
  for (const voice of voices) {
    if (seenVoices.has(voice)) errors.push(`声部重复：${voice}`);
    seenVoices.add(voice);
    if (!String(question.clefs?.[voice] ?? "")) errors.push(`${voice} 缺少谱号`);
    const candidates = array(question.voices?.[voice]);
    if (![3, 4].includes(candidates.length)) errors.push(`${voice} 必须有 3 或 4 个候选项`);
    const ids = new Set<string>();
    let originals = 0;
    for (const candidate of candidates) {
      if (!candidate.id || ids.has(candidate.id)) errors.push(`${voice} 存在重复候选 ID`);
      ids.add(candidate.id);
      if (!candidate.audio || !candidate.score) errors.push(`${voice}/${candidate.id} 缺少音频或谱面资源`);
      if (candidate.isOriginal) originals += 1;
    }
    if (originals !== 1) errors.push(`${voice} 必须且只能有一个正确候选项`);
  }
  if (!question.keySignature) errors.push("缺少调号");
  if (!question.timeSignature) errors.push("缺少拍号");
  if (!question.source) errors.push("缺少来源");
  return errors;
}

function rowToQuestion(row: JsonObject): JsonObject {
  const voiceOrder = array(row.voice_order_json);
  const voices = object(row.voices_json);
  const resolvedVoiceOrder = voiceOrder.length ? voiceOrder : Object.keys(voices);
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    genre: String(row.genre ?? "other"),
    voiceCount: Number(row.voice_count),
    voiceOrder: resolvedVoiceOrder,
    voiceLabels: object(row.voice_labels_json),
    clefs: object(row.clefs_json),
    keySignature: String(row.key_signature ?? ""),
    timeSignature: String(row.time_signature ?? ""),
    bwv: String(row.bwv ?? ""),
    measures: String(row.measures ?? ""),
    measureStart: numberOrNull(row.measure_start),
    measureEnd: numberOrNull(row.measure_end),
    duration: numberOrNull(row.duration),
    bpm: integerOrNull(row.bpm),
    source: String(row.source ?? ""),
    sourceLabel: String(row.source_label ?? ""),
    analysis: String(row.analysis ?? ""),
    licenseNote: String(row.license_note ?? ""),
    sourceEdition: String(row.source_edition ?? ""),
    sourceLicense: String(row.source_license ?? ""),
    maxRestByVoice: object(row.max_rest_by_voice_json),
    voices,
    revision: Number(row.revision ?? 1),
    enabled: Boolean(Number(row.enabled)),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function bind(statement: D1PreparedStatement, values: unknown[]) {
  return values.length ? statement.bind(...(values as any[])) : statement;
}

async function rows<T extends JsonObject>(db: D1Database, sql: string, values: unknown[] = []) {
  const result = await bind(db.prepare(sql), values).all<T>();
  return result.results ?? [];
}

async function run(db: D1Database, sql: string, values: unknown[] = []) {
  return bind(db.prepare(sql), values).run();
}

async function first<T extends JsonObject>(db: D1Database, sql: string, values: unknown[] = []) {
  const result = await bind(db.prepare(sql), values).first<T>();
  return result ?? null;
}

function allowedOrigins(env: Env) {
  return String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function requestOriginAllowed(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins(env).includes(origin.replace(/\/$/, ""));
}

function corsHeaders(request: Request, env: Env) {
  const headers = new Headers(JSON_HEADERS);
  const origin = request.headers.get("Origin");
  if (origin && requestOriginAllowed(request, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function respond(request: Request, env: Env, payload: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  const headers = corsHeaders(request, env);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(payload === undefined ? null : JSON.stringify(payload), { status, headers });
}

function fail(request: Request, env: Env, status: number, error: string, details?: unknown) {
  return respond(request, env, { error, ...(details === undefined ? {} : { details }) }, status);
}

async function readJson(request: Request): Promise<JsonObject> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求体必须是 JSON 对象");
    return value as JsonObject;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "请求体必须是合法 JSON");
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Url(value: Uint8Array) {
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function passwordHash(password: string, salt = randomBytes(16)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
  return result === 0;
}

async function verifyPassword(password: string, stored: string) {
  const [, iterations, saltText, hashText] = stored.split("$");
  if (!iterations || !saltText || !hashText) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64ToBytes(saltText), iterations: Number(iterations), hash: "SHA-256" },
    key,
    256,
  );
  return constantTimeEqual(new Uint8Array(bits), base64ToBytes(hashText));
}

async function tokenHash(token: string, env?: Env) {
  return base64Url(await digest(`${env?.SESSION_SECRET ?? ""}:${token}`));
}

function sessionTtl(env: Env) {
  const value = Number(env.SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL);
  return Number.isFinite(value) && value >= 300 && value <= 86_400 ? Math.floor(value) : DEFAULT_SESSION_TTL;
}

function clientAddress(request: Request) {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
}

async function bootstrapAdmin(env: Env) {
  const count = await first<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM admin_users");
  if (Number(count?.count ?? 0) > 0) return true;
  const username = String(env.ADMIN_BOOTSTRAP_USERNAME ?? "Tommy-yjx").trim();
  const password = String(env.ADMIN_BOOTSTRAP_PASSWORD ?? "");
  if (!username || !password) return false;
  await run(
    env.DB,
    "INSERT OR IGNORE INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)",
    [crypto.randomUUID(), username, await passwordHash(password)],
  );
  return true;
}

function rateConfig(env: Env) {
  const limit = Number(env.AUTH_RATE_LIMIT ?? DEFAULT_RATE_LIMIT);
  const window = Number(env.AUTH_RATE_WINDOW_SECONDS ?? DEFAULT_RATE_WINDOW);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_RATE_LIMIT,
    window: Number.isFinite(window) && window > 0 ? Math.floor(window) : DEFAULT_RATE_WINDOW,
  };
}

async function rateAllowed(env: Env, key: string) {
  const { limit, window } = rateConfig(env);
  const now = nowSeconds();
  const row = await first<JsonObject>(env.DB, "SELECT failures, window_started_at FROM auth_rate_limits WHERE key = ?", [key]);
  if (!row) return true;
  if (now - Number(row.window_started_at) >= window) return true;
  return Number(row.failures) < limit;
}

async function recordFailure(env: Env, key: string) {
  const { window } = rateConfig(env);
  const now = nowSeconds();
  const row = await first<JsonObject>(env.DB, "SELECT failures, window_started_at FROM auth_rate_limits WHERE key = ?", [key]);
  if (!row || now - Number(row.window_started_at) >= window) {
    await run(env.DB, "INSERT OR REPLACE INTO auth_rate_limits (key, failures, window_started_at, updated_at) VALUES (?, 1, ?, ?)", [key, now, now]);
  } else {
    await run(env.DB, "UPDATE auth_rate_limits SET failures = failures + 1, updated_at = ? WHERE key = ?", [now, key]);
  }
}

async function clearFailures(env: Env, key: string) {
  await run(env.DB, "DELETE FROM auth_rate_limits WHERE key = ?", [key]);
}

type AuthContext = { userId: string; username: string; tokenHash: string };

async function requireAdmin(request: Request, env: Env): Promise<{ ok: true; auth: AuthContext } | { ok: false; response: Response }> {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return { ok: false, response: fail(request, env, 401, "需要管理员登录") };
  const hashed = await tokenHash(token, env);
  const current = nowSeconds();
  const row = await first<JsonObject>(
    env.DB,
    "SELECT s.token_hash, s.user_id, s.expires_at, u.username FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.token_hash = ?",
    [hashed],
  );
  if (!row || Number(row.expires_at) <= current) {
    if (row) await run(env.DB, "DELETE FROM admin_sessions WHERE token_hash = ?", [hashed]);
    return { ok: false, response: fail(request, env, 401, "登录已过期，请重新登录") };
  }
  await run(env.DB, "UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?", [current, hashed]);
  return { ok: true, auth: { userId: String(row.user_id), username: String(row.username), tokenHash: hashed } };
}

function questionColumns(question: JsonObject) {
  return [
    question.id,
    question.title,
    question.genre,
    question.voiceCount,
    JSON.stringify(question.voiceOrder),
    JSON.stringify(question.voiceLabels ?? {}),
    JSON.stringify(question.clefs ?? {}),
    question.keySignature,
    question.timeSignature,
    question.bwv,
    question.measures,
    question.measureStart,
    question.measureEnd,
    question.duration,
    question.bpm,
    question.source,
    question.sourceLabel,
    question.analysis,
    question.licenseNote,
    question.sourceEdition,
    question.sourceLicense,
    JSON.stringify(question.maxRestByVoice ?? {}),
    JSON.stringify(question.voices),
    question.revision,
    question.enabled ? 1 : 0,
    question.sortOrder,
    question.createdAt,
    question.updatedAt,
  ];
}

function questionWithPublicAssetUrls(question: JsonObject, env: Env) {
  const publicOrigin = String(env.PUBLIC_APP_ORIGIN ?? "").replace(/\/$/, "");
  if (!publicOrigin) return question;
  const copied = structuredClone(question) as JsonObject;
  for (const voice of questionVoices(copied)) {
    copied.voices[voice] = array(copied.voices[voice]).map((candidate) => {
      const next = { ...candidate };
      for (const field of ["audio", "audioFallback", "score"] as const) {
        const value = String(next[field] ?? "");
        if (value.startsWith("/music/") || value.startsWith("/generated-scores/")) {
          next[field] = `${publicOrigin}${value}`;
        }
      }
      return next;
    });
  }
  return copied;
}

const QUESTION_INSERT = `INSERT INTO questions (
  id, title, genre, voice_count, voice_order_json, voice_labels_json, clefs_json,
  key_signature, time_signature, bwv, measures, measure_start, measure_end,
  duration, bpm, source, source_label, analysis, license_note, source_edition,
  source_license, max_rest_by_voice_json, voices_json, revision, enabled, sort_order,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function listQuestionRecords(env: Env, includeDisabled = true) {
  const sql = includeDisabled
    ? "SELECT * FROM questions ORDER BY sort_order ASC, id ASC"
    : "SELECT * FROM questions WHERE enabled = 1 ORDER BY sort_order ASC, id ASC";
  return (await rows<JsonObject>(env.DB, sql)).map(rowToQuestion);
}

async function getQuestion(env: Env, id: string) {
  const row = await first<JsonObject>(env.DB, "SELECT * FROM questions WHERE id = ?", [id]);
  return row ? rowToQuestion(row) : null;
}

async function inventory(env: Env) {
  const result = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  const list = await rows<JsonObject>(env.DB, "SELECT genre, COUNT(*) AS count FROM questions WHERE enabled = 1 GROUP BY genre");
  for (const row of list) if (result[row.genre as string] !== undefined) result[row.genre as string] = Number(row.count);
  return result;
}

async function getRules(env: Env): Promise<JsonObject> {
  const row = await first<JsonObject>(env.DB, "SELECT value_json, revision FROM settings WHERE key = 'game_rules'");
  if (!row) return { ...DEFAULT_GAME_RULES };
  const parsed = object(row.value_json);
  return {
    ...parsed,
    revision: Number(row.revision ?? parsed.revision ?? 1),
  };
}

async function saveRules(env: Env, candidate: unknown) {
  const current = await getRules(env);
  const requested = object(candidate);
  const normalized = {
    ...DEFAULT_GAME_RULES,
    ...requested,
    allocation: { ...object(DEFAULT_GAME_RULES.allocation), ...object(requested.allocation) },
    scoreWeights: { ...object(DEFAULT_GAME_RULES.scoreWeights), ...object(requested.scoreWeights) },
    revision: Number(current.revision ?? 1) + 1,
  };
  const check = validateRules(normalized, await inventory(env));
  if (!check.ok) return { ok: false as const, check };
  await run(
    env.DB,
    "INSERT INTO settings (key, value_json, revision, updated_at) VALUES ('game_rules', ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, revision = excluded.revision, updated_at = CURRENT_TIMESTAMP",
    [JSON.stringify(check.rules), check.rules.revision],
  );
  return { ok: true as const, rules: check.rules };
}

function withOpaqueOptionIds(questions: JsonObject[]) {
  return questions.map((question) => {
    const copied = structuredClone(question) as JsonObject;
    for (const voice of questionVoices(copied)) {
      copied.voices[voice] = array(copied.voices[voice]).map((candidate) => ({ ...candidate, optionId: crypto.randomUUID() }));
    }
    return copied;
  });
}

async function cleanupExpiredSessions(env: Env) {
  await run(env.DB, "DELETE FROM game_sessions WHERE expires_at <= ?", [nowSeconds()]);
  await run(env.DB, "DELETE FROM admin_sessions WHERE expires_at <= ?", [nowSeconds()]);
}

async function handleCreateGame(request: Request, env: Env) {
  await cleanupExpiredSessions(env);
  const rules = await getRules(env);
  const pool = await listQuestionRecords(env, false);
  const check = validateRules(rules, await inventory(env));
  if (!check.ok) return fail(request, env, 503, "当前题库无法按照规则抽题", check.errors);
  const selected = withOpaqueOptionIds(drawQuestions(pool, check.rules, Math.random));
  if (selected.length !== check.rules.questionsPerGame) return fail(request, env, 503, "当前题库数量不足，无法创建游戏");
  const sessionId = crypto.randomUUID();
  const expiresAt = nowSeconds() + sessionTtl(env);
  await run(
    env.DB,
    "INSERT INTO game_sessions (id, rule_json, question_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [sessionId, JSON.stringify(check.rules), JSON.stringify(selected), expiresAt, nowSeconds()],
  );
  return respond(request, env, {
    sessionId,
    expiresAt,
    rules: check.rules,
    questions: selected.map((question) => publicQuestion(questionWithPublicAssetUrls(question, env))),
  });
}

function sanitizeSelections(selections: unknown) {
  const source = object(selections);
  const clean: JsonObject = {};
  for (const [questionId, value] of Object.entries(source)) {
    const questionSelections = object(value);
    clean[questionId] = {};
    for (const [voice, candidateId] of Object.entries(questionSelections)) {
      if (typeof candidateId === "string" && candidateId.length <= 256) clean[questionId][voice] = candidateId;
    }
  }
  return clean;
}

async function handleSubmitGame(request: Request, env: Env, sessionId: string) {
  await cleanupExpiredSessions(env);
  const session = await first<JsonObject>(env.DB, "SELECT * FROM game_sessions WHERE id = ?", [sessionId]);
  if (!session) return fail(request, env, 404, "游戏不存在或已过期");
  if (session.submitted_at) return fail(request, env, 409, "本局已经提交过答案");
  const body = await readJson(request);
  const selections = sanitizeSelections(body.selections);
  const questions = array(session.question_json);
  const rules = object(session.rule_json);
  const score = scoreSelections(questions, selections, rules);
  const updated = await run(env.DB, "UPDATE game_sessions SET submitted_at = ?, score_json = ? WHERE id = ? AND submitted_at IS NULL", [nowSeconds(), JSON.stringify(score), sessionId]);
  if (!updated.meta?.changes) return fail(request, env, 409, "本局已经提交过答案");
  return respond(request, env, { sessionId, rules, selections, score });
}

async function handleLogin(request: Request, env: Env) {
  let body: JsonObject;
  try {
    body = await readJson(request);
  } catch (error) {
    return fail(request, env, 400, error instanceof Error ? error.message : "请求体格式错误");
  }
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const rateKey = `${clientAddress(request)}:${username.toLowerCase()}`;
  if (!(await rateAllowed(env, rateKey))) return fail(request, env, 429, "登录尝试过于频繁，请稍后再试");
  if (!(await bootstrapAdmin(env))) return fail(request, env, 503, "管理员尚未初始化，请配置 Worker 的引导账号密钥");
  const user = await first<JsonObject>(env.DB, "SELECT id, username, password_hash FROM admin_users WHERE username = ?", [username]);
  if (!user || !(await verifyPassword(password, String(user.password_hash)))) {
    await recordFailure(env, rateKey);
    return fail(request, env, 401, "用户名或密码错误");
  }
  await clearFailures(env, rateKey);
  await cleanupExpiredSessions(env);
  const token = base64Url(randomBytes(32));
  const hashed = await tokenHash(token, env);
  const expiresAt = nowSeconds() + sessionTtl(env);
  await run(env.DB, "INSERT INTO admin_sessions (token_hash, user_id, expires_at, last_seen_at) VALUES (?, ?, ?, ?)", [hashed, user.id, expiresAt, nowSeconds()]);
  return respond(request, env, { token, expiresAt, user: { id: user.id, username: user.username } });
}

async function handleLogout(request: Request, env: Env) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (token) await run(env.DB, "DELETE FROM admin_sessions WHERE token_hash = ?", [await tokenHash(token, env)]);
  return respond(request, env, { ok: true });
}

async function handleMe(request: Request, env: Env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  return respond(request, env, { user: { id: auth.auth.userId, username: auth.auth.username } });
}

async function handleChangePassword(request: Request, env: Env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  let body: JsonObject;
  try {
    body = await readJson(request);
  } catch (error) {
    return fail(request, env, 400, error instanceof Error ? error.message : "请求体格式错误");
  }
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (newPassword.length < 8) return fail(request, env, 400, "新密码至少需要 8 个字符");
  const user = await first<JsonObject>(env.DB, "SELECT password_hash FROM admin_users WHERE id = ?", [auth.auth.userId]);
  if (!user || !(await verifyPassword(currentPassword, String(user.password_hash)))) return fail(request, env, 401, "当前密码错误");
  await run(env.DB, "UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [await passwordHash(newPassword), auth.auth.userId]);
  return respond(request, env, { ok: true });
}

async function questionListResponse(request: Request, env: Env, includeDisabled: boolean) {
  const questions = await listQuestionRecords(env, includeDisabled);
  return respond(request, env, {
    questions: questions.map((question) => {
      const resolved = questionWithPublicAssetUrls(question, env);
      return includeDisabled ? adminQuestion(resolved) : publicQuestion(resolved);
    }),
    count: questions.length,
  });
}

async function handleAdminQuestionCollection(request: Request, env: Env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (request.method === "GET") return questionListResponse(request, env, true);
  let body: JsonObject;
  try {
    body = await readJson(request);
  } catch (error) {
    return fail(request, env, 400, error instanceof Error ? error.message : "请求体格式错误");
  }
  if (request.method === "POST") {
    const question = normalizeQuestionInput(body.question ?? body);
    const errors = validateQuestion(question);
    if (errors.length) return fail(request, env, 400, "题目校验失败", errors);
    try {
      await run(env.DB, QUESTION_INSERT, questionColumns(question));
    } catch (error) {
      if (String(error).includes("UNIQUE") || String(error).includes("PRIMARY KEY")) return fail(request, env, 409, "题目 ID 已存在");
      return fail(request, env, 500, "保存题目失败");
    }
    return respond(request, env, { question: adminQuestion(question) }, 201);
  }
  return fail(request, env, 405, "不支持的请求方法");
}

async function handleAdminQuestionItem(request: Request, env: Env, id: string) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const current = await getQuestion(env, id);
  if (!current) return fail(request, env, 404, "题目不存在");
  if (request.method === "GET") return respond(request, env, { question: adminQuestion(current) });
  if (request.method === "DELETE") {
    await run(env.DB, "DELETE FROM questions WHERE id = ?", [id]);
    return respond(request, env, { ok: true, id });
  }
  if (!["PUT", "PATCH"].includes(request.method)) return fail(request, env, 405, "不支持的请求方法");
  let body: JsonObject;
  try {
    body = await readJson(request);
  } catch (error) {
    return fail(request, env, 400, error instanceof Error ? error.message : "请求体格式错误");
  }
  const question = normalizeQuestionInput({ ...current, ...object(body.question ?? body), id });
  question.revision = Number(current.revision ?? 1) + 1;
  const errors = validateQuestion(question);
  if (errors.length) return fail(request, env, 400, "题目校验失败", errors);
  await run(env.DB, `UPDATE questions SET
    title = ?, genre = ?, voice_count = ?, voice_order_json = ?, voice_labels_json = ?, clefs_json = ?,
    key_signature = ?, time_signature = ?, bwv = ?, measures = ?, measure_start = ?, measure_end = ?,
    duration = ?, bpm = ?, source = ?, source_label = ?, analysis = ?, license_note = ?, source_edition = ?,
    source_license = ?, max_rest_by_voice_json = ?, voices_json = ?, revision = ?, enabled = ?, sort_order = ?, updated_at = ?
    WHERE id = ?`, [...questionColumns(question).slice(1, -2), question.updatedAt, id]);
  return respond(request, env, { question: adminQuestion(question) });
}

async function handleImport(request: Request, env: Env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return fail(request, env, 400, error instanceof Error ? error.message : "请求体格式错误");
  }
  const source = Array.isArray(body) ? body : array((body as JsonObject)?.questions);
  if (!source.length) return fail(request, env, 400, "没有可导入的题目");
  const imported: string[] = [];
  const errors: JsonObject[] = [];
  for (const item of source) {
    const question = normalizeQuestionInput(item);
    const questionErrors = validateQuestion(question);
    if (questionErrors.length) {
      errors.push({ id: question.id, errors: questionErrors });
      continue;
    }
    await run(env.DB, `INSERT INTO questions (
      id, title, genre, voice_count, voice_order_json, voice_labels_json, clefs_json,
      key_signature, time_signature, bwv, measures, measure_start, measure_end,
      duration, bpm, source, source_label, analysis, license_note, source_edition,
      source_license, max_rest_by_voice_json, voices_json, revision, enabled, sort_order,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, genre = excluded.genre, voice_count = excluded.voice_count,
      voice_order_json = excluded.voice_order_json, voice_labels_json = excluded.voice_labels_json, clefs_json = excluded.clefs_json,
      key_signature = excluded.key_signature, time_signature = excluded.time_signature, bwv = excluded.bwv, measures = excluded.measures,
      measure_start = excluded.measure_start, measure_end = excluded.measure_end, duration = excluded.duration, bpm = excluded.bpm,
      source = excluded.source, source_label = excluded.source_label, analysis = excluded.analysis, license_note = excluded.license_note,
      source_edition = excluded.source_edition, source_license = excluded.source_license, max_rest_by_voice_json = excluded.max_rest_by_voice_json,
      voices_json = excluded.voices_json, revision = excluded.revision, enabled = excluded.enabled, sort_order = excluded.sort_order,
      updated_at = excluded.updated_at`, questionColumns(question));
    imported.push(question.id);
  }
  return respond(request, env, { imported, errors, count: imported.length });
}

async function handleSettings(request: Request, env: Env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (request.method === "GET") return respond(request, env, { rules: await getRules(env), inventory: await inventory(env) });
  if (!["PUT", "PATCH", "POST"].includes(request.method)) return fail(request, env, 405, "不支持的请求方法");
  let body: JsonObject;
  try {
    body = await readJson(request);
  } catch (error) {
    return fail(request, env, 400, error instanceof Error ? error.message : "请求体格式错误");
  }
  const result = await saveRules(env, body.rules ?? body);
  if (!result.ok) return fail(request, env, 400, "规则校验失败", result.check.errors);
  return respond(request, env, { rules: result.rules, inventory: await inventory(env) });
}

async function handleSimulationDraw(request: Request, env: Env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  let body: JsonObject = {};
  if (request.method === "POST") {
    try {
      body = await readJson(request);
    } catch (error) {
      return fail(request, env, 400, error instanceof Error ? error.message : "请求体格式错误");
    }
  }
  const currentRules = await getRules(env);
  const requestedRules = object(body.rules);
  const rules = body.rules
    ? {
        ...currentRules,
        ...requestedRules,
        allocation: { ...object(currentRules.allocation), ...object(requestedRules.allocation) },
        scoreWeights: { ...object(currentRules.scoreWeights), ...object(requestedRules.scoreWeights) },
      }
    : currentRules;
  const check = validateRules(rules, await inventory(env));
  if (!check.ok) return fail(request, env, 400, "模拟规则校验失败", check.errors);
  const seed = body.seed === undefined ? null : Number(body.seed);
  const random = seed === null || !Number.isFinite(seed) ? Math.random : seededRandom(seed);
  const selected = drawQuestions(await listQuestionRecords(env, false), check.rules, random) as JsonObject[];
  return respond(request, env, {
    rules: check.rules,
    seed,
    questions: selected.map((question) => adminQuestion(questionWithPublicAssetUrls(question, env))),
    count: selected.length,
  });
}

async function handleSimulationScore(request: Request, env: Env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  let body: JsonObject;
  try {
    body = await readJson(request);
  } catch (error) {
    return fail(request, env, 400, error instanceof Error ? error.message : "请求体格式错误");
  }
  const rules = body.rules ? body.rules : await getRules(env);
  const questionIds = array(body.questionIds).map(String);
  const questions = questionIds.length
    ? (await Promise.all(questionIds.map((id) => getQuestion(env, id)))).filter(Boolean) as JsonObject[]
    : array(body.questions).map((item) => normalizeQuestionInput(item));
  if (!questions.length) return fail(request, env, 400, "没有可评分的模拟题目");
  return respond(request, env, { rules, score: scoreSelections(questions, sanitizeSelections(body.selections), rules) });
}

function bucket(env: Env) {
  return env.R2 ?? env.ASSETS;
}

function assetKey(value: string) {
  try {
    const key = decodeURIComponent(value).replace(/^\/+/, "");
    if (!key || key.includes("..") || key.includes("\\")) return null;
    return key;
  } catch {
    return null;
  }
}

function extension(value: string) {
  const match = value.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function contentType(key: string) {
  switch (extension(key)) {
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "svg": return "image/svg+xml";
    case "musicxml":
    case "xml": return "application/xml";
    default: return "application/octet-stream";
  }
}

async function handleAssetGet(request: Request, env: Env, rawKey: string) {
  const store = bucket(env);
  if (!store) return fail(request, env, 503, "R2 资源桶未配置");
  const key = assetKey(rawKey);
  if (!key) return fail(request, env, 400, "资源路径不合法");
  const item = await store.get(key);
  if (!item) return fail(request, env, 404, "资源不存在");
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", item.httpMetadata?.contentType ?? contentType(key));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(item.body, { headers });
}

async function handleAssetUpload(request: Request, env: Env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const store = bucket(env);
  if (!store) return fail(request, env, 503, "R2 资源桶未配置");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(request, env, 400, "资源上传必须使用 multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(request, env, 400, "缺少 file 文件字段");
  if (file.size > MAX_UPLOAD_BYTES) return fail(request, env, 413, "资源文件不能超过 30MB");
  const questionId = String(form.get("questionId") ?? "").trim();
  const revision = String(form.get("revision") ?? "").trim();
  const voice = String(form.get("voice") ?? "").trim();
  const candidateId = String(form.get("candidateId") ?? "").trim();
  const fileExtension = extension(file.name);
  if (!fileExtension || !ALLOWED_ASSET_EXTENSIONS.has(fileExtension)) return fail(request, env, 400, "只允许上传 mp3、wav、musicxml、xml 或 svg 文件");
  const acceptedMimeTypes = ALLOWED_ASSET_MIME_TYPES[fileExtension];
  if (!acceptedMimeTypes?.has(file.type.toLowerCase())) return fail(request, env, 400, "文件 MIME 类型与扩展名不匹配");
  const safeSegment = /^[A-Za-z0-9_-]+$/;
  if (!safeSegment.test(questionId) || !/^\d+$/.test(revision) || !safeSegment.test(voice) || !safeSegment.test(candidateId)) {
    return fail(request, env, 400, "questionId、revision、voice 或 candidateId 缺失或格式不合法");
  }
  let key = `questions/${questionId}/${revision}/${voice}/${candidateId}.${fileExtension}`;
  key = assetKey(key) ?? "";
  if (!key || !ALLOWED_ASSET_EXTENSIONS.has(extension(key))) return fail(request, env, 400, "只允许上传 mp3、wav、musicxml、xml 或 svg 文件");
  const bytes = await file.arrayBuffer();
  if (["musicxml", "xml"].includes(fileExtension)) {
    const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.byteLength, 65_536)));
    if (!/<(?:score-partwise|score-timewise)\b/i.test(head) || !/<part-list\b/i.test(head)) {
      return fail(request, env, 400, "MusicXML 缺少 score-partwise/score-timewise 或 part-list 根本结构");
    }
  }
  if (await store.head(key)) {
    return fail(request, env, 409, "该版本资源已存在；请提升题目 revision 后再上传");
  }
  await store.put(key, bytes, { httpMetadata: { contentType: file.type } });
  const base = new URL(request.url).origin;
  return respond(request, env, { key, url: `${base}/api/assets/${key}`, size: file.size, contentType: file.type }, 201);
}

async function handleAssetDelete(request: Request, env: Env, rawKey: string) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const store = bucket(env);
  if (!store) return fail(request, env, 503, "R2 资源桶未配置");
  const key = assetKey(rawKey);
  if (!key) return fail(request, env, 400, "资源路径不合法");
  const references = await rows<JsonObject>(env.DB, "SELECT id FROM questions WHERE voices_json LIKE ? LIMIT 5", [`%${key}%`]);
  if (references.length) return fail(request, env, 409, "资源仍被题目引用，不能直接删除", references.map((row) => row.id));
  await store.delete(key);
  return respond(request, env, { ok: true, key });
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$|^\s+/g, "") || "/";
  if (request.method === "OPTIONS") return requestOriginAllowed(request, env) ? new Response(null, { status: 204, headers: corsHeaders(request, env) }) : fail(request, env, 403, "请求来源不在允许列表中");
  if (!requestOriginAllowed(request, env)) return fail(request, env, 403, "请求来源不在允许列表中");
  if (path === "/" || path === "/health" || path === "/api/health") {
    return respond(request, env, {
      ok: true,
      service: "bach-chorale-puzzle-api",
      timestamp: isoNow(),
      rules: await getRules(env),
      inventory: await inventory(env),
    });
  }
  if (path === "/api/auth/login" && request.method === "POST") return handleLogin(request, env);
  if (path === "/api/auth/logout" && request.method === "POST") return handleLogout(request, env);
  if (path === "/api/auth/me" && request.method === "GET") return handleMe(request, env);
  if (path === "/api/auth/change-password" && request.method === "POST") return handleChangePassword(request, env);
  if (path === "/api/game/sessions" && request.method === "POST") return handleCreateGame(request, env);
  const submitMatch = path.match(/^\/api\/game\/sessions\/([^/]+)\/submit$/);
  if (submitMatch && request.method === "POST") return handleSubmitGame(request, env, decodeURIComponent(submitMatch[1]));
  const adminCollection = path === "/api/admin/questions" || path === "/api/questions/admin";
  if (path === "/api/admin/questions/import" && request.method === "POST") return handleImport(request, env);
  const adminItem = path.match(/^\/api\/(?:admin\/questions|questions\/admin)\/([^/]+)$/);
  if (adminCollection) return handleAdminQuestionCollection(request, env);
  if (adminItem) return handleAdminQuestionItem(request, env, decodeURIComponent(adminItem[1]));
  if (path === "/api/admin/settings" || path === "/api/admin/rules") return handleSettings(request, env);
  if (path === "/api/admin/simulation/draw" && ["GET", "POST"].includes(request.method)) return handleSimulationDraw(request, env);
  if (path === "/api/admin/simulation/score" && request.method === "POST") return handleSimulationScore(request, env);
  if (path === "/api/admin/assets/upload" && request.method === "POST") return handleAssetUpload(request, env);
  const adminAssetMatch = path.match(/^\/api\/admin\/assets\/(.+)$/);
  if (adminAssetMatch && request.method === "DELETE") return handleAssetDelete(request, env, adminAssetMatch[1]);
  const assetMatch = path.match(/^\/api\/assets\/(.+)$/);
  if (assetMatch && request.method === "GET") return handleAssetGet(request, env, assetMatch[1]);
  return fail(request, env, 404, "接口不存在");
}

const worker = {
  async fetch(request: Request, env: Env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return fail(request, env, 500, "服务器内部错误");
    }
  },
};

export default worker;
