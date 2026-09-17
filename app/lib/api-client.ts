"use client";

/**
 * 浏览器端与 Worker（边缘函数）的最小接口层。
 * NEXT_PUBLIC_API_BASE_URL 可以是 Worker 根地址，也可以是带 /api 的地址。
 * 公开客户端不会通过该模块读取答案字段；答案只在提交游戏会话后由服务端返回。
 */

export type DecoyType = "original" | "voice-leading" | "harmony" | "mixed";

export type PublicCandidate = {
  id: string;
  audio: string;
  audioFallback?: string;
  score: string;
  variant?: number;
};

export type PublicQuestion = {
  id: string;
  title: string;
  genre: string;
  voiceCount: 3 | 4;
  voiceOrder: string[];
  voiceLabels: Record<string, string>;
  clefs: Record<string, string>;
  keySignature: string;
  timeSignature?: string;
  bwv: string;
  measures: string;
  measureStart?: number | null;
  measureEnd?: number | null;
  duration: number;
  bpm: number;
  source: string;
  sourceLabel: string;
  analysis?: string;
  licenseNote?: string;
  sourceEdition?: string;
  sourceLicense?: string;
  maxRestByVoice?: Record<string, number | string>;
  revision?: number;
  voices: Record<string, PublicCandidate[]>;
};

export type GameRules = {
  questionsPerGame: number;
  allocation: {
    chorale: number;
    fugue: number;
    other: number;
    [key: string]: number;
  };
  scoreWeights: {
    completeQuestion: number;
    voiceAccuracy: number;
  };
  revision: number;
};

export type GameSession = {
  sessionId: string;
  expiresAt?: string;
  rules: GameRules;
  questions: PublicQuestion[];
};

export type RevealCandidate = PublicCandidate & {
  isOriginal: boolean;
  decoyType?: DecoyType;
  explanation?: string;
};

export type SubmittedQuestion = PublicQuestion & {
  voices: Record<string, RevealCandidate[]>;
};

export type SubmittedQuestionResult = {
  questionId: string;
  selected: Record<string, RevealCandidate | undefined>;
  originals: Record<string, RevealCandidate | undefined>;
  correctVoices: number;
  totalVoices: number;
  complete: boolean;
};

export type GameScore = {
  totalScore: number;
  questionPoints: number;
  voicePoints: number;
  questions: number;
  totalQuestions: number;
  voices: number;
  totalVoices: number;
  questionRatio?: number;
  voiceRatio?: number;
  questionResults?: ServerQuestionResult[];
};

export type ServerVoiceResult = {
  selectedId: string | null;
  correctId: string | null;
  correct: boolean;
  decoyType?: DecoyType | null;
  explanation?: string | null;
};

export type ServerQuestionResult = {
  id: string;
  genre?: string;
  correct: boolean;
  voices: Record<string, ServerVoiceResult>;
};

export type SubmitResult = {
  sessionId?: string;
  rules: GameRules;
  score: GameScore;
  questions?: SubmittedQuestion[];
  results?: SubmittedQuestionResult[];
};

export type AdminCandidate = RevealCandidate;

export type AdminQuestion = Omit<PublicQuestion, "voices"> & {
  voices: Record<string, AdminCandidate[]>;
  enabled: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
};

export type AdminListResponse = {
  questions: AdminQuestion[];
  count?: number;
  storage?: "database" | "static";
  warning?: string;
  configuration?: string;
};

export type AdminRulesResponse = {
  rules: GameRules;
  counts?: Record<string, number>;
  inventory?: Record<string, number>;
};

export type DrawSimulation = {
  questions: Array<Pick<PublicQuestion, "id" | "title" | "genre" | "voiceCount" | "voiceOrder" | "measures">>;
  rules: GameRules;
  seed?: number;
  counts?: Record<string, number>;
};

export type AuthUser = { username?: string; email?: string; role?: string };

const configuredBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
// 允许环境变量填写 Worker 根地址，也允许直接填写带 /api 的地址。
const apiRoot = configuredBase
  ? /\/api$/i.test(configuredBase) ? configuredBase : `${configuredBase}/api`
  : "/api";

export function apiUrl(path: string) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (/^https?:\/\//i.test(apiRoot)) return `${apiRoot}${cleanPath}`;
  return `${apiRoot}${cleanPath}`.replace(/([^:]\/)\/{2,}/g, "$1");
}

function errorText(response: Response, payload: unknown) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return `请求失败（${response.status}）`;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  const payload = await readPayload(response);
  if (!response.ok) throw new ApiError(errorText(response, payload), response.status, payload);
  return payload as T;
}

async function withLegacyFallback<T>(paths: string[], init: RequestInit, token?: string) {
  let last: unknown;
  for (const path of paths) {
    try {
      return await requestJson<T>(path, init, token);
    } catch (error) {
      last = error;
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) throw error;
    }
  }
  throw last instanceof Error ? last : new Error("接口不可用");
}

export function createGameSession() {
  return requestJson<GameSession>("/game/sessions", { method: "POST", body: JSON.stringify({}) });
}

export function submitGameSession(sessionId: string, selections: Record<string, Record<string, string>>) {
  return requestJson<SubmitResult>(`/game/sessions/${encodeURIComponent(sessionId)}/submit`, {
    method: "POST",
    body: JSON.stringify({ selections }),
  });
}

export function login(username: string, password: string) {
  return requestJson<{ token?: string; accessToken?: string; sessionToken?: string; user?: AuthUser }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
  );
}

export function currentUser(token: string) {
  return requestJson<{ user: AuthUser }>("/auth/me", {}, token);
}

export function logout(token: string) {
  return requestJson<{ ok: true }>("/auth/logout", { method: "POST", body: JSON.stringify({}) }, token);
}

export function changePassword(token: string, currentPassword: string, newPassword: string) {
  return requestJson<{ ok: true }>(
    "/auth/change-password",
    { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) },
    token,
  );
}

export function listAdminQuestions(token: string) {
  return withLegacyFallback<AdminListResponse>(
    ["/admin/questions", "/questions/admin"],
    {},
    token,
  );
}

export function createAdminQuestion(token: string, payload: unknown) {
  return withLegacyFallback<{ question: AdminQuestion }>(
    ["/admin/questions", "/questions/admin"],
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function updateAdminQuestion(token: string, id: string, payload: unknown) {
  return withLegacyFallback<{ question: AdminQuestion }>(
    [`/admin/questions/${encodeURIComponent(id)}`, `/questions/admin/${encodeURIComponent(id)}`],
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export function deleteAdminQuestion(token: string, id: string) {
  return withLegacyFallback<{ ok: true }>(
    [`/admin/questions/${encodeURIComponent(id)}`, `/questions/admin/${encodeURIComponent(id)}`],
    { method: "DELETE" },
    token,
  );
}

export function getAdminRules(token: string) {
  return withLegacyFallback<AdminRulesResponse>(["/admin/rules", "/rules"], {}, token);
}

export function updateAdminRules(token: string, rules: GameRules) {
  return withLegacyFallback<AdminRulesResponse>(
    ["/admin/rules", "/rules"],
    { method: "PUT", body: JSON.stringify(rules) },
    token,
  );
}

export function simulateDraw(token: string, payload: { seed?: number; rules?: GameRules; runs?: number }) {
  return withLegacyFallback<DrawSimulation>(
    ["/admin/simulation/draw", "/admin/simulate/draw", "/game/simulate/draw"],
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export function uploadAdminAsset(token: string, file: File, questionId: string, voice: string, candidateId: string, revision: number) {
  const body = new FormData();
  body.set("file", file);
  body.set("questionId", questionId);
  body.set("voice", voice);
  body.set("candidateId", candidateId);
  body.set("revision", String(revision));
  return withLegacyFallback<{ path?: string; key?: string; url?: string }>(
    ["/admin/assets/upload", "/admin/uploads", "/uploads"],
    { method: "POST", body },
    token,
  );
}
