"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import rawQuestions from "./questions.generated.json";
import {
  candidateFor,
  type Candidate,
  type DecoyType,
  type GameState,
  isComplete,
  isOriginalSelection,
  newGame,
  questionsForGame,
  type Question,
  restoreGame,
  scoreGame,
  voicesForQuestion,
  type VoiceKey,
} from "./game";
import { useAudioPlayer } from "./use-audio-player";
import { VerovioScore } from "./verovio-score";

const fallbackQuestions = rawQuestions as Question[];
const STORAGE_KEY = "bach-puzzle-state-v4";
const LEGACY_STORAGE_KEYS = ["bach-puzzle-state-v3", "bach-puzzle-state-v2"];
const VOICE_META: Record<VoiceKey, { name: string; short: string }> = {
  soprano: { name: "女高音", short: "S" },
  alto: { name: "女低音", short: "A" },
  tenor: { name: "男高音", short: "T" },
  bass: { name: "男低音", short: "B" },
};
const DECOY_LABELS: Record<DecoyType, string> = {
  original: "巴赫原作",
  "voice-leading": "声部进行干扰",
  harmony: "和声走向干扰",
  mixed: "和声与声部进行混合干扰",
};
const AUDIO_ERROR_LABELS = {
  network: "网络加载失败",
  decode: "音频解码失败",
  playback: "浏览器播放受限",
  unsupported: "浏览器不支持",
} as const;

function optionLetter(index: number) {
  return index >= 0 ? String.fromCharCode("A".charCodeAt(0) + index) : "";
}

function emptyMuted(): Record<VoiceKey, boolean> {
  return { soprano: false, alto: false, tenor: false, bass: false };
}

function savedState() {
  try {
    for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }
  } catch {
    // 存储空间被禁用或数据损坏时，从新局开始即可。
  }
  return undefined;
}

function safeState(questions: Question[]): GameState {
  if (typeof window === "undefined") return newGame(questions, 20260916);
  return restoreGame(questions, savedState());
}

function publicQuestionsUrl() {
  return new URL("api/questions/", document.baseURI).toString();
}

function revealDetails(candidate: Candidate | undefined) {
  if (!candidate) return { type: "未找到所选项", reason: "该选项已不在当前题目中。" };
  const explanation = candidate.explanation?.trim();
  return {
    type: DECOY_LABELS[candidate.decoyType] || "干扰声部",
    reason: explanation || (candidate.isOriginal ? "这条声部属于本题的巴赫原作。" : "这是一条为听辨设置的替代声部。"),
  };
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function Home() {
  const [questions, setQuestions] = useState<Question[]>(fallbackQuestions);
  const [state, setState] = useState<GameState>(() => newGame(fallbackQuestions, 20260916));
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState<Record<VoiceKey, boolean>>(() => emptyMuted());
  const [scoreMode, setScoreMode] = useState<"chosen" | "original">("chosen");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const player = useAudioPlayer();
  const stopAudio = player.stop;
  const preloadAudio = player.preload;

  useEffect(() => {
    let cancelled = false;
    const loadQuestions = async () => {
      let available = fallbackQuestions;
      try {
        const response = await fetch(publicQuestionsUrl(), { cache: "no-cache" });
        if (response.ok) {
          const payload = await response.json() as { questions?: unknown };
          if (Array.isArray(payload.questions) && payload.questions.length >= 3) {
            available = payload.questions as Question[];
          }
        }
      } catch {
        // GitHub Pages 等静态部署没有题库接口，继续使用构建时题库。
      }
      if (cancelled) return;
      setQuestions(available);
      setState(safeState(available));
      setReady(true);
    };
    void loadQuestions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [ready, state]);

  const playbackKey = `${state.current}:${state.submitted}`;
  useEffect(() => {
    stopAudio();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(emptyMuted());
  }, [playbackKey, stopAudio]);

  const activeQuestions = useMemo(() => questionsForGame(questions, state), [questions, state]);
  const preloadRequest = useMemo(() => {
    const tracks = activeQuestions.flatMap((item) =>
      voicesForQuestion(item).flatMap((voice) => (item.voices[voice] ?? []).map((candidate) => ({ path: candidate.audio, fallback: candidate.audioFallback }))),
    );
    return {
      paths: tracks.map((track) => track.path),
      fallbackPaths: tracks.map((track) => track.fallback),
    };
  }, [activeQuestions]);

  useEffect(() => {
    if (ready) preloadAudio(preloadRequest);
  }, [preloadAudio, preloadRequest, ready]);

  const question = activeQuestions[state.current] ?? activeQuestions[0];
  const selections = question ? state.selections[question.id] || {} : {};
  const questionVoices = question ? voicesForQuestion(question) : [];
  const selectedVoiceKeys = questionVoices.filter((voice) => Boolean(selections[voice]));
  const selectedCount = selectedVoiceKeys.length;
  const complete = isComplete(state, activeQuestions);
  const score = useMemo(() => scoreGame(activeQuestions, state.selections), [activeQuestions, state.selections]);

  if (!question) {
    return <main className="site-shell"><p className="status-message">题库暂时为空，请稍后再试。</p></main>;
  }

  const ordered = (voice: VoiceKey) => {
    const candidates = state.orders[question.id]?.[voice]
      ?.map((id) => candidateFor(question, voice, id))
      .filter((candidate): candidate is Candidate => Boolean(candidate));
    const available = question.voices[voice] ?? [];
    return candidates?.length === available.length ? candidates : available;
  };

  const selectedCandidates = selectedVoiceKeys
    .map((voice) => candidateFor(question, voice, selections[voice]))
    .filter((candidate): candidate is Candidate => Boolean(candidate));
  const originalCandidates = questionVoices
    .map((voice) => (question.voices[voice] ?? []).find((candidate) => candidate.isOriginal))
    .filter((candidate): candidate is Candidate => Boolean(candidate));
  const allOriginal = questionVoices.every((voice) => isOriginalSelection(question, voice, selections[voice]));

  const playPaths = (
    paths: string[],
    label: string,
    withMute = false,
    fallbackPaths?: Array<string | undefined>,
    voiceKeys: VoiceKey[] = [],
  ) => {
    if (paths.length === 0) return;
    const keys = voiceKeys.length === paths.length ? voiceKeys : paths.map((_, index) => selectedVoiceKeys[index] ?? questionVoices[index]);
    player.play({
      paths,
      fallbackPaths,
      label,
      loop,
      voiceKeys: keys,
      muted: withMute ? keys.map((voice) => muted[voice]) : undefined,
    });
  };

  const choose = (voice: VoiceKey, id: string) => {
    player.stop();
    setMessage("");
    setState((current) => ({
      ...current,
      selections: {
        ...current.selections,
        [question.id]: { ...current.selections[question.id], [voice]: id },
      },
    }));
  };

  const go = (index: number) => {
    if (index < 0 || index >= activeQuestions.length) return;
    setState((current) => ({ ...current, current: index }));
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const submit = () => {
    if (!complete) {
      setMessage(`还有声部没有选择。完成全部 ${score.totalVoices} 个选择后才能揭晓。`);
      return;
    }
    player.stop();
    setState((current) => ({ ...current, submitted: true, current: 0 }));
    setMessage("");
    setTimeout(() => headingRef.current?.focus(), 0);
  };

  const reset = () => {
    player.stop({ clearCache: true });
    setState((previous) => newGame(questions, Date.now(), previous.orders));
    setMessage("已重新抽取题目并洗牌，开始新的挑战。");
    setScoreMode("chosen");
  };

  const currentScoreCandidates = scoreMode === "chosen" ? selectedCandidates : originalCandidates;
  const currentScorePaths = currentScoreCandidates.map((candidate) => candidate.score);
  const currentScoreCandidateIds = currentScoreCandidates.map((candidate) => candidate.id);
  const playerVoiceKeys = player.voiceKeys.filter((voice): voice is VoiceKey => Object.hasOwn(VOICE_META, voice));
  const visibleMuteVoices = state.submitted ? [] : playerVoiceKeys.length > 0 ? playerVoiceKeys : selectedVoiceKeys;
  const progressValue = Math.min(1, Math.max(0, player.progress));
  const progressStatus = player.loading
    ? "正在准备音频"
    : player.playing
      ? "正在播放"
      : progressValue >= 1
        ? "播放完成"
        : player.label
          ? "已暂停"
          : "尚未播放";

  return (
    <main className="site-shell">
      <header className="masthead"><div className="brand-mark" aria-hidden="true">♩</div><div><p className="eyebrow">THE BACH PUZZLE</p><h1>拼出巴赫</h1></div><p className="byline">一场声部盲听实验<br />田清新 · 制作</p></header>
      {!state.submitted && <section className="intro"><div><p className="kicker">每局抽取 3 题 · 每题按实际声部数量作答 · 每个选项独立试听</p><h2>你能听出，哪几条旋律<br />曾在三百年前同时响起吗？</h2></div><div className="listening-note"><Headphones size={22} strokeWidth={1.5} /><span>建议佩戴耳机<br /><small>3 道题 · 约 6 分钟</small></span></div></section>}

      {state.submitted ? <>
        <section className="results-hero"><p className="kicker">挑战结果</p><h2 ref={headingRef} tabIndex={-1}>总分 <em>{formatPoints(score.totalScore)}</em> / 100</h2><p>你完整拼对了 <strong>{score.questions}</strong> / {score.totalQuestions} 首作品，找到了 <strong>{score.voices}</strong> / {score.totalVoices} 条巴赫原作声部。</p><div className="score-breakdown" aria-label="评分构成"><div><span>完整猜中曲目（40%）</span><strong>{score.questions} / {score.totalQuestions} · {formatPoints(score.questionPoints)} 分</strong></div><div><span>声部选项猜中比例（60%）</span><strong>{score.voices} / {score.totalVoices} · {formatPoints(score.voicePoints)} 分</strong></div></div><button className="reset-button" onClick={reset}><RotateCcw size={17} />重新挑战</button></section>
        <div className="result-tabs" role="tablist" aria-label="选择结果题目">{activeQuestions.map((item, index) => <button role="tab" aria-selected={state.current === index} className={state.current === index ? "active" : ""} onClick={() => go(index)} key={item.id}>第 {index + 1} 题</button>)}</div>
        <article className="reveal-card">
          <div className="reveal-heading"><div><p>{question.bwv} · {question.measures}</p><h3>{question.title}</h3></div><span className={allOriginal ? "seal correct" : "seal"}>{allOriginal ? "完整拼对" : "查看差异"}</span></div>
          <div className="answer-grid">{questionVoices.map((voice) => { const order = ordered(voice); const chosen = selections[voice]; const chosenCandidate = candidateFor(question, voice, chosen); const correct = (question.voices[voice] ?? []).find((candidate) => candidate.isOriginal); const chosenIndex = order.findIndex((candidate) => candidate.id === chosen); const chosenLetter = optionLetter(chosenIndex); const correctIndex = correct ? order.findIndex((candidate) => candidate.id === correct.id) : -1; const correctLetter = optionLetter(correctIndex) || "—"; const ok = Boolean(correct && chosen === correct.id); const details = revealDetails(chosenCandidate); return <div className={`answer-row ${ok ? "right" : "wrong"}`} key={voice}><span className="answer-voice" aria-hidden="true">{VOICE_META[voice].short}</span><div className="answer-copy"><strong>{VOICE_META[voice].name}</strong><p>你选 {chosenLetter || "—"} · 原作 {correctLetter}</p><dl className="answer-explanation"><div><dt>所选类型</dt><dd>{details.type}</dd></div><div><dt>选择原因</dt><dd>{details.reason}</dd></div>{!ok && <div className="answer-original"><dt>正确项</dt><dd>巴赫原作（选项 {correctLetter}）</dd></div>}</dl></div><span className="answer-status" role="img" aria-label={ok ? "回答正确" : "回答不正确"}>{ok ? <Check aria-hidden="true" size={16} /> : <span aria-hidden="true">×</span>}</span></div>; })}</div>
          <div className="compare-controls"><button onClick={() => playPaths(selectedCandidates.map((candidate) => candidate.audio), "你的组合", true, selectedCandidates.map((candidate) => candidate.audioFallback), selectedVoiceKeys)} disabled={player.loading}><Play size={16} fill="currentColor" />听你的组合</button><button onClick={() => playPaths(originalCandidates.map((candidate) => candidate.audio), "巴赫原作", true, originalCandidates.map((candidate) => candidate.audioFallback), questionVoices)} disabled={player.loading}><Play size={16} fill="currentColor" />听巴赫原作</button></div>
          <div className="score-tabs" role="tablist" aria-label="乐谱对照"><button role="tab" aria-selected={scoreMode === "chosen"} onClick={() => setScoreMode("chosen")} className={scoreMode === "chosen" ? "active" : ""}>你的组合谱</button><button role="tab" aria-selected={scoreMode === "original"} onClick={() => setScoreMode("original")} className={scoreMode === "original" ? "active" : ""}>巴赫原谱</button></div>
          <VerovioScore paths={currentScorePaths} title={scoreMode === "chosen" ? "你的组合" : "巴赫原谱"} questionId={question.id} candidateIds={currentScoreCandidateIds} />
          <div className="analysis"><h4>听辨线索</h4><p>{question.analysis}</p><p className="source-note">{question.licenseNote} <a href={question.source} target="_blank" rel="noreferrer">{question.sourceLabel} ↗</a></p></div>
        </article>
      </> : <section className="quiz-card" aria-label="声部拼图">
        <div className="quiz-topline"><span>QUESTION <strong>{String(state.current + 1).padStart(2, "0")}</strong> / {String(activeQuestions.length).padStart(2, "0")}</span><span>本题已选 {selectedCount} / {questionVoices.length}</span></div><div className="rule" style={{ "--progress": `${((state.current + selectedCount / Math.max(questionVoices.length, 1)) / Math.max(activeQuestions.length, 1)) * 100}%` } as CSSProperties} />
        <div className="question-copy"><p>第 {state.current + 1} 题</p><h3 ref={headingRef} tabIndex={-1}>从每个声部中，选出你认为属于巴赫的旋律</h3><span>点击 ▶ 单独试听；点击字母区域做出选择。选择至少两个声部后即可听合奏。</span></div>
        <div className="voice-stack">{questionVoices.map((voice, voiceIndex) => <fieldset className="voice-row" key={voice}><legend><span>{String(voiceIndex + 1).padStart(2, "0")}</span>{VOICE_META[voice].name}</legend><div className="option-grid">{ordered(voice).map((candidate, index) => { const selected = selections[voice] === candidate.id; const letter = optionLetter(index); return <div className={`option-card ${selected ? "selected" : ""}`} key={candidate.id}><button className="listen-button" onClick={() => playPaths([candidate.audio], `${VOICE_META[voice].name}选项 ${letter}`, false, [candidate.audioFallback], [voice])} aria-label={`试听${VOICE_META[voice].name}选项 ${letter}`}><Play size={16} fill="currentColor" /></button><button className="choose-button" role="radio" aria-checked={selected} onClick={() => choose(voice, candidate.id)}><span>{letter}</span><small>{selected ? <><Check size={13} />已选择</> : "选择此旋律"}</small></button></div>; })}</div></fieldset>)}</div>
        <div className="question-nav"><button disabled={state.current === 0} onClick={() => go(state.current - 1)}><ChevronLeft size={17} />上一题</button><div aria-label="题目进度">{activeQuestions.map((item, index) => <button aria-label={`第 ${index + 1} 题${voicesForQuestion(item).every((voice) => state.selections[item.id]?.[voice]) ? "，已完成" : ""}`} className={index === state.current ? "active" : ""} onClick={() => go(index)} key={item.id}>{index + 1}</button>)}</div>{state.current < activeQuestions.length - 1 ? <button onClick={() => go(state.current + 1)}>下一题<ChevronRight size={17} /></button> : <button className="submit-button" onClick={submit} disabled={!complete}>提交并揭晓</button>}</div>
        <p className="status-message" aria-live="polite">{message || (!complete ? `完成全部 ${activeQuestions.length} 题后即可揭晓，提交前可随时修改。` : "全部声部已选齐，可以提交。")}</p>
      </section>}

      <footer>© 2026 田清新 · 乐谱由 Verovio 渲染 · 音乐素材与方法说明见揭晓页</footer>
      {((!state.submitted && selectedCount >= 2) || player.label) && <div className="ensemble-bar"><div className="ensemble-title">{player.loading ? <LoaderCircle className="spin" size={20} /> : <Volume2 size={20} />}<span>{player.label || "当前合奏"}<small role={player.error ? "alert" : "status"} aria-live="polite">{player.error ? `${AUDIO_ERROR_LABELS[player.error.kind]}：${player.error.message}` : loop ? "循环开启" : "单次播放"}</small><span className="audio-progress" role="progressbar" aria-label="音频播放进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressValue * 100)} aria-valuetext={progressStatus}><span style={{ width: `${progressValue * 100}%` }} /><span className="sr-only">{progressStatus}</span></span></span></div><div className="bar-actions"><button className={loop ? "active" : ""} onClick={() => setLoop((value) => !value)} aria-pressed={loop}><RefreshCw size={16} /><span>循环</span></button>{visibleMuteVoices.map((voice) => { const isMuted = muted[voice]; return <button key={voice} className={isMuted ? "muted" : ""} aria-label={`${isMuted ? "取消静音" : "静音"}${VOICE_META[voice].name}`} onClick={() => { const next = { ...muted, [voice]: !isMuted }; setMuted(next); player.updateMuted(visibleMuteVoices.map((item) => next[item])); }}>{isMuted ? <VolumeX size={15} /> : VOICE_META[voice].short}</button>; })}{player.loading ? <button className="primary" disabled><LoaderCircle className="spin" size={17} />准备中</button> : player.playing ? <button className="primary" onClick={player.pause}><Pause size={17} fill="currentColor" />暂停</button> : player.error ? <button className="primary" onClick={player.retry} disabled={player.loading}><RefreshCw size={17} />重试音频</button> : player.label ? <button className="primary" onClick={player.resume}><Play size={17} fill="currentColor" />继续</button> : !state.submitted && selectedCount >= 2 ? <button className="primary" onClick={() => playPaths(selectedCandidates.map((candidate) => candidate.audio), "当前合奏", true, selectedCandidates.map((candidate) => candidate.audioFallback), selectedVoiceKeys)}><Play size={17} fill="currentColor" />播放合奏</button> : null}</div></div>}
    </main>
  );
}
