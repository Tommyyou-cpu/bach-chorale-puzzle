"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import {
  ApiError,
  changePassword,
  createAdminQuestion,
  currentUser,
  deleteAdminQuestion,
  getAdminRules,
  listAdminQuestions,
  login,
  requestJson,
  logout,
  simulateDraw,
  submitGameSession,
  updateAdminQuestion,
  updateAdminRules,
  type AdminQuestion,
  type AdminRulesResponse,
  type DrawSimulation,
  type GameRules,
  type GameSession,
  type PublicCandidate,
  type PublicQuestion,
  type SubmitResult,
  type AuthUser,
} from "../lib/api-client";
import { useAudioPlayer, type AudioPlayRequest } from "../use-audio-player";

const TOKEN_KEY = "bach-puzzle-admin-token";
type Tab = "questions" | "rules" | "draw" | "answer" | "upload";

type QuestionForm = {
  id: string;
  title: string;
  genre: string;
  voiceCount: 3 | 4;
  voiceOrderText: string;
  voiceLabelsText: string;
  clefsText: string;
  keySignature: string;
  timeSignature: string;
  bwv: string;
  measures: string;
  measureStart: string;
  measureEnd: string;
  duration: number;
  bpm: number;
  source: string;
  sourceLabel: string;
  analysis: string;
  licenseNote: string;
  sourceEdition: string;
  sourceLicense: string;
  maxRestByVoiceText: string;
  revision: number;
  voicesText: string;
  enabled: boolean;
  sortOrder: number;
};

const DEFAULT_RULES: GameRules = {
  questionsPerGame: 3,
  allocation: { chorale: 3, fugue: 0, other: 0 },
  scoreWeights: { completeQuestion: 25, voiceAccuracy: 75 },
  revision: 0,
};

const panelStyle: CSSProperties = { maxWidth: 1320, margin: "0 auto", padding: "28px 5vw 90px" };
const cardStyle: CSSProperties = { border: "1px solid var(--line)", background: "rgba(252,250,244,.84)", padding: 22, marginTop: 18 };
const inputStyle: CSSProperties = { width: "100%", border: "1px solid var(--line)", background: "var(--white)", padding: "9px 10px", color: "var(--ink)" };
const buttonStyle: CSSProperties = { border: "1px solid var(--gold-dark)", background: "var(--gold-dark)", color: "white", padding: "9px 14px", cursor: "pointer" };

function displayError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}

function defaultCandidate(voice: string, index: number, original = index === 0) {
  return { id: `${voice}-${index + 1}`, audio: "", audioFallback: "", score: "", isOriginal: original, variant: index, decoyType: original ? "original" : "mixed", explanation: "" };
}

function emptyForm(): QuestionForm {
  const voices = ["soprano", "alto", "tenor", "bass"];
  return {
    id: "", title: "", genre: "chorale", voiceCount: 4,
    voiceOrderText: JSON.stringify(voices, null, 2),
    voiceLabelsText: JSON.stringify({ soprano: "女高音", alto: "女低音", tenor: "男高音", bass: "男低音" }, null, 2),
    clefsText: JSON.stringify({ soprano: "treble", alto: "alto", tenor: "treble-8", bass: "bass" }, null, 2),
    keySignature: "C major", timeSignature: "4/4", bwv: "", measures: "", measureStart: "", measureEnd: "", duration: 15, bpm: 60,
    source: "", sourceLabel: "", analysis: "", licenseNote: "", sourceEdition: "", sourceLicense: "", maxRestByVoiceText: "{}", revision: 1,
    voicesText: JSON.stringify(Object.fromEntries(voices.map((voice) => [voice, [0, 1, 2].map((index) => defaultCandidate(voice, index))])), null, 2),
    enabled: true, sortOrder: 0,
  };
}

function formFromQuestion(question: AdminQuestion): QuestionForm {
  return {
    id: question.id, title: question.title, genre: question.genre, voiceCount: question.voiceCount,
    voiceOrderText: JSON.stringify(question.voiceOrder, null, 2),
    voiceLabelsText: JSON.stringify(question.voiceLabels, null, 2),
    clefsText: JSON.stringify(question.clefs, null, 2), keySignature: question.keySignature, timeSignature: question.timeSignature || "4/4",
    bwv: question.bwv, measures: question.measures, measureStart: question.measureStart == null ? "" : String(question.measureStart), measureEnd: question.measureEnd == null ? "" : String(question.measureEnd), duration: question.duration, bpm: question.bpm,
    source: question.source, sourceLabel: question.sourceLabel, analysis: question.analysis || "", licenseNote: question.licenseNote || "", sourceEdition: question.sourceEdition || "", sourceLicense: question.sourceLicense || "", maxRestByVoiceText: JSON.stringify(question.maxRestByVoice || {}, null, 2), revision: question.revision || 1,
    voicesText: JSON.stringify(question.voices, null, 2), enabled: question.enabled, sortOrder: question.sortOrder,
  };
}

function adminCandidateForPublic(
  questions: AdminQuestion[],
  question: PublicQuestion,
  voice: string,
  candidate: PublicCandidate,
) {
  const managed = questions.find((item) => item.id === question.id);
  return managed?.voices[voice]?.find((item) => item.audio === candidate.audio && item.score === candidate.score);
}

function AuthPanel({ onLogin }: { onLogin: (token: string, user?: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await login(username, password);
      const token = result.token || result.accessToken || result.sessionToken;
      if (!token) throw new Error("登录接口没有返回令牌。");
      onLogin(token, result.user);
    } catch (caught) { setError(displayError(caught)); } finally { setBusy(false); }
  };
  return <main style={panelStyle}><header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><p className="eyebrow">THE BACH PUZZLE · ADMIN</p><h1 style={{ margin: "8px 0", fontFamily: "Noto Serif SC, Songti SC, serif" }}>题库维护</h1></div><Link href="../" style={{ color: "var(--gold-dark)" }}>返回挑战</Link></header><section style={{ ...cardStyle, maxWidth: 460, margin: "32px auto" }}><h2 style={{ marginTop: 0 }}>管理员登录</h2><p style={{ color: "var(--muted)", lineHeight: 1.7 }}>使用管理员账号进入题库、规则和模拟工具。登录令牌只保存在当前浏览器会话。</p><p role="note" style={{ color: "#8a5a18", background: "#fff5d7", border: "1px solid #e8cc8a", padding: "10px 12px", lineHeight: 1.6 }}>默认管理员密码属于临时初始凭据，存在泄露风险；首次登录后请立即在“规则与权重”中修改密码。页面不会显示默认密码。</p><form onSubmit={submit} style={{ display: "grid", gap: 14 }}><label>用户名<input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} style={inputStyle} /></label><label>密码<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle} /></label>{error && <p role="alert" style={{ color: "#9d3025", whiteSpace: "pre-line" }}>{error}</p>}<button type="submit" disabled={busy} style={buttonStyle}>{busy ? "登录中…" : "登录"}</button></form></section></main>;
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | undefined>();
  const [checking, setChecking] = useState(true);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [rules, setRules] = useState<GameRules>(DEFAULT_RULES);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [form, setForm] = useState<QuestionForm>(() => emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("questions");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draw, setDraw] = useState<DrawSimulation | null>(null);
  const [seed, setSeed] = useState("");
  const [drawRuns, setDrawRuns] = useState("1");
  const [drawQuestionCounts, setDrawQuestionCounts] = useState<Record<string, number>>({});
  const [drawCategoryCounts, setDrawCategoryCounts] = useState<Record<string, number>>({});
  const [simulateSession, setSimulateSession] = useState<GameSession | null>(null);
  const [simulateSelections, setSimulateSelections] = useState<Record<string, Record<string, string>>>({});
  const [simulateResult, setSimulateResult] = useState<SubmitResult | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [genreFilter, setGenreFilter] = useState("");
  const [voiceCountFilter, setVoiceCountFilter] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"" | "enabled" | "disabled">("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const audioPlayer = useAudioPlayer();
  const player = {
    ...audioPlayer,
    play: (request: AudioPlayRequest) => {
      if (request.label.endsWith("当前合奏") && simulateSession) {
        const question = simulateSession.questions.find((item) => request.label.startsWith(item.id));
        if (question) {
          const selectedVoices = question.voiceOrder.filter((voice) => {
            const selectedId = simulateSelections[question.id]?.[voice];
            const candidate = question.voices[voice]?.find((item) => item.id === selectedId);
            return Boolean(candidate && request.paths.includes(candidate.audio));
          });
          audioPlayer.play({ ...request, voiceKeys: selectedVoices });
          return;
        }
      }
      audioPlayer.play(request);
    },
  };

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY);
    if (!saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecking(false);
      return;
    }
    currentUser(saved).then((result) => { setToken(saved); setUser(result.user); }).catch(() => window.sessionStorage.removeItem(TOKEN_KEY)).finally(() => setChecking(false));
  }, []);

  const handleLogin = (nextToken: string, nextUser?: AuthUser) => { window.sessionStorage.setItem(TOKEN_KEY, nextToken); setToken(nextToken); setUser(nextUser); setChecking(false); };
  const signOut = async () => { if (token) { try { await logout(token); } catch { /* 令牌失效也继续清理 */ } } window.sessionStorage.removeItem(TOKEN_KEY); setToken(null); setUser(undefined); };

  const loadAll = async () => {
    if (!token) return;
    setBusy(true); setError("");
    try {
      const [questionResult, ruleResult] = await Promise.all([listAdminQuestions(token), getAdminRules(token).catch(() => ({ rules: DEFAULT_RULES } as AdminRulesResponse))]);
      setQuestions(questionResult.questions || []); if (questionResult.warning) setMessage(questionResult.warning);
      setRules(ruleResult.rules || DEFAULT_RULES); setCounts(ruleResult.counts || ruleResult.inventory || {});
    } catch (caught) { if (caught instanceof ApiError && caught.status === 401) await signOut(); else setError(displayError(caught)); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const sortedQuestions = useMemo(() => questions.slice().filter((question) => {
    if (genreFilter && question.genre !== genreFilter) return false;
    if (voiceCountFilter && String(question.voiceCount) !== voiceCountFilter) return false;
    if (enabledFilter === "enabled" && !question.enabled) return false;
    if (enabledFilter === "disabled" && question.enabled) return false;
    if (sourceFilter) {
      const haystack = `${question.sourceLabel} ${question.source} ${question.sourceEdition || ""}`.toLowerCase();
      if (!haystack.includes(sourceFilter.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)), [enabledFilter, genreFilter, questions, sourceFilter, voiceCountFilter]);
  const updateField = <K extends keyof QuestionForm>(key: K, value: QuestionForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const editQuestion = (question: AdminQuestion) => { setEditingId(question.id); setForm(formFromQuestion(question)); setTab("questions"); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const startNew = () => { setEditingId(null); setForm(emptyForm()); setError(""); };

  const saveQuestion = async (event: FormEvent) => {
    event.preventDefault(); if (!token) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const voiceOrder = JSON.parse(form.voiceOrderText) as unknown;
      const voiceLabels = JSON.parse(form.voiceLabelsText) as unknown;
      const clefs = JSON.parse(form.clefsText) as unknown;
      const voices = JSON.parse(form.voicesText) as unknown;
      const maxRestByVoice = JSON.parse(form.maxRestByVoiceText) as unknown;
      const payload = { id: form.id, title: form.title, genre: form.genre, voiceCount: Number(form.voiceCount), voiceOrder, voiceLabels, clefs, keySignature: form.keySignature, bwv: form.bwv, measures: form.measures, duration: Number(form.duration), bpm: Number(form.bpm), source: form.source, sourceLabel: form.sourceLabel, analysis: form.analysis, licenseNote: form.licenseNote, voices, enabled: form.enabled, sortOrder: Number(form.sortOrder) };
      Object.assign(payload, {
        timeSignature: form.timeSignature,
        measureStart: form.measureStart === "" ? null : Number(form.measureStart),
        measureEnd: form.measureEnd === "" ? null : Number(form.measureEnd),
        sourceEdition: form.sourceEdition,
        sourceLicense: form.sourceLicense,
        maxRestByVoice,
        revision: Number(form.revision),
      });
      const result = editingId ? await updateAdminQuestion(token, editingId, { ...payload, id: undefined }) : await createAdminQuestion(token, payload);
      setMessage(editingId ? "题目已更新。" : "题目已创建。"); if (result.question) { setQuestions((current) => editingId ? current.map((item) => item.id === editingId ? result.question! : item) : [...current, result.question!]); if (!editingId) setEditingId(result.question.id); }
    } catch (caught) { setError(caught instanceof Error && caught.message.includes("JSON") ? "声部、谱号或顺序 JSON 格式不正确。" : displayError(caught)); } finally { setBusy(false); }
  };

  const toggleQuestion = async (question: AdminQuestion) => { if (!token) return; try { const result = await updateAdminQuestion(token, question.id, { enabled: !question.enabled }); if (result.question) setQuestions((current) => current.map((item) => item.id === question.id ? result.question! : item)); } catch (caught) { setError(displayError(caught)); } };
  const removeQuestion = async (question: AdminQuestion) => { if (!token || !window.confirm(`确定删除题目“${question.id}”吗？`)) return; try { await deleteAdminQuestion(token, question.id); setQuestions((current) => current.filter((item) => item.id !== question.id)); setMessage(`已删除 ${question.id}`); } catch (caught) { setError(displayError(caught)); } };

  const saveRules = async (event: FormEvent) => { event.preventDefault(); if (!token) return; setBusy(true); setError(""); try { const total = Object.values(rules.allocation).reduce((sum, value) => sum + Number(value || 0), 0); if (total !== Number(rules.questionsPerGame)) throw new Error("分类配额之和必须等于每局题数。"); if (rules.scoreWeights.completeQuestion + rules.scoreWeights.voiceAccuracy !== 100) throw new Error("两项评分权重之和必须等于 100%。"); const result = await updateAdminRules(token, rules); setRules(result.rules); setCounts(result.counts || result.inventory || counts); setMessage("抽题与评分规则已保存。"); } catch (caught) { setError(displayError(caught)); } finally { setBusy(false); } };

  const runDraw = async () => {
    if (!token) return;
    const totalRuns = Math.max(1, Math.min(100, Math.trunc(Number(drawRuns) || 1)));
    const requestedSeed = seed === "" ? Date.now() : Number(seed);
    if (!Number.isFinite(requestedSeed)) { setError("随机种子必须是数字。"); return; }
    setBusy(true); setError("");
    try {
      const questionCounts: Record<string, number> = {};
      const categoryCounts: Record<string, number> = {};
      let latest: DrawSimulation | null = null;
      for (let index = 0; index < totalRuns; index += 1) {
        latest = await simulateDraw(token, { seed: requestedSeed + index, rules });
        for (const question of latest.questions) {
          questionCounts[question.id] = (questionCounts[question.id] || 0) + 1;
          categoryCounts[question.genre] = (categoryCounts[question.genre] || 0) + 1;
        }
      }
      setDraw(latest);
      setDrawQuestionCounts(questionCounts);
      setDrawCategoryCounts(categoryCounts);
      setMessage(`已连续模拟 ${totalRuns} 次；第 n 次使用种子 ${requestedSeed} + n - 1。`);
    } catch (caught) { setError(displayError(caught)); }
    finally { setBusy(false); }
  };
  const beginSimulation = async () => { setBusy(true); setError(""); try { const next = await requestJson<GameSession>("/game/sessions", { method: "POST", body: JSON.stringify({}) }, token || undefined); setSimulateSession(next); setSimulateSelections({}); setSimulateResult(null); } catch (caught) { setError(displayError(caught)); } finally { setBusy(false); } };
  const submitSimulation = async () => { if (!simulateSession) return; setBusy(true); try { setSimulateResult(await submitGameSession(simulateSession.sessionId, simulateSelections)); } catch (caught) { setError(displayError(caught)); } finally { setBusy(false); } };
  const doChangePassword = async () => { if (!token || newPassword.length < 8) { setError("新密码至少需要 8 个字符。"); return; } const currentPassword = window.prompt("请输入当前密码"); if (!currentPassword) return; try { await changePassword(token, currentPassword, newPassword); setNewPassword(""); setMessage("密码已更新。"); } catch (caught) { setError(displayError(caught)); } };

  if (checking) return <main style={panelStyle}><p className="status-message">正在验证管理员会话……</p></main>;
  if (!token) return <AuthPanel onLogin={handleLogin} />;

  const tabs: Array<[Tab, string]> = [["questions", "题库与答案"], ["rules", "规则与权重"], ["draw", "模拟抽取"], ["answer", "模拟答题"], ["upload", "上传资源"]];
  return <main style={panelStyle}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}><div><p className="eyebrow">THE BACH PUZZLE · ADMIN</p><h1 style={{ margin: "8px 0", fontFamily: "Noto Serif SC, Songti SC, serif" }}>题库维护</h1><p style={{ margin: 0, color: "var(--muted)" }}>已登录：{user?.username || user?.email || "管理员"} · {questions.length} 道题</p></div><nav style={{ display: "flex", gap: 10, alignItems: "center" }}><Link href="../" style={{ color: "var(--gold-dark)" }}>返回挑战</Link><button type="button" style={{ ...buttonStyle, background: "transparent", color: "var(--gold-dark)" }} onClick={() => void loadAll()}>刷新</button><button type="button" style={{ ...buttonStyle, background: "transparent", color: "#9d3025", borderColor: "#9d3025" }} onClick={() => void signOut()}>退出</button></nav></header>
    {(message || error) && <p role={error ? "alert" : "status"} style={{ ...cardStyle, marginTop: 16, color: error ? "#9d3025" : "var(--gold-dark)", whiteSpace: "pre-line" }}>{error || message}</p>}
    <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 24 }} aria-label="后台功能"><button type="button" onClick={startNew} style={{ ...buttonStyle, background: "transparent", color: "var(--gold-dark)" }}>新建题目</button>{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} style={{ ...buttonStyle, background: tab === id ? "var(--gold-dark)" : "transparent", color: tab === id ? "white" : "var(--gold-dark)" }}>{label}</button>)}</nav>

    {tab === "questions" && <>
      <section style={{ ...cardStyle, display: "grid", gap: 12 }}><h2 style={{ margin: 0, fontSize: "1.1rem" }}>谱面元数据</h2><p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>这些字段会随题目一起保存，用于核对谱号、调号、拍号和片段边界。</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}><label>拍号<input value={form.timeSignature} onChange={(event) => updateField("timeSignature", event.target.value)} style={inputStyle} /></label><label>起始小节<input type="number" min={1} value={form.measureStart} onChange={(event) => updateField("measureStart", event.target.value)} style={inputStyle} /></label><label>结束小节<input type="number" min={1} value={form.measureEnd} onChange={(event) => updateField("measureEnd", event.target.value)} style={inputStyle} /></label><label>题目版本（只读）<input readOnly value={form.revision} style={{ ...inputStyle, background: "var(--paper-deep)" }} /></label></div><label>来源版本 / 版本说明<input value={form.sourceEdition} onChange={(event) => updateField("sourceEdition", event.target.value)} style={inputStyle} /></label><label>来源许可<input value={form.sourceLicense} onChange={(event) => updateField("sourceLicense", event.target.value)} style={inputStyle} /></label><label>各声部最长休止 JSON<textarea rows={3} value={form.maxRestByVoiceText} onChange={(event) => updateField("maxRestByVoiceText", event.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace,monospace", fontSize: 12 }} /></label></section>
      <section style={cardStyle}><h2 style={{ marginTop: 0 }}>{editingId ? `编辑题目：${editingId}` : "新建题目"}</h2><form onSubmit={saveQuestion} style={{ display: "grid", gap: 14 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}><label>题目 ID<input required disabled={Boolean(editingId)} value={form.id} onChange={(event) => updateField("id", event.target.value)} style={inputStyle} /></label><label>标题<input required value={form.title} onChange={(event) => updateField("title", event.target.value)} style={inputStyle} /></label><label>体裁<input required value={form.genre} placeholder="chorale / fugue / other" onChange={(event) => updateField("genre", event.target.value)} style={inputStyle} /></label><label>声部数<select value={form.voiceCount} onChange={(event) => updateField("voiceCount", Number(event.target.value) as 3 | 4)} style={inputStyle}><option value={3}>三声部</option><option value={4}>四声部</option></select></label><label>调号<input required value={form.keySignature} onChange={(event) => updateField("keySignature", event.target.value)} style={inputStyle} /></label><label>BWV<input required value={form.bwv} onChange={(event) => updateField("bwv", event.target.value)} style={inputStyle} /></label><label>小节范围<input required value={form.measures} onChange={(event) => updateField("measures", event.target.value)} style={inputStyle} /></label><label>时长（秒）<input required type="number" min="0.1" step="0.1" value={form.duration} onChange={(event) => updateField("duration", Number(event.target.value))} style={inputStyle} /></label><label>BPM<input required type="number" min="1" max="400" value={form.bpm} onChange={(event) => updateField("bpm", Number(event.target.value))} style={inputStyle} /></label><label>排序<input type="number" value={form.sortOrder} onChange={(event) => updateField("sortOrder", Number(event.target.value))} style={inputStyle} /></label><label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 24 }}><input type="checkbox" checked={form.enabled} onChange={(event) => updateField("enabled", event.target.checked)} />公开启用</label></div><label>来源链接<input required type="url" value={form.source} onChange={(event) => updateField("source", event.target.value)} style={inputStyle} /></label><label>来源名称<input required value={form.sourceLabel} onChange={(event) => updateField("sourceLabel", event.target.value)} style={inputStyle} /></label><label>听辨分析<textarea required rows={3} value={form.analysis} onChange={(event) => updateField("analysis", event.target.value)} style={inputStyle} /></label><label>许可说明<textarea required rows={2} value={form.licenseNote} onChange={(event) => updateField("licenseNote", event.target.value)} style={inputStyle} /></label><label>声部顺序 JSON<textarea required rows={3} value={form.voiceOrderText} onChange={(event) => updateField("voiceOrderText", event.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace,monospace", fontSize: 12 }} /></label><label>声部显示名称 JSON<textarea required rows={3} value={form.voiceLabelsText} onChange={(event) => updateField("voiceLabelsText", event.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace,monospace", fontSize: 12 }} /></label><label>谱号 JSON<textarea required rows={3} value={form.clefsText} onChange={(event) => updateField("clefsText", event.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace,monospace", fontSize: 12 }} /></label><label>声部候选 JSON（每个声部 3/4 项；恰有一个 isOriginal 为 true）<textarea required rows={18} value={form.voicesText} onChange={(event) => updateField("voicesText", event.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace,monospace", fontSize: 12 }} /></label><div style={{ display: "flex", gap: 10 }}><button type="submit" disabled={busy} style={{ ...buttonStyle, opacity: busy ? .55 : 1 }}>{busy ? "保存中…" : editingId ? "保存修改" : "创建题目"}</button>{editingId && <button type="button" onClick={startNew} style={{ ...buttonStyle, background: "transparent", color: "var(--gold-dark)" }}>取消编辑</button>}</div></form></section>
      <section style={cardStyle}><h2 style={{ marginTop: 0 }}>题目列表（{sortedQuestions.length}）</h2><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}><thead><tr>{["排序", "题目", "分类/声部", "候选与答案", "状态", "操作"].map((head) => <th key={head} style={{ textAlign: "left", padding: 8 }}>{head}</th>)}</tr></thead><tbody>{sortedQuestions.map((question) => <tr key={question.id} style={{ borderTop: "1px solid var(--line)", verticalAlign: "top" }}><td style={{ padding: 8 }}>{question.sortOrder}</td><td style={{ padding: 8 }}><strong>{question.id}</strong><br /><span style={{ color: "var(--muted)" }}>{question.title}</span><br /><small>{question.bwv} · {question.measures}</small></td><td style={{ padding: 8 }}>{question.genre}<br />{question.voiceCount} 声部</td><td style={{ padding: 8 }}>{Object.entries(question.voices).map(([voice, candidates]) => <details key={voice} style={{ marginBottom: 5 }}><summary>{question.voiceLabels?.[voice] || voice} · {candidates.length} 项</summary><ol style={{ margin: "5px 0", paddingLeft: 20 }}>{candidates.map((candidate) => <li key={candidate.id} style={{ color: candidate.isOriginal ? "#4b6746" : "var(--muted)" }}>{candidate.id}{candidate.isOriginal ? " · 正确答案" : candidate.decoyType ? ` · ${candidate.decoyType}` : ""}<br /><small>{candidate.explanation || ""}</small></li>)}</ol></details>)}</td><td style={{ padding: 8 }}><label><input type="checkbox" checked={question.enabled} onChange={() => void toggleQuestion(question)} /> {question.enabled ? "已启用" : "已停用"}</label></td><td style={{ padding: 8, whiteSpace: "nowrap" }}><button type="button" onClick={() => editQuestion(question)} style={{ ...buttonStyle, padding: "6px 10px" }}>编辑</button> <button type="button" onClick={() => void removeQuestion(question)} style={{ ...buttonStyle, padding: "6px 10px", background: "transparent", color: "#9d3025", borderColor: "#9d3025" }}>删除</button></td></tr>)}</tbody></table></div></section>
      <section style={{ ...cardStyle, display: "grid", gap: 12 }}><h2 style={{ margin: 0, fontSize: "1.1rem" }}>题目筛选</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}><label>体裁<select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)} style={inputStyle}><option value="">全部体裁</option><option value="chorale">chorale（众赞歌）</option><option value="fugue">fugue（赋格）</option><option value="other">other（其他）</option></select></label><label>声部数<select value={voiceCountFilter} onChange={(event) => setVoiceCountFilter(event.target.value)} style={inputStyle}><option value="">全部声部数</option><option value="3">三声部</option><option value="4">四声部</option></select></label><label>启用状态<select value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value as "" | "enabled" | "disabled")} style={inputStyle}><option value="">全部状态</option><option value="enabled">仅启用</option><option value="disabled">仅停用</option></select></label><label>来源文本<input value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} placeholder="来源名称、链接或版本" style={inputStyle} /></label></div><p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>当前显示 {sortedQuestions.length} / {questions.length} 道题。</p></section>
    </>}

    {tab === "rules" && <section style={cardStyle}><h2 style={{ marginTop: 0 }}>抽题与评分规则</h2><p style={{ color: "var(--muted)" }}>当前启用题量：{Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(" · ") || "等待接口返回"}</p><form onSubmit={saveRules} style={{ display: "grid", gap: 16, maxWidth: 720 }}><label>每局题数<input type="number" min={1} max={10} value={rules.questionsPerGame} onChange={(event) => setRules((current) => ({ ...current, questionsPerGame: Number(event.target.value) }))} style={inputStyle} /></label><fieldset style={{ border: "1px solid var(--line)", padding: 14 }}><legend>分类配额</legend><div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>{["chorale", "fugue", "other"].map((genre) => <label key={genre}>{genre}<input type="number" min={0} value={rules.allocation[genre] || 0} onChange={(event) => setRules((current) => ({ ...current, allocation: { ...current.allocation, [genre]: Number(event.target.value) } }))} style={inputStyle} /></label>)}</div></fieldset><fieldset style={{ border: "1px solid var(--line)", padding: 14 }}><legend>评分权重（总和必须为 100）</legend><div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}><label>完整猜中题目<input type="number" min={0} max={100} value={rules.scoreWeights.completeQuestion} onChange={(event) => setRules((current) => ({ ...current, scoreWeights: { ...current.scoreWeights, completeQuestion: Number(event.target.value) } }))} style={inputStyle} /></label><label>声部选项正确比例<input type="number" min={0} max={100} value={rules.scoreWeights.voiceAccuracy} onChange={(event) => setRules((current) => ({ ...current, scoreWeights: { ...current.scoreWeights, voiceAccuracy: Number(event.target.value) } }))} style={inputStyle} /></label></div></fieldset><button type="submit" disabled={busy} style={buttonStyle}>保存规则</button></form><section style={{ marginTop: 28, borderTop: "1px solid var(--line)", paddingTop: 18 }}><h3>修改管理员密码</h3><div style={{ display: "flex", gap: 10, maxWidth: 520 }}><input type="password" placeholder="新密码（至少 8 个字符）" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} style={inputStyle} /><button type="button" onClick={() => void doChangePassword()} style={buttonStyle}>更新密码</button></div></section></section>}

    {tab === "draw" && <section style={cardStyle}><h2 style={{ marginTop: 0 }}>模拟抽取</h2><p style={{ color: "var(--muted)" }}>使用当前规则检查分类配额，支持固定随机种子复现结果。</p><div style={{ display: "flex", gap: 10, maxWidth: 540 }}><input type="number" placeholder="随机种子（可选）" value={seed} onChange={(event) => setSeed(event.target.value)} style={inputStyle} /><button type="button" disabled={busy} onClick={() => void runDraw()} style={buttonStyle}>开始模拟</button></div>{draw && <div style={{ marginTop: 20 }}><p>规则版本 {draw.rules.revision} · {draw.rules.questionsPerGame} 题</p><ol>{draw.questions.map((question) => <li key={question.id}><strong>{question.id}</strong> · {question.genre} · {question.voiceCount} 声部 · {question.measures} · {question.title}</li>)}</ol>{draw.counts && <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(draw.counts, null, 2)}</pre>}</div>}</section>}
    {tab === "draw" && <section style={{ ...cardStyle, marginTop: 12 }}><h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>连续模拟设置</h2><div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}><label style={{ minWidth: 180 }}>运行次数<input type="number" min={1} max={100} value={drawRuns} onChange={(event) => setDrawRuns(event.target.value)} style={inputStyle} /></label><label style={{ minWidth: 240 }}>基础随机种子（同一基础种子可复现）<input type="number" value={seed} onChange={(event) => setSeed(event.target.value)} style={inputStyle} /></label><button type="button" disabled={busy} onClick={() => void runDraw()} style={buttonStyle}>运行并统计</button></div><p style={{ color: "var(--muted)", fontSize: 13 }}>每次调用正式模拟抽取接口，使用基础种子递增生成不同但可复现的运行。</p>{Object.keys(drawQuestionCounts).length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}><div><h3>各题出现次数</h3><ul>{Object.entries(drawQuestionCounts).sort(([left], [right]) => left.localeCompare(right)).map(([id, count]) => <li key={id}>{id}：{count} 次</li>)}</ul></div><div><h3>各分类出现次数</h3><ul>{Object.entries(drawCategoryCounts).map(([genre, count]) => <li key={genre}>{genre}：{count} 次</li>)}</ul></div></div>}</section>}

    {tab === "answer" && <section style={cardStyle}><h2 style={{ marginTop: 0 }}>模拟前端用户答题</h2><p style={{ color: "var(--muted)" }}>使用正式抽题、候选顺序和评分接口，验证三/四声部操作、试听、合奏和揭晓结果。</p><button type="button" disabled={busy} onClick={() => void beginSimulation()} style={buttonStyle}>{simulateSession ? "重新抽取" : "抽取一局"}</button>{simulateSession && <div style={{ display: "grid", gap: 16, marginTop: 20 }}>{simulateSession.questions.map((question) => <article key={question.id} style={{ border: "1px solid var(--line)", padding: 16 }}><h3 style={{ marginTop: 0 }}>{question.id} · {question.title}</h3>{question.voiceOrder.map((voice) => <fieldset key={voice} style={{ border: 0, padding: "8px 0" }}><legend>{question.voiceLabels[voice] || voice}</legend><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{question.voices[voice].map((candidate) => <div key={candidate.id} style={{ display: "flex", gap: 3 }}><button type="button" onClick={() => player.play({ paths: [candidate.audio], fallbackPaths: [candidate.audioFallback], label: `${question.voiceLabels[voice] || voice} ${candidate.id}`, voiceKeys: [voice] })} style={{ ...buttonStyle, padding: "6px 9px", background: "transparent", color: "var(--gold-dark)" }}>试听</button><button type="button" aria-pressed={simulateSelections[question.id]?.[voice] === candidate.id} onClick={() => setSimulateSelections((current) => ({ ...current, [question.id]: { ...(current[question.id] || {}), [voice]: candidate.id } }))} style={{ ...buttonStyle, padding: "6px 9px", background: simulateSelections[question.id]?.[voice] === candidate.id ? "var(--gold-dark)" : "transparent", color: simulateSelections[question.id]?.[voice] === candidate.id ? "white" : "var(--gold-dark)" }}>{candidate.id}</button></div>)}</div></fieldset>)}<div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}><button type="button" onClick={() => { const picks = question.voiceOrder.map((voice) => question.voices[voice].find((candidate) => simulateSelections[question.id]?.[voice] === candidate.id)).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)); const pickedVoices = question.voiceOrder.filter((voice) => question.voices[voice].some((candidate) => simulateSelections[question.id]?.[voice] === candidate.id)); if (picks.length >= 2) player.play({ paths: picks.map((candidate) => candidate.audio), fallbackPaths: picks.map((candidate) => candidate.audioFallback), label: `${question.id} 当前合奏`, voiceKeys: pickedVoices }); }} disabled={player.loading} style={buttonStyle}>播放当前合奏</button>{player.label && <span style={{ color: "var(--muted)", fontSize: 13 }}>{player.label}<span className="audio-progress" role="progressbar" aria-label="模拟播放进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(player.progress * 100)} aria-valuetext="正在播放"><span style={{ width: `${Math.round(player.progress * 100)}%` }} /></span></span>}</div></article>)}<button type="button" disabled={busy} onClick={() => void submitSimulation()} style={buttonStyle}>提交模拟答案</button></div>}{simulateResult && <section style={{ marginTop: 20 }}><h3>模拟评分：{simulateResult.score.totalScore} / 100</h3><pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{JSON.stringify(simulateResult.score.questionResults || simulateResult.results, null, 2)}</pre></section>}</section>}

    {tab === "answer" && simulateSession && <section style={{ ...cardStyle, marginTop: 12 }}><label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={showAnswers} onChange={(event) => setShowAnswers(event.target.checked)} />显示答案辅助模式（仅管理员可见）</label>{showAnswers && <div style={{ marginTop: 14 }}><p style={{ color: "var(--muted)", fontSize: 13 }}>答案通过已加载的管理员题库按音频与乐谱资源路径匹配，不会改变公开游戏接口。</p>{simulateSession.questions.map((question) => <details key={question.id} open><summary>{question.id} · {question.title}</summary><ul>{question.voiceOrder.map((voice) => { const managed = question.voices[voice].map((candidate) => adminCandidateForPublic(questions, question, voice, candidate)).find((candidate) => candidate?.isOriginal); return <li key={voice}>{question.voiceLabels[voice] || voice}：{managed?.id || "未找到对应管理员候选"}</li>; })}</ul></details>)}</div>}</section>}

    {tab === "upload" && <section style={cardStyle}><h2 style={{ marginTop: 0 }}>资源管理</h2><p style={{ color: "var(--muted)", lineHeight: 1.8 }}>当前生产部署未启用 R2（对象存储），因此后台不会上传或删除资源。内置题目的 MP3、WAV、MusicXML（音乐交换格式）和 SVG 文件随 GitHub Pages 静态站点发布。</p><p style={{ color: "var(--muted)", lineHeight: 1.8 }}>如需新增或替换资源，请把文件放入仓库的静态资源目录，更新题目资源路径后提交到 <code>main</code> 分支，GitHub Actions 会重新构建并发布。题库与规则仍可在本页通过 Worker 和 D1（边缘数据库）维护。</p><div role="status" style={{ border: "1px solid #e8cc8a", background: "#fff5d7", padding: "12px 14px", color: "#8a5a18" }}>资源上传接口已明确返回“未启用对象存储”，不会产生任何订阅或存储费用。</div></section>}
  </main>;
}
