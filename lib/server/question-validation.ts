import { z } from "zod";
import {
  type QuestionCandidate,
  type QuestionClefs,
  type QuestionDecoyType,
  type QuestionVoices,
} from "../../db/schema";

const decoyTypes = ["original", "voice-leading", "harmony", "mixed"] as const;

const idSchema = z
  .string()
  .trim()
  .min(1, "题目 ID 不能为空")
  .max(64, "题目 ID 最多 64 个字符")
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "题目 ID 只能包含字母、数字、下划线和短横线");

const textField = (label: string, max = 1000) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}过长`);

const assetPathSchema = (label: string) =>
  textField(label, 2048).refine((value) => {
    if (/^https?:\/\//i.test(value)) return true;
    return value.startsWith("/") && !value.startsWith("//") && !value.includes("..");
  }, `${label}必须是站内路径或 HTTPS 地址`);

const candidateSchema = z
  .object({
    id: idSchema,
    audio: assetPathSchema("音频路径"),
    audioFallback: assetPathSchema("备用音频路径").optional(),
    score: assetPathSchema("乐谱路径"),
    isOriginal: z.boolean(),
    variant: z.number().int().min(0).max(3).optional(),
    decoyType: z.enum(decoyTypes).optional(),
    explanation: z.string().trim().max(2000, "选项说明过长").optional(),
  })
  .strict();

const voiceNameSchema = z
  .string()
  .trim()
  .min(1, "声部名称不能为空")
  .max(32, "声部名称过长")
  .regex(/^[a-z][a-z0-9_-]*$/i, "声部名称只能包含字母、数字、下划线和短横线");

const voiceCandidatesSchema = z
  .array(candidateSchema)
  .min(3, "每个声部至少需要 3 个选项")
  .max(4, "每个声部最多 4 个选项");

const voicesSchema = z.record(voiceNameSchema, voiceCandidatesSchema);
const clefsSchema = z.record(voiceNameSchema, textField("谱号", 80));

const questionFields = {
  title: textField("标题", 240),
  genre: textField("体裁", 80),
  voiceCount: z.union([z.literal(3), z.literal(4)]),
  clefs: clefsSchema,
  keySignature: textField("调号", 80),
  bwv: textField("BWV", 120),
  measures: textField("小节范围", 240),
  duration: z.number().finite().positive().max(3600, "时长过大"),
  bpm: z.number().int().positive().max(400, "速度必须不超过 400"),
  source: assetPathSchema("来源链接"),
  sourceLabel: textField("来源名称", 240),
  analysis: textField("听辨分析", 5000),
  licenseNote: textField("许可说明", 2000),
  voices: voicesSchema,
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
};

export const createQuestionSchema = z
  .object({
    id: idSchema,
    ...questionFields,
  })
  .strict();

export const patchQuestionSchema = z
  .object({
    ...questionFields,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个要更新的字段");

export type QuestionInput = z.infer<typeof createQuestionSchema>;
export type QuestionPatch = z.infer<typeof patchQuestionSchema>;
export type NormalizedQuestion = Omit<QuestionInput, "voices" | "clefs"> & {
  voices: QuestionVoices;
  clefs: QuestionClefs;
};
export type NormalizedQuestionPatch = Omit<QuestionPatch, "voices" | "clefs"> & {
  voices?: QuestionVoices;
  clefs?: QuestionClefs;
};

export type PublicQuestion = Omit<ManagedQuestion, "enabled" | "sortOrder" | "createdAt" | "updatedAt">;
export type ManagedQuestion = NormalizedQuestion & {
  createdAt?: string;
  updatedAt?: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export class QuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionValidationError";
  }
}

function formatZodError(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "题目数据格式不正确";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

function normaliseCandidate(candidate: z.infer<typeof candidateSchema>, index: number): QuestionCandidate {
  const variant = candidate.variant ?? index;
  const isOriginal = candidate.isOriginal;
  const decoyType: QuestionDecoyType = isOriginal
    ? "original"
    : candidate.decoyType && candidate.decoyType !== "original"
      ? candidate.decoyType
      : "mixed";

  return {
    id: candidate.id,
    audio: candidate.audio,
    audioFallback: candidate.audioFallback ?? candidate.audio,
    score: candidate.score,
    isOriginal,
    variant,
    decoyType,
    explanation: candidate.explanation ?? (isOriginal ? "原作声部。" : "替代声部。"),
  };
}

function normaliseVoices(value: z.infer<typeof voicesSchema>): QuestionVoices | string {
  const result: QuestionVoices = {};

  for (const voice of Object.keys(value)) {
    const candidates = value[voice]!.map(normaliseCandidate);
    const ids = new Set<string>();
    const originalCount = candidates.filter((candidate) => candidate.isOriginal).length;

    for (const candidate of candidates) {
      if (ids.has(candidate.id)) return `${voice} 声部包含重复的选项 ID：${candidate.id}`;
      ids.add(candidate.id);
    }
    if (originalCount !== 1) return `${voice} 声部必须且只能有一个原作选项`;
    result[voice] = candidates;
  }

  return result;
}

function normaliseClefs(value: z.infer<typeof clefsSchema>, voiceNames: string[]): QuestionClefs | string {
  const result: QuestionClefs = {};
  for (const voice of voiceNames) {
    const clef = value[voice];
    if (!clef) return `声部 ${voice} 缺少谱号`;
    result[voice] = clef;
  }
  if (Object.keys(value).some((voice) => !voiceNames.includes(voice))) {
    return "谱号键必须与声部键完全一致";
  }
  return result;
}

function defaultClefs(value: unknown): QuestionClefs {
  const voices = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  const defaults: Record<string, string> = {
    soprano: "treble",
    alto: "alto",
    tenor: "treble-8",
    bass: "bass",
  };
  return Object.fromEntries(voices.map((voice) => [voice, defaults[voice] ?? "treble"]));
}

export function parseQuestionInput(value: unknown): ValidationResult<NormalizedQuestion> {
  const parsed = createQuestionSchema.safeParse(value);
  if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };

  const voices = normaliseVoices(parsed.data.voices);
  if (typeof voices === "string") return { success: false, error: voices };

  const voiceNames = Object.keys(voices);
  if (voiceNames.length !== parsed.data.voiceCount) {
    return { success: false, error: `声部数为 ${parsed.data.voiceCount} 时必须提供 ${parsed.data.voiceCount} 个声部` };
  }
  const clefs = normaliseClefs(parsed.data.clefs, voiceNames);
  if (typeof clefs === "string") return { success: false, error: clefs };

  return { success: true, data: { ...parsed.data, voices, clefs } };
}

export function parseQuestionPatch(value: unknown): ValidationResult<NormalizedQuestionPatch> {
  const parsed = patchQuestionSchema.safeParse(value);
  if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };

  if (parsed.data.voices) {
    const voices = normaliseVoices(parsed.data.voices);
    if (typeof voices === "string") return { success: false, error: voices };
    const voiceNames = Object.keys(voices);
    if (voiceNames.length !== (parsed.data.voiceCount ?? voiceNames.length)) {
      return { success: false, error: `声部数必须与声部数据一致（当前为 ${voiceNames.length}）` };
    }
    if (parsed.data.clefs) {
      const clefs = normaliseClefs(parsed.data.clefs, voiceNames);
      if (typeof clefs === "string") return { success: false, error: clefs };
      return { success: true, data: { ...parsed.data, voices, clefs } };
    }
    return { success: true, data: { ...parsed.data, voices } };
  }

  if (parsed.data.voiceCount !== undefined && parsed.data.voiceCount !== 3 && parsed.data.voiceCount !== 4) {
    return { success: false, error: "声部数只能是 3 或 4" };
  }

  return { success: true, data: { ...parsed.data, voices: undefined } };
}

export function normaliseStoredQuestion(value: unknown): ManagedQuestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parsed = parseQuestionInput({
    id: record.id,
    title: record.title,
    genre: typeof record.genre === "string" ? record.genre : "chorale",
    voiceCount:
      record.voiceCount === 3 || record.voiceCount === 4
        ? record.voiceCount
        : record.voices && typeof record.voices === "object" && !Array.isArray(record.voices)
          ? Object.keys(record.voices).length
          : 4,
    clefs:
      record.clefs && typeof record.clefs === "object" && !Array.isArray(record.clefs)
        ? record.clefs
        : defaultClefs(record.voices),
    keySignature: typeof record.keySignature === "string" ? record.keySignature : "未记录（请核对）",
    bwv: record.bwv,
    measures: record.measures,
    duration: typeof record.duration === "number" ? record.duration : Number(record.duration),
    bpm: typeof record.bpm === "number" ? record.bpm : Number(record.bpm),
    source: record.source,
    sourceLabel: record.sourceLabel,
    analysis: record.analysis,
    licenseNote: record.licenseNote,
    voices: record.voices,
    enabled: record.enabled !== false,
    sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : Number(record.sortOrder ?? 0),
  });
  if (!parsed.success) return null;

  return {
    ...parsed.data,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

export function toPublicQuestion(question: ManagedQuestion): PublicQuestion {
  const { enabled, sortOrder, createdAt, updatedAt, ...publicQuestion } = question;
  void enabled;
  void sortOrder;
  void createdAt;
  void updatedAt;
  return publicQuestion;
}
