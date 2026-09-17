"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";

type Candidate = {
  id: string;
  audio: string;
  audioFallback?: string;
  score: string;
  isOriginal: boolean;
  variant?: number;
  decoyType?: "original" | "voice-leading" | "harmony" | "mixed";
  explanation?: string;
};

type AdminQuestion = {
  id: string;
  title: string;
  genre: string;
  voiceCount: 3 | 4;
  clefs: Record<string, string>;
  keySignature: string;
  bwv: string;
  measures: string;
  duration: number;
  bpm: number;
  source: string;
  sourceLabel: string;
  analysis: string;
  licenseNote: string;
  voices: Record<string, Candidate[]>;
  enabled: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

type FormState = Omit<AdminQuestion, "voices" | "clefs" | "createdAt" | "updatedAt"> & {
  voicesText: string;
  clefsText: string;
};

type MutationResponse = { question?: AdminQuestion; error?: string };

const emptyForm = (): FormState => ({
  id: "",
  title: "",
  genre: "chorale",
  voiceCount: 4,
  clefsText: JSON.stringify({ soprano: "treble", alto: "alto", tenor: "treble-8", bass: "bass" }, null, 2),
  keySignature: "C major",
  bwv: "",
  measures: "",
  duration: 15,
  bpm: 60,
  source: "",
  sourceLabel: "",
  analysis: "",
  licenseNote: "",
  voicesText: JSON.stringify({ soprano: [], alto: [], tenor: [], bass: [] }, null, 2),
  enabled: true,
  sortOrder: 0,
});

const panelStyle: CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
  padding: "32px 5vw 80px",
};
const cardStyle: CSSProperties = {
  border: "1px solid var(--line)",
  background: "rgba(252,250,244,.82)",
  padding: 24,
  marginTop: 20,
};
const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--line)",
  background: "var(--white)",
  padding: "9px 10px",
  color: "var(--ink)",
};
const buttonStyle: CSSProperties = {
  border: "1px solid var(--gold-dark)",
  background: "var(--gold-dark)",
  color: "white",
  padding: "9px 14px",
  cursor: "pointer",
};

function displayError(response: Response, payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return `请求失败（${response.status}）`;
}

export default function AdminPage() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [storage, setStorage] = useState<"database" | "static" | null>(null);
  const [configuration, setConfiguration] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  async function loadQuestions() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/questions/admin", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        questions?: AdminQuestion[];
        storage?: "database" | "static";
        configuration?: string;
        warning?: string;
      };
      if (response.status === 401) {
        setNeedsSignIn(true);
        return;
      }
      if (!response.ok) throw new Error(displayError(response, payload));
      setNeedsSignIn(false);
      setQuestions(Array.isArray(payload.questions) ? payload.questions : []);
      setStorage(payload.storage ?? null);
      setConfiguration(payload.configuration ?? "");
      if (payload.warning) setMessage(payload.warning);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法加载题库");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQuestions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const sortedQuestions = useMemo(
    () => questions.slice().sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
    [questions],
  );

  function editQuestion(question: AdminQuestion) {
    setEditingId(question.id);
    setForm({
      id: question.id,
      title: question.title,
      genre: question.genre,
      voiceCount: question.voiceCount,
      clefsText: JSON.stringify(question.clefs, null, 2),
      keySignature: question.keySignature,
      bwv: question.bwv,
      measures: question.measures,
      duration: question.duration,
      bpm: question.bpm,
      source: question.source,
      sourceLabel: question.sourceLabel,
      analysis: question.analysis,
      licenseNote: question.licenseNote,
      voicesText: JSON.stringify(question.voices, null, 2),
      enabled: question.enabled,
      sortOrder: question.sortOrder,
    });
    setMessage(`正在编辑 ${question.id}`);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNew() {
    setEditingId(null);
    setForm(emptyForm());
    setMessage("已准备新题目表单");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    let voicesValue: unknown;
    let clefsValue: unknown;
    try {
      voicesValue = JSON.parse(form.voicesText);
      clefsValue = JSON.parse(form.clefsText);
    } catch {
      setError("声部或谱号 JSON 格式不正确，请检查逗号和引号。");
      setSaving(false);
      return;
    }

    const metadata = {
      id: form.id,
      title: form.title,
      genre: form.genre,
      voiceCount: form.voiceCount,
      keySignature: form.keySignature,
      bwv: form.bwv,
      measures: form.measures,
      duration: form.duration,
      bpm: form.bpm,
      source: form.source,
      sourceLabel: form.sourceLabel,
      analysis: form.analysis,
      licenseNote: form.licenseNote,
      enabled: form.enabled,
      sortOrder: form.sortOrder,
    };
    const payload = {
      ...metadata,
      duration: Number(form.duration),
      bpm: Number(form.bpm),
      sortOrder: Number(form.sortOrder),
      voices: voicesValue,
      clefs: clefsValue,
    };
    if (editingId) delete (payload as Partial<typeof payload>).id;

    try {
      const response = await fetch(
        editingId ? `/api/questions/admin/${encodeURIComponent(editingId)}` : "/api/questions/admin",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json().catch(() => ({}))) as MutationResponse;
      if (!response.ok) throw new Error(displayError(response, result));
      setMessage(editingId ? "题目已更新。" : "题目已创建。");
      await loadQuestions();
      if (!editingId && result.question?.id) setEditingId(result.question.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleQuestion(question: AdminQuestion) {
    setError("");
    try {
      const response = await fetch(`/api/questions/admin/${encodeURIComponent(question.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !question.enabled }),
      });
      const result = (await response.json().catch(() => ({}))) as MutationResponse;
      if (!response.ok) throw new Error(displayError(response, result));
      if (!result.question) throw new Error("服务器未返回更新后的题目");
      setQuestions((current) => current.map((item) => (item.id === question.id ? result.question! : item)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新启用状态失败");
    }
  }

  async function removeQuestion(question: AdminQuestion) {
    if (!window.confirm(`确定删除题目“${question.id}”吗？删除后需要重新创建。`)) return;
    setError("");
    try {
      const response = await fetch(`/api/questions/admin/${encodeURIComponent(question.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(displayError(response, result));
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      if (editingId === question.id) startNew();
      setMessage(`已删除 ${question.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    }
  }

  if (needsSignIn) {
    return (
      <main style={panelStyle}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
          <div>
            <p className="eyebrow">THE BACH PUZZLE · ADMIN</p>
            <h1 style={{ margin: "8px 0", fontFamily: "Noto Serif SC, Songti SC, serif" }}>题库维护</h1>
          </div>
          <Link href="/" style={{ color: "var(--gold-dark)" }}>返回挑战</Link>
        </header>
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>需要登录</h2>
          <p>请使用 ChatGPT 登录后再打开题库维护页面。</p>
          <a href="/signin-with-chatgpt?return_to=%2Fadmin" style={buttonStyle}>使用 ChatGPT 登录</a>
        </section>
      </main>
    );
  }

  return (
    <main style={panelStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow">THE BACH PUZZLE · ADMIN</p>
          <h1 style={{ margin: "8px 0", fontFamily: "Noto Serif SC, Songti SC, serif" }}>题库维护</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>管理题目正文、3/4 个候选声部、启用状态和展示顺序。</p>
        </div>
        <nav style={{ display: "flex", gap: 12 }}>
          <Link href="/" style={{ color: "var(--gold-dark)", alignSelf: "center" }}>返回挑战</Link>
          <button type="button" style={buttonStyle} onClick={startNew}>新建题目</button>
          <button type="button" style={{ ...buttonStyle, background: "transparent", color: "var(--gold-dark)" }} onClick={() => void loadQuestions()}>刷新</button>
        </nav>
      </header>

      {(message || error) && (
        <p role={error ? "alert" : "status"} style={{ ...cardStyle, marginTop: 16, color: error ? "#9d3025" : "var(--gold-dark)", whiteSpace: "pre-line" }}>
          {error || message}
        </p>
      )}
      {storage === "static" && <p style={{ color: "var(--muted)", fontSize: 14 }}>当前为静态题库回退模式，只能查看；配置 D1 后可保存修改。</p>}
      {configuration && <p style={{ color: "var(--muted)", fontSize: 14 }}>{configuration}</p>}

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>{editingId ? `编辑题目：${editingId}` : "新建题目"}</h2>
        <form onSubmit={save} style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label>题目 ID<input required disabled={Boolean(editingId)} value={form.id} onChange={(event) => updateField("id", event.target.value)} style={inputStyle} /></label>
            <label>标题<input required value={form.title} onChange={(event) => updateField("title", event.target.value)} style={inputStyle} /></label>
            <label>体裁<input required value={form.genre} placeholder="chorale / fugue" onChange={(event) => updateField("genre", event.target.value)} style={inputStyle} /></label>
            <label>声部数<select required value={form.voiceCount} onChange={(event) => updateField("voiceCount", Number(event.target.value) as 3 | 4)} style={inputStyle}><option value={3}>三声部</option><option value={4}>四声部</option></select></label>
            <label>调号<input required value={form.keySignature} placeholder="C major" onChange={(event) => updateField("keySignature", event.target.value)} style={inputStyle} /></label>
            <label>BWV<input required value={form.bwv} onChange={(event) => updateField("bwv", event.target.value)} style={inputStyle} /></label>
            <label>小节范围<input required value={form.measures} onChange={(event) => updateField("measures", event.target.value)} style={inputStyle} /></label>
            <label>时长（秒）<input required type="number" min="0.1" step="0.1" value={form.duration} onChange={(event) => updateField("duration", Number(event.target.value))} style={inputStyle} /></label>
            <label>BPM<input required type="number" min="1" max="400" value={form.bpm} onChange={(event) => updateField("bpm", Number(event.target.value))} style={inputStyle} /></label>
            <label>排序<input type="number" value={form.sortOrder} onChange={(event) => updateField("sortOrder", Number(event.target.value))} style={inputStyle} /></label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 24 }}><input type="checkbox" checked={form.enabled} onChange={(event) => updateField("enabled", event.target.checked)} />公开启用</label>
          </div>
          <label>来源链接<input required type="url" value={form.source} onChange={(event) => updateField("source", event.target.value)} style={inputStyle} /></label>
          <label>来源名称<input required value={form.sourceLabel} onChange={(event) => updateField("sourceLabel", event.target.value)} style={inputStyle} /></label>
          <label>听辨分析<textarea required rows={3} value={form.analysis} onChange={(event) => updateField("analysis", event.target.value)} style={inputStyle} /></label>
          <label>许可说明<textarea required rows={2} value={form.licenseNote} onChange={(event) => updateField("licenseNote", event.target.value)} style={inputStyle} /></label>
          <label>声部谱号 JSON（键必须与声部 JSON 一致）<textarea required rows={4} value={form.clefsText} onChange={(event) => updateField("clefsText", event.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 12 }} /></label>
          <label>声部候选 JSON（每题 3/4 个声部；每个声部 3 或 4 项，且恰有一个 <code>isOriginal: true</code>）<textarea required rows={18} value={form.voicesText} onChange={(event) => updateField("voicesText", event.target.value)} style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 12 }} /></label>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" disabled={saving || storage === "static"} style={{ ...buttonStyle, opacity: saving || storage === "static" ? 0.55 : 1 }}>{saving ? "保存中…" : editingId ? "保存修改" : "创建题目"}</button>
            {editingId && <button type="button" onClick={startNew} style={{ ...buttonStyle, background: "transparent", color: "var(--gold-dark)" }}>取消编辑</button>}
          </div>
        </form>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>题目列表（{loading ? "加载中…" : sortedQuestions.length}）</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead><tr><th style={{ textAlign: "left", padding: 8 }}>排序</th><th style={{ textAlign: "left", padding: 8 }}>题目</th><th style={{ textAlign: "left", padding: 8 }}>候选数</th><th style={{ textAlign: "left", padding: 8 }}>状态</th><th style={{ textAlign: "left", padding: 8 }}>操作</th></tr></thead>
            <tbody>{sortedQuestions.map((question) => <tr key={question.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: 8 }}>{question.sortOrder}</td>
              <td style={{ padding: 8 }}><strong>{question.id}</strong><br /><span style={{ color: "var(--muted)" }}>{question.title}</span></td>
              <td style={{ padding: 8 }}>{Object.entries(question.voices).map(([voice, candidates]) => `${voice} ${candidates.length}`).join(" · ")}</td>
              <td style={{ padding: 8 }}><label><input type="checkbox" checked={question.enabled} onChange={() => void toggleQuestion(question)} /> {question.enabled ? "已启用" : "已停用"}</label></td>
              <td style={{ padding: 8, display: "flex", gap: 8 }}><button type="button" onClick={() => editQuestion(question)} style={{ ...buttonStyle, padding: "6px 10px" }}>编辑</button><button type="button" onClick={() => void removeQuestion(question)} style={{ ...buttonStyle, padding: "6px 10px", background: "transparent", color: "#9d3025", borderColor: "#9d3025" }}>删除</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
