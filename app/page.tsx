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
import {
  ApiError,
  createGameSession,
  type GameRules,
  type GameScore,
  type GameSession,
  type PublicCandidate,
  type PublicQuestion,
  type RevealCandidate,
  type SubmitResult,
  submitGameSession,
} from "./lib/api-client";
import { useAudioPlayer } from "./use-audio-player";
import { VerovioScore } from "./verovio-score";

type Selections = Record<string, Record<string, string>>;
type RevealState = SubmitResult;
const EMPTY_QUESTIONS: PublicQuestion[] = [];

const AUDIO_ERROR_LABELS = {
  network: "网络加载失败",
  decode: "音频解码失败",
  playback: "浏览器播放受限",
  unsupported: "浏览器不支持",
} as const;

function optionLetter(index: number) {
  return index >= 0 ? String.fromCharCode("A".charCodeAt(0) + index) : "";
}

function voicesForQuestion(question: PublicQuestion) {
  const listed = question.voiceOrder?.filter((voice) => (question.voices[voice]?.length ?? 0) > 0);
  if (listed && listed.length > 0) return [...new Set(listed)];
  return Object.keys(question.voices);
}

function voiceLabel(question: PublicQuestion, voice: string, index = 0) {
  return question.voiceLabels?.[voice] || (voice === "soprano" ? "女高音" : voice === "alto" ? "女低音" : voice === "tenor" ? "男高音" : voice === "bass" ? "男低音" : `第 ${index + 1} 声部`);
}

function voiceShort(question: PublicQuestion, voice: string, index: number) {
  const label = voiceLabel(question, voice, index);
  if (voice === "soprano") return "S";
  if (voice === "alto") return "A";
  if (voice === "tenor") return "T";
  if (voice === "bass") return "B";
  return label.replace(/\s+/g, "").slice(0, 1) || String(index + 1);
}

function candidateFor(question: PublicQuestion, voice: string, id?: string) {
  return question.voices[voice]?.find((candidate) => candidate.id === id);
}

function formatPoints(value: number | undefined) {
  const safe = Number(value ?? 0);
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1);
}

function emptyMuted(question?: PublicQuestion): Record<string, boolean> {
  return Object.fromEntries(question ? voicesForQuestion(question).map((voice) => [voice, false]) : []);
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "题目服务暂时不可用，请稍后重试。";
}

function rulesText(rules: GameRules | undefined) {
  if (!rules) return "当前规则加载中";
  return `每局 ${rules.questionsPerGame} 题 · 完整猜中 ${rules.scoreWeights.completeQuestion}% · 声部比例 ${rules.scoreWeights.voiceAccuracy}%`;
}

function revealedCandidate(
  question: PublicQuestion,
  reveal: RevealState | null,
  voice: string,
  mode: "selected" | "original",
  selections: Selections,
) {
  const result = reveal?.results?.find((item) => item.questionId === question.id);
  const resultCandidate = result?.[mode === "selected" ? "selected" : "originals"]?.[voice];
  if (resultCandidate) return resultCandidate;
  const serverResult = reveal?.score.questionResults?.find((item) => item.id === question.id)?.voices?.[voice];
  const candidateId = mode === "selected" ? serverResult?.selectedId : serverResult?.correctId;
  const candidate = candidateFor(question, voice, candidateId || (mode === "selected" ? selections[question.id]?.[voice] : undefined));
  if (!candidate) return undefined;
  return {
    ...candidate,
    isOriginal: mode === "original" || Boolean(serverResult?.correct && mode === "selected"),
    decoyType: serverResult?.decoyType || (mode === "original" ? "original" : undefined),
    explanation: serverResult?.explanation || undefined,
  } as RevealCandidate;
}

function revealInfo(candidate: RevealCandidate | PublicCandidate | undefined) {
  if (!candidate) return { type: "未找到所选项", reason: "该选项已不在当前题目中。" };
  if (!("isOriginal" in candidate)) return { type: "所选声部", reason: "已提交的声部候选。" };
  const labels: Record<string, string> = {
    original: "巴赫原作",
    "voice-leading": "声部进行干扰",
    harmony: "和声走向干扰",
    mixed: "和声与声部进行混合干扰",
  };
  return {
    type: labels[candidate.decoyType || (candidate.isOriginal ? "original" : "mixed")] || "干扰声部",
    reason: candidate.explanation?.trim() || (candidate.isOriginal ? "这条声部属于巴赫原作。" : "这是一条为听辨设置的替代声部。"),
  };
}

function publicQuestionFromReveal(question: PublicQuestion, reveal: RevealState | null): PublicQuestion {
  return reveal?.questions?.find((item) => item.id === question.id) || question;
}

export default function Home() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [current, setCurrent] = useState(0);
  const [selections, setSelections] = useState<Selections>({});
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [scoreMode, setScoreMode] = useState<"chosen" | "original">("chosen");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const player = useAudioPlayer();
  const stopAudio = player.stop;
  const preloadAudio = player.preload;

  const startSession = async () => {
    setLoading(true);
    setMessage("");
    setReveal(null);
    setSelections({});
    setCurrent(0);
    stopAudio({ clearCache: true });
    try {
      const next = await createGameSession();
      if (!next.questions?.length) throw new Error("服务端没有返回可用题目。");
      setSession(next);
      setMuted(emptyMuted(next.questions[0]));
    } catch (error) {
      setSession(null);
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void startSession();
    // 只在页面首次加载时创建一局。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const questions = session?.questions ?? EMPTY_QUESTIONS;
  const question = questions[current] ?? questions[0];
  const questionVoices = question ? voicesForQuestion(question) : [];
  const currentSelections = question ? selections[question.id] || {} : {};
  const selectedVoiceKeys = questionVoices.filter((voice) => Boolean(currentSelections[voice]));
  const complete = questions.length > 0 && questions.every((item) => voicesForQuestion(item).every((voice) => Boolean(selections[item.id]?.[voice])));
  const activeResult = question ? reveal?.score.questionResults?.find((item) => item.id === question.id) : undefined;
  const resultQuestion = question ? publicQuestionFromReveal(question, reveal) : undefined;
  const resultVoices = resultQuestion ? voicesForQuestion(resultQuestion) : [];

  const preloadRequest = useMemo(() => {
    const tracks = questions.flatMap((item) => voicesForQuestion(item).flatMap((voice) => (item.voices[voice] || []).map((candidate) => ({ path: candidate.audio, fallback: candidate.audioFallback }))));
    return { paths: tracks.map((track) => track.path), fallbackPaths: tracks.map((track) => track.fallback) };
  }, [questions]);

  useEffect(() => {
    if (!loading && questions.length > 0) preloadAudio(preloadRequest);
  }, [loading, preloadAudio, preloadRequest, questions.length]);

  useEffect(() => {
    stopAudio();
    if (question) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMuted(emptyMuted(question));
    }
  }, [current, question, reveal, stopAudio]);

  if (loading && !question) return <main className="site-shell"><p className="status-message">正在从题库抽取本局题目……</p></main>;

  if (!question) {
    return <main className="site-shell"><header className="masthead"><div className="brand-mark" aria-hidden="true">♩</div><div><p className="eyebrow">THE BACH PUZZLE</p><h1>拼出巴赫</h1></div></header><section className="status-message" role="alert"><p>{message || "题目服务暂时不可用。"}</p><button className="reset-button" onClick={() => void startSession()}><RefreshCw size={17} />重新连接</button></section></main>;
  }

  const playPaths = (paths: string[], label: string, withMute = false, fallbackPaths?: Array<string | undefined>, voiceKeys: string[] = []) => {
    if (paths.length === 0) return;
    const keys = voiceKeys.length === paths.length ? voiceKeys : paths.map((_, index) => selectedVoiceKeys[index] || questionVoices[index]);
    player.play({ paths, fallbackPaths, label, loop, voiceKeys: keys, muted: withMute ? keys.map((voice) => Boolean(muted[voice])) : undefined });
  };

  const choose = (voice: string, id: string) => {
    player.stop();
    setMessage("");
    setSelections((previous) => ({ ...previous, [question.id]: { ...(previous[question.id] || {}), [voice]: id } }));
  };

  const go = (index: number) => {
    if (index < 0 || index >= questions.length) return;
    setCurrent(index);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const submit = async () => {
    if (!complete || !session) {
      setMessage(`还有声部没有选择。完成全部 ${questions.reduce((total, item) => total + voicesForQuestion(item).length, 0)} 个选择后才能揭晓。`);
      return;
    }
    setSubmitting(true);
    setMessage("");
    stopAudio();
    try {
      const result = await submitGameSession(session.sessionId, selections);
      setReveal(result);
      setCurrent(0);
      setScoreMode("chosen");
      setTimeout(() => headingRef.current?.focus(), 0);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const score: GameScore | undefined = reveal?.score;
  const reset = () => void startSession();
  const scoreCandidates = resultQuestion ? resultVoices.map((voice) => revealedCandidate(resultQuestion, reveal, voice, scoreMode === "chosen" ? "selected" : "original", selections)).filter((candidate): candidate is RevealCandidate => Boolean(candidate)) : [];
  const scorePaths = scoreCandidates.map((candidate) => candidate.score);
  const scoreCandidateIds = scoreCandidates.map((candidate) => candidate.id);
  const playerVoiceKeys = player.voiceKeys.filter((voice) => questionVoices.includes(voice));
  const visibleMuteVoices = reveal ? [] : playerVoiceKeys.length > 0 ? playerVoiceKeys : selectedVoiceKeys;
  const progressValue = Math.min(1, Math.max(0, player.progress));
  const progressStatus = player.loading ? "正在准备音频" : player.playing ? "正在播放" : progressValue >= 1 ? "播放完成" : player.label ? "已暂停" : "尚未播放";
  const scoreLabels = reveal?.rules || session?.rules;

  return (
    <main className="site-shell">
      <header className="masthead"><div className="brand-mark" aria-hidden="true">♩</div><div><p className="eyebrow">THE BACH PUZZLE</p><h1>拼出巴赫</h1></div><p className="byline">三/四声部盲听实验<br /><small>{rulesText(session?.rules)}</small></p></header>
      {!reveal && <section className="intro"><div><p className="kicker">每局按规则抽取 · 每题按实际声部数量作答 · 每个选项独立试听</p><h2>你能听出，哪几条旋律<br />曾在三百年前同时响起吗？</h2></div><div className="listening-note"><Headphones size={22} strokeWidth={1.5} /><span>建议佩戴耳机<br /><small>{questions.length} 道题 · 只加载本局资源</small></span></div></section>}

      {reveal && score ? <>
        <section className="results-hero"><p className="kicker">挑战结果</p><h2 ref={headingRef} tabIndex={-1}>总分 <em>{formatPoints(score.totalScore)}</em> / 100</h2><p>你完整拼对了 <strong>{score.questions}</strong> / {score.totalQuestions} 首作品，找到了 <strong>{score.voices}</strong> / {score.totalVoices} 条巴赫原作声部。</p><div className="score-breakdown" aria-label="评分构成"><div><span>完整猜中曲目（{scoreLabels?.scoreWeights.completeQuestion ?? 40}%）</span><strong>{score.questions} / {score.totalQuestions} · {formatPoints(score.questionPoints)} 分</strong></div><div><span>声部选项猜中比例（{scoreLabels?.scoreWeights.voiceAccuracy ?? 60}%）</span><strong>{score.voices} / {score.totalVoices} · {formatPoints(score.voicePoints)} 分</strong></div></div><button className="reset-button" onClick={reset}><RotateCcw size={17} />重新挑战</button></section>
        <div className="result-tabs" role="tablist" aria-label="选择结果题目">{questions.map((item, index) => <button role="tab" aria-selected={current === index} className={current === index ? "active" : ""} onClick={() => go(index)} key={item.id}>第 {index + 1} 题</button>)}</div>
        <article className="reveal-card">
          <div className="reveal-heading"><div><p>{resultQuestion?.bwv} · {resultQuestion?.measures} · {resultQuestion?.genre}</p><h3>{resultQuestion?.title}</h3></div><span className={activeResult?.correct ? "seal correct" : "seal"}>{activeResult?.correct ? "完整拼对" : "查看差异"}</span></div>
          <div className="answer-grid">{resultVoices.map((voice, voiceIndex) => { const selected = revealedCandidate(resultQuestion!, reveal, voice, "selected", selections); const original = revealedCandidate(resultQuestion!, reveal, voice, "original", selections); const ok = Boolean(selected && "isOriginal" in selected && selected.isOriginal); const details = revealInfo(selected); return <div className={`answer-row ${ok ? "right" : "wrong"}`} key={voice}><span className="answer-voice" aria-hidden="true">{voiceShort(resultQuestion!, voice, voiceIndex)}</span><div className="answer-copy"><strong>{voiceLabel(resultQuestion!, voice, voiceIndex)}</strong><p>{ok ? "你选中了巴赫原作" : "需要对照原作声部"}</p><dl className="answer-explanation"><div><dt>所选类型</dt><dd>{details.type}</dd></div><div><dt>选择原因</dt><dd>{details.reason}</dd></div>{!ok && original && <div className="answer-original"><dt>正确项</dt><dd>巴赫原作已在提交结果中标出</dd></div>}</dl></div><span className="answer-status" role="img" aria-label={ok ? "回答正确" : "回答不正确"}>{ok ? <Check aria-hidden="true" size={16} /> : <span aria-hidden="true">×</span>}</span></div>; })}</div>
          <div className="compare-controls"><button onClick={() => { const selected = resultVoices.map((voice) => revealedCandidate(resultQuestion!, reveal, voice, "selected", selections)).filter((candidate): candidate is RevealCandidate => Boolean(candidate)); playPaths(selected.map((candidate) => candidate.audio), "你的组合", true, selected.map((candidate) => candidate.audioFallback), resultVoices); }} disabled={player.loading}><Play size={16} fill="currentColor" />听你的组合</button><button onClick={() => { const originals = resultVoices.map((voice) => revealedCandidate(resultQuestion!, reveal, voice, "original", selections)).filter((candidate): candidate is RevealCandidate => Boolean(candidate)); playPaths(originals.map((candidate) => candidate.audio), "巴赫原作", true, originals.map((candidate) => candidate.audioFallback), resultVoices); }} disabled={player.loading}><Play size={16} fill="currentColor" />听巴赫原作</button></div>
          <div className="score-tabs" role="tablist" aria-label="乐谱对照"><button role="tab" aria-selected={scoreMode === "chosen"} onClick={() => setScoreMode("chosen")} className={scoreMode === "chosen" ? "active" : ""}>你的组合谱</button><button role="tab" aria-selected={scoreMode === "original"} onClick={() => setScoreMode("original")} className={scoreMode === "original" ? "active" : ""}>巴赫原谱</button></div>
          {scorePaths.length > 0 && <VerovioScore paths={scorePaths} title={scoreMode === "chosen" ? "你的组合" : "巴赫原谱"} questionId={resultQuestion?.id} candidateIds={scoreCandidateIds} voiceLabels={resultVoices.map((voice, index) => voiceLabel(resultQuestion!, voice, index))} clefs={resultVoices.map((voice) => resultQuestion?.clefs?.[voice] || "")} />}
          <div className="analysis"><h4>听辨线索</h4><p>{resultQuestion?.analysis || "提交后可对照每个声部的原作与候选。"}</p><p className="source-note">{resultQuestion?.licenseNote} {resultQuestion?.source && <a href={resultQuestion.source} target="_blank" rel="noreferrer">{resultQuestion.sourceLabel} ↗</a>}</p></div>
        </article>
      </> : <section className="quiz-card" aria-label="声部拼图">
        <div className="quiz-topline"><span>QUESTION <strong>{String(current + 1).padStart(2, "0")}</strong> / {String(questions.length).padStart(2, "0")}</span><span>本题已选 {selectedVoiceKeys.length} / {questionVoices.length}</span></div><div className="rule" style={{ "--progress": `${((current + selectedVoiceKeys.length / Math.max(questionVoices.length, 1)) / Math.max(questions.length, 1)) * 100}%` } as CSSProperties} />
        <div className="question-copy"><p>第 {current + 1} 题 · {question.genre || "音乐片段"}</p><h3 ref={headingRef} tabIndex={-1}>从每个声部中，选出你认为属于巴赫的旋律</h3><span>{question.bwv} · {question.measures} · {question.keySignature || "调号见谱面"}<br />选择至少两个声部后即可听合奏。</span></div>
        <div className="voice-stack">{questionVoices.map((voice, voiceIndex) => <fieldset className="voice-row" key={voice}><legend><span>{String(voiceIndex + 1).padStart(2, "0")}</span>{voiceLabel(question, voice, voiceIndex)}<small>{question.clefs?.[voice] || ""}</small></legend><div className="option-grid">{(question.voices[voice] || []).map((candidate, index) => { const selected = currentSelections[voice] === candidate.id; const letter = optionLetter(index); return <div className={`option-card ${selected ? "selected" : ""}`} key={candidate.id}><button className="listen-button" onClick={() => playPaths([candidate.audio], `${voiceLabel(question, voice, voiceIndex)}选项 ${letter}`, false, [candidate.audioFallback], [voice])} aria-label={`试听${voiceLabel(question, voice, voiceIndex)}选项 ${letter}`}><Play size={16} fill="currentColor" /></button><button className="choose-button" role="radio" aria-checked={selected} onClick={() => choose(voice, candidate.id)}><span>{letter}</span><small>{selected ? <><Check size={13} />已选择</> : "选择此旋律"}</small></button></div>; })}</div></fieldset>)}</div>
        <div className="question-nav"><button disabled={current === 0} onClick={() => go(current - 1)}><ChevronLeft size={17} />上一题</button><div aria-label="题目进度">{questions.map((item, index) => <button aria-label={`第 ${index + 1} 题${voicesForQuestion(item).every((voice) => Boolean(selections[item.id]?.[voice])) ? "，已完成" : ""}`} className={index === current ? "active" : ""} onClick={() => go(index)} key={item.id}>{index + 1}</button>)}</div>{current < questions.length - 1 ? <button onClick={() => go(current + 1)}>下一题<ChevronRight size={17} /></button> : <button className="submit-button" onClick={() => void submit()} disabled={!complete || submitting}>{submitting ? "提交中…" : "提交并揭晓"}</button>}</div>
        <p className="status-message" aria-live="polite">{message || (!complete ? `完成全部 ${questions.length} 题后即可揭晓，提交前可随时修改。` : "全部声部已选齐，可以提交。")}</p>
      </section>}

      <footer>© 2026 · 音乐素材与方法说明见揭晓页</footer>
      {((!reveal && selectedVoiceKeys.length >= 2) || player.label) && <div className="ensemble-bar"><div className="ensemble-title">{player.loading ? <LoaderCircle className="spin" size={20} /> : <Volume2 size={20} />}<span>{player.label || "当前合奏"}<small role={player.error ? "alert" : "status"} aria-live="polite">{player.error ? `${AUDIO_ERROR_LABELS[player.error.kind]}：${player.error.message}` : loop ? "循环开启" : "单次播放"}</small><span className="audio-progress" role="progressbar" aria-label="音频播放进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressValue * 100)} aria-valuetext={progressStatus}><span style={{ width: `${progressValue * 100}%` }} /><span className="sr-only">{progressStatus}</span></span></span></div><div className="bar-actions"><button className={loop ? "active" : ""} onClick={() => setLoop((value) => !value)} aria-pressed={loop}><RefreshCw size={16} /><span>循环</span></button>{visibleMuteVoices.map((voice) => { const isMuted = Boolean(muted[voice]); return <button key={voice} className={isMuted ? "muted" : ""} aria-label={`${isMuted ? "取消静音" : "静音"}${voiceLabel(question, voice, questionVoices.indexOf(voice))}`} onClick={() => { const next = { ...muted, [voice]: !isMuted }; setMuted(next); player.updateMuted(visibleMuteVoices.map((item) => Boolean(next[item]))); }}>{isMuted ? <VolumeX size={15} /> : voiceShort(question, voice, questionVoices.indexOf(voice))}</button>; })}{player.loading ? <button className="primary" disabled><LoaderCircle className="spin" size={17} />准备中</button> : player.playing ? <button className="primary" onClick={player.pause}><Pause size={17} fill="currentColor" />暂停</button> : player.error ? <button className="primary" onClick={player.retry} disabled={player.loading}><RefreshCw size={17} />重试音频</button> : player.label ? <button className="primary" onClick={player.resume}><Play size={17} fill="currentColor" />继续</button> : !reveal && selectedVoiceKeys.length >= 2 ? <button className="primary" onClick={() => playPaths(selectedVoiceKeys.map((voice) => candidateFor(question, voice, currentSelections[voice])?.audio).filter((path): path is string => Boolean(path)), "当前合奏", true, selectedVoiceKeys.map((voice) => candidateFor(question, voice, currentSelections[voice])?.audioFallback), selectedVoiceKeys)}><Play size={17} fill="currentColor" />播放合奏</button> : null}</div></div>}
    </main>
  );
}
