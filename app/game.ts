export const VOICES = ["soprano", "alto", "tenor", "bass"] as const;
export type VoiceKey = (typeof VOICES)[number];

export type DecoyType = "original" | "voice-leading" | "harmony" | "mixed";

export type Candidate = {
  id: string;
  audio: string;
  score: string;
  isOriginal: boolean;
  variant: number;
  decoyType: DecoyType;
  explanation: string;
};

export type Question = {
  id: string;
  title: string;
  bwv: string;
  measures: string;
  duration: number;
  bpm: number;
  source: string;
  sourceLabel: string;
  analysis: string;
  licenseNote: string;
  voices: Record<VoiceKey, Candidate[]>;
};

export type Selections = Record<string, Partial<Record<VoiceKey, string>>>;
export type Orders = Record<string, Record<VoiceKey, string[]>>;

export const GAME_STATE_VERSION = 3 as const;
export type GameState = {
  version: typeof GAME_STATE_VERSION;
  seed: number;
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

export function buildOrders(questions: Question[], seed: number, previousOrders?: Orders): Orders {
  const random = mulberry32(seed);
  const orders: Orders = {};

  for (const question of questions) {
    orders[question.id] = {} as Record<VoiceKey, string[]>;

    for (const voice of VOICES) {
      const ids = question.voices[voice].map((candidate) => candidate.id);
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
      VOICES.every((voice) => hasValidOrder(questionOrders[voice], question.voices[voice]))
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

    for (const voice of VOICES) {
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
  return questions.length > 0 && questions.every((question) => VOICES.every((voice) => Boolean(selections[question.id]?.[voice])));
}

export function newGame(questions: Question[], seed = Date.now(), previousOrders?: Orders): GameState {
  const next = freshOrders(questions, seed, previousOrders);

  return {
    version: GAME_STATE_VERSION,
    seed: next.seed,
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
  const selections = sanitizeSelections(questions, persisted.selections);
  const previousOrders = isValidOrders(questions, persisted.orders) ? persisted.orders : undefined;
  const next = freshOrders(questions, seed, previousOrders);

  return {
    version: GAME_STATE_VERSION,
    seed: next.seed,
    current: validCurrent(persisted.current, questions.length),
    submitted: persisted.submitted === true && hasAllSelections(questions, selections),
    selections,
    orders: next.orders,
  };
}

export function isComplete(state: GameState) {
  const questionIds = Object.keys(state.orders);
  return questionIds.length > 0 && questionIds.every((questionId) => VOICES.every((voice) => Boolean(state.selections[questionId]?.[voice])));
}

export function candidateFor(question: Question, voice: VoiceKey, id?: string) {
  return question.voices[voice].find((candidate) => candidate.id === id);
}

export function originalCandidateFor(question: Question, voice: VoiceKey) {
  return question.voices[voice].find((candidate) => candidate.isOriginal);
}

export function isOriginalSelection(question: Question, voice: VoiceKey, selectedId?: string) {
  return selectedId !== undefined && selectedId === originalCandidateFor(question, voice)?.id;
}

export function scoreGame(questions: Question[], selections: Selections) {
  let voices = 0;
  let questionsCorrect = 0;

  for (const question of questions) {
    let correct = 0;

    for (const voice of VOICES) {
      if (isOriginalSelection(question, voice, selections[question.id]?.[voice])) {
        voices += 1;
        correct += 1;
      }
    }

    if (correct === VOICES.length) questionsCorrect += 1;
  }

  return { voices, questions: questionsCorrect };
}
