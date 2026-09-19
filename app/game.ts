export const VOICES = ["soprano", "alto", "tenor", "bass"] as const;
/**
 * 圣咏使用 soprano/alto/tenor/bass；键盘赋格与三声部创意曲可以使用
 * voice1/voice2/voice3/voice4。题库接口负责提供实际顺序与显示名称。
 */
export type VoiceKey = string;

export type DecoyType = "original" | "voice-leading" | "harmony" | "mixed";

export type Candidate = {
  id: string;
  audio: string;
  audioFallback: string;
  score: string;
  isOriginal: boolean;
  variant: number;
  decoyType: DecoyType;
  explanation: string;
};

export type Question = {
  id: string;
  title: string;
  genre?: string;
  voiceCount?: 3 | 4;
  voiceOrder?: VoiceKey[];
  voiceLabels?: Record<string, string>;
  clefs?: Record<string, string>;
  keySignature?: string;
  bwv: string;
  measures: string;
  duration: number;
  bpm: number;
  source: string;
  sourceLabel: string;
  analysis: string;
  licenseNote: string;
  /** 题目可为三声部或四声部；未列出的声部不会参与作答、评分或预加载。 */
  activeVoices?: VoiceKey[];
  voices: Partial<Record<VoiceKey, Candidate[]>>;
};

export type Selections = Record<string, Partial<Record<VoiceKey, string>>>;
export type Orders = Record<string, Record<VoiceKey, string[]>>;

export const QUESTIONS_PER_GAME = 3 as const;
export const GAME_STATE_VERSION = 4 as const;
export type GameState = {
  version: typeof GAME_STATE_VERSION;
  seed: number;
  /** 本局抽中的题目 ID，顺序就是答题与结果页的顺序。 */
  questionIds: string[];
  current: number;
  submitted: boolean;
  selections: Selections;
  orders: Orders;
};

type UnknownRecord = Record<string, unknown>;

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedSeed(seed: number) {
  return Number.isFinite(seed) ? Math.trunc(seed) : Date.now();
}

function uniqueQuestionIds(questions: Question[]) {
  const seen = new Set<string>();
  return questions.flatMap((question) => {
    if (seen.has(question.id)) return [];
    seen.add(question.id);
    return [question.id];
  });
}

/**
 * 使用确定性随机数从题库抽取本局题目。题目池可以大于三题，传入同一个种子会得到同一组题。
 */
export function drawQuestionIds(
  questions: Question[],
  seed: number,
  count = QUESTIONS_PER_GAME,
) {
  const random = mulberry32(normalizedSeed(seed));
  const ids = uniqueQuestionIds(questions);
  const amount = Math.max(0, Math.min(Math.trunc(count), ids.length));

  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }

  return ids.slice(0, amount);
}

export function questionsForGame(questions: Question[], state: Pick<GameState, "questionIds">) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  return state.questionIds
    .map((id) => byId.get(id))
    .filter((question): question is Question => Boolean(question));
}

export function voicesForQuestion(question: Question): VoiceKey[] {
  const orderedVoices = question.voiceOrder?.filter((voice) => (question.voices[voice]?.length ?? 0) > 0);
  if (orderedVoices && orderedVoices.length > 0) return [...new Set(orderedVoices)];
  const listedVoices = question.activeVoices?.filter((voice) => (question.voices[voice]?.length ?? 0) > 0);
  if (listedVoices && listedVoices.length > 0) return [...new Set(listedVoices)];
  const keys = Object.keys(question.voices);
  return keys.length > 0 ? keys : VOICES.filter((voice) => (question.voices[voice]?.length ?? 0) > 0);
}

export function buildOrders(questions: Question[], seed: number, previousOrders?: Orders): Orders {
  const random = mulberry32(seed);
  const orders: Orders = {};

  for (const question of questions) {
    orders[question.id] = {} as Record<VoiceKey, string[]>;

    for (const voice of voicesForQuestion(question)) {
      const ids = (question.voices[voice] ?? []).map((candidate) => candidate.id);
      const previous = previousOrders?.[question.id]?.[voice];
      let shuffled = ids.slice();

      for (let attempt = 0; attempt < 64; attempt += 1) {
        shuffled = ids.slice();
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(random() * (index + 1));
          [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        if (!previous || shuffled.every((id, index) => id !== previous[index])) break;
      }

      if (previous && shuffled.some((id, index) => id === previous[index])) {
        shuffled = previous.slice(1).concat(previous[0]);
      }

      orders[question.id][voice] = shuffled;
    }
  }

  return orders;
}

function freshOrders(questions: Question[], seed: number, previousOrders?: Orders) {
  const normalized = normalizedSeed(seed);
  return { orders: buildOrders(questions, normalized, previousOrders), seed: normalized };
}

function validQuestionIds(questions: Question[], value: unknown) {
  if (!Array.isArray(value)) return undefined;

  const available = new Set(uniqueQuestionIds(questions));
  const ids = value.filter((id): id is string => typeof id === "string" && available.has(id));
  const unique = [...new Set(ids)];
  const expectedCount = Math.min(QUESTIONS_PER_GAME, available.size);
  return unique.length === expectedCount ? unique : undefined;
}

function hasValidOrder(candidateIds: unknown, candidates: Candidate[]) {
  if (!Array.isArray(candidateIds) || candidateIds.length !== candidates.length) return false;

  const expectedIds = new Set(candidates.map((candidate) => candidate.id));
  const receivedIds = new Set<string>();

  return candidateIds.every((id) => {
    if (typeof id !== "string" || !expectedIds.has(id) || receivedIds.has(id)) return false;
    receivedIds.add(id);
    return true;
  });
}

function isValidOrders(questions: Question[], value: unknown): value is Orders {
  if (!isRecord(value)) return false;

  return questions.every((question) => {
    const questionOrders = value[question.id];

    return (
      isRecord(questionOrders) &&
      voicesForQuestion(question).every((voice) => hasValidOrder(questionOrders[voice], question.voices[voice] ?? []))
    );
  });
}

export function sanitizeSelections(questions: Question[], value: unknown): Selections {
  if (!isRecord(value)) return {};

  const selections: Selections = {};

  for (const question of questions) {
    const savedQuestionSelections = value[question.id];
    if (!isRecord(savedQuestionSelections)) continue;

    const validQuestionSelections: Partial<Record<VoiceKey, string>> = {};

    for (const voice of voicesForQuestion(question)) {
      const selectedId = savedQuestionSelections[voice];
      if (typeof selectedId === "string" && candidateFor(question, voice, selectedId)) {
        validQuestionSelections[voice] = selectedId;
      }
    }

    if (Object.keys(validQuestionSelections).length > 0) {
      selections[question.id] = validQuestionSelections;
    }
  }

  return selections;
}

function validCurrent(value: unknown, questionCount: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < questionCount
    ? value
    : 0;
}

export function hasAllSelections(questions: Question[], selections: Selections) {
  return questions.length > 0 && questions.every((question) => {
    const voices = voicesForQuestion(question);
    return voices.length > 0 && voices.every((voice) => Boolean(selections[question.id]?.[voice]));
  });
}

export function newGame(questions: Question[], seed = Date.now(), previousOrders?: Orders): GameState {
  const normalized = normalizedSeed(seed);
  const questionIds = drawQuestionIds(questions, normalized);
  const selectedQuestions = questionsForGame(questions, { questionIds });
  const next = freshOrders(selectedQuestions, normalized, previousOrders);

  return {
    version: GAME_STATE_VERSION,
    seed: next.seed,
    questionIds,
    current: 0,
    submitted: false,
    selections: {},
    orders: next.orders,
  };
}

/**
 * 将任意旧版本的已保存状态收敛为当前版本。
 * 排列总会重新生成，作答、当前题目和有效的已提交状态会保留。
 */
export function restoreGame(questions: Question[], saved: unknown, seed = Date.now()): GameState {
  const persisted = isRecord(saved) ? saved : {};
  const savedSeed = typeof persisted.seed === "number" ? persisted.seed : seed;
  const normalized = normalizedSeed(savedSeed);
  const questionIds = validQuestionIds(questions, persisted.questionIds) ?? drawQuestionIds(questions, normalized);
  const selectedQuestions = questionsForGame(questions, { questionIds });
  const selections = sanitizeSelections(selectedQuestions, persisted.selections);
  const previousOrders = isValidOrders(selectedQuestions, persisted.orders) ? persisted.orders : undefined;
  const next = freshOrders(selectedQuestions, normalized, previousOrders);

  return {
    version: GAME_STATE_VERSION,
    seed: next.seed,
    questionIds,
    current: validCurrent(persisted.current, selectedQuestions.length),
    submitted: persisted.submitted === true && hasAllSelections(selectedQuestions, selections),
    selections,
    orders: next.orders,
  };
}

export function isComplete(state: GameState, questions?: Question[]) {
  return state.questionIds.length > 0 && state.questionIds.every((questionId) => {
    const question = questions?.find((item) => item.id === questionId);
    const voices = question ? voicesForQuestion(question) : Object.keys(state.orders[questionId] ?? {}) as VoiceKey[];
    return voices.length > 0 && voices.every((voice) => Boolean(state.selections[questionId]?.[voice]));
  });
}

export function candidateFor(question: Question, voice: VoiceKey, id?: string) {
  return question.voices[voice]?.find((candidate) => candidate.id === id);
}

export function originalCandidateFor(question: Question, voice: VoiceKey) {
  return question.voices[voice]?.find((candidate) => candidate.isOriginal);
}

export function isOriginalSelection(question: Question, voice: VoiceKey, selectedId?: string) {
  return selectedId !== undefined && selectedId === originalCandidateFor(question, voice)?.id;
}

export function scoreGame(
  questions: Question[],
  selections: Selections,
  weights: { completeQuestion?: number; voiceAccuracy?: number } = {},
) {
  let voices = 0;
  let questionsCorrect = 0;
  let totalVoices = 0;

  for (const question of questions) {
    const activeVoices = voicesForQuestion(question);
    let correct = 0;

    totalVoices += activeVoices.length;
    for (const voice of activeVoices) {
      if (isOriginalSelection(question, voice, selections[question.id]?.[voice])) {
        voices += 1;
        correct += 1;
      }
    }

    if (activeVoices.length > 0 && correct === activeVoices.length) questionsCorrect += 1;
  }

  const totalQuestions = questions.length;
  const questionRatio = totalQuestions > 0 ? questionsCorrect / totalQuestions : 0;
  const voiceRatio = totalVoices > 0 ? voices / totalVoices : 0;
  const completeQuestionWeight = weights.completeQuestion ?? 25;
  const voiceAccuracyWeight = weights.voiceAccuracy ?? 75;
  const questionPoints = questionRatio * completeQuestionWeight;
  const voicePoints = voiceRatio * voiceAccuracyWeight;

  return {
    voices,
    totalVoices,
    questions: questionsCorrect,
    totalQuestions,
    questionRatio,
    voiceRatio,
    questionPoints,
    voicePoints,
    totalScore: questionPoints + voicePoints,
  };
}
