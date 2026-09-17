/**
 * Worker 与管理端共用的纯函数。
 * 这里不依赖 D1、R2 或浏览器 API，便于使用 node:test 做快速回归测试。
 */

export const CATEGORIES = ["chorale", "fugue", "other"];

export const DEFAULT_GAME_RULES = Object.freeze({
  questionsPerGame: 3,
  allocation: Object.freeze({ chorale: 1, fugue: 1, other: 1 }),
  scoreWeights: Object.freeze({ completeQuestion: 40, voiceAccuracy: 60 }),
  revision: 1,
});

function integer(value) {
  return Number.isInteger(value) ? value : Number.isInteger(Number(value)) ? Number(value) : null;
}

export function cloneRules(rules = DEFAULT_GAME_RULES) {
  return {
    questionsPerGame: Number(rules.questionsPerGame),
    allocation: {
      chorale: Number(rules.allocation?.chorale ?? 0),
      fugue: Number(rules.allocation?.fugue ?? 0),
      other: Number(rules.allocation?.other ?? 0),
    },
    scoreWeights: {
      completeQuestion: Number(rules.scoreWeights?.completeQuestion ?? 0),
      voiceAccuracy: Number(rules.scoreWeights?.voiceAccuracy ?? 0),
    },
    revision: Number(rules.revision ?? 1),
  };
}

export function validateRules(input, inventory = {}) {
  const rules = cloneRules(input);
  const errors = [];
  const questionCount = integer(rules.questionsPerGame);
  if (questionCount === null || questionCount < 1) {
    errors.push("每局题目数量必须是正整数");
  }

  let allocationTotal = 0;
  for (const category of CATEGORIES) {
    const value = integer(rules.allocation[category]);
    if (value === null || value < 0) {
      errors.push(`${category} 配额必须是非负整数`);
    } else {
      allocationTotal += value;
      const available = Number(inventory[category] ?? Number.POSITIVE_INFINITY);
      if (value > available) errors.push(`${category} 题目不足：需要 ${value} 道，当前只有 ${available} 道`);
    }
  }
  if (questionCount !== null && allocationTotal !== questionCount) {
    errors.push("三类题目的配额总和必须等于每局题目数量");
  }

  const completeWeight = integer(rules.scoreWeights.completeQuestion);
  const voiceWeight = integer(rules.scoreWeights.voiceAccuracy);
  if (completeWeight === null || completeWeight < 0 || completeWeight > 100) {
    errors.push("完整猜中题目的权重必须是 0—100 的整数");
  }
  if (voiceWeight === null || voiceWeight < 0 || voiceWeight > 100) {
    errors.push("声部选项正确比例的权重必须是 0—100 的整数");
  }
  if (completeWeight !== null && voiceWeight !== null && completeWeight + voiceWeight !== 100) {
    errors.push("两个评分权重的总和必须等于 100");
  }
  return errors.length ? { ok: false, errors, rules } : { ok: true, rules };
}

export function shuffle(items, random = Math.random) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function seededRandom(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function questionVoices(question) {
  return Array.isArray(question.voiceOrder) && question.voiceOrder.length
    ? question.voiceOrder
    : Object.keys(question.voices ?? {});
}

function cloneQuestionForDraw(question, random) {
  const voices = {};
  for (const voice of questionVoices(question)) {
    const candidates = Array.isArray(question.voices?.[voice]) ? question.voices[voice] : [];
    voices[voice] = shuffle(
      candidates.map((candidate) => ({
        ...candidate,
        optionId: candidate.optionId ?? candidate.id,
      })),
      random,
    );
  }
  return { ...question, voiceOrder: questionVoices(question), voices };
}

/**
 * 按分类配额选题；每个分类独立随机抽取，最后再打乱展示顺序。
 */
export function drawQuestions(questions, rules, random = Math.random) {
  const groups = Object.fromEntries(CATEGORIES.map((category) => [category, []]));
  for (const question of questions) {
    const category = question.genre ?? question.category;
    if (groups[category]) groups[category].push(question);
  }
  const selected = [];
  for (const category of CATEGORIES) {
    const count = Number(rules.allocation?.[category] ?? 0);
    const choices = shuffle(groups[category], random).slice(0, count);
    selected.push(...choices.map((question) => cloneQuestionForDraw(question, random)));
  }
  return shuffle(selected, random);
}

export function publicCandidate(candidate) {
  return {
    id: candidate.optionId ?? candidate.id,
    audio: candidate.audio,
    audioFallback: candidate.audioFallback,
    score: candidate.score,
  };
}

export function publicQuestion(question) {
  const voices = {};
  for (const voice of questionVoices(question)) {
    voices[voice] = (question.voices?.[voice] ?? []).map(publicCandidate);
  }
  return {
    id: question.id,
    title: question.title,
    genre: question.genre ?? question.category,
    voiceCount: question.voiceCount ?? questionVoices(question).length,
    voiceOrder: questionVoices(question),
    voiceLabels: question.voiceLabels ?? {},
    clefs: question.clefs ?? {},
    keySignature: question.keySignature ?? "",
    timeSignature: question.timeSignature ?? "",
    bwv: question.bwv ?? "",
    measures: question.measures ?? "",
    measureStart: question.measureStart ?? null,
    measureEnd: question.measureEnd ?? null,
    duration: question.duration ?? null,
    bpm: question.bpm ?? null,
    source: question.source ?? "",
    sourceLabel: question.sourceLabel ?? "",
    analysis: question.analysis ?? "",
    licenseNote: question.licenseNote ?? "",
    sourceEdition: question.sourceEdition ?? "",
    sourceLicense: question.sourceLicense ?? "",
    maxRestByVoice: question.maxRestByVoice ?? {},
    revision: question.revision ?? 1,
    voices,
  };
}

export function adminQuestion(question) {
  return JSON.parse(JSON.stringify(question));
}

export function scoreSelections(questions, selections, rules) {
  let correctQuestions = 0;
  let correctVoices = 0;
  let totalVoices = 0;
  const questionResults = [];

  for (const question of questions) {
    const selected = selections?.[question.id] ?? {};
    const voices = questionVoices(question);
    let questionCorrect = true;
    const voiceResults = {};
    for (const voice of voices) {
      const candidates = question.voices?.[voice] ?? [];
      const correct = candidates.find((candidate) => candidate.isOriginal === true);
      const selectedId = selected?.[voice];
      const selectedCandidate = candidates.find(
        (candidate) => (candidate.optionId ?? candidate.id) === selectedId || candidate.id === selectedId,
      );
      const isCorrect = Boolean(correct && selectedCandidate && (selectedCandidate.optionId ?? selectedCandidate.id) === (correct.optionId ?? correct.id));
      totalVoices += 1;
      if (isCorrect) correctVoices += 1;
      questionCorrect = questionCorrect && isCorrect;
      voiceResults[voice] = {
        selectedId: selectedCandidate ? selectedCandidate.optionId ?? selectedCandidate.id : null,
        correctId: correct ? correct.optionId ?? correct.id : null,
        correct: isCorrect,
        decoyType: selectedCandidate?.decoyType ?? null,
        explanation: selectedCandidate?.explanation ?? null,
      };
    }
    if (questionCorrect) correctQuestions += 1;
    questionResults.push({ id: question.id, genre: question.genre ?? question.category, correct: questionCorrect, voices: voiceResults });
  }

  const questionTotal = questions.length;
  const completeWeight = Number(rules.scoreWeights?.completeQuestion ?? 0);
  const voiceWeight = Number(rules.scoreWeights?.voiceAccuracy ?? 0);
  const completePoints = questionTotal ? (correctQuestions / questionTotal) * completeWeight : 0;
  const voicePoints = totalVoices ? (correctVoices / totalVoices) * voiceWeight : 0;
  return {
    totalScore: completePoints + voicePoints,
    questionPoints: completePoints,
    voicePoints,
    questions: correctQuestions,
    totalQuestions: questionTotal,
    voices: correctVoices,
    totalVoices,
    questionResults,
  };
}
