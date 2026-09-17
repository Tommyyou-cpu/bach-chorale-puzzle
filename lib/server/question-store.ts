import { asc, eq } from "drizzle-orm";
import rawQuestions from "../../app/questions.generated.json";
import { getDb } from "../../db";
import { questions, type QuestionVoices } from "../../db/schema";
import {
  normaliseStoredQuestion,
  type ManagedQuestion,
  type NormalizedQuestion,
  type NormalizedQuestionPatch,
  parseQuestionInput,
  QuestionValidationError,
} from "./question-validation";

type QuestionRow = typeof questions.$inferSelect;

export type QuestionListResult = {
  questions: ManagedQuestion[];
  storage: "database" | "static";
  warning?: string;
};

const staticQuestions = (rawQuestions as unknown[])
  .map((question, index) =>
    normaliseStoredQuestion({
      ...(question as Record<string, unknown>),
      enabled: true,
      sortOrder: index,
    }),
  )
  .filter((question): question is ManagedQuestion => Boolean(question));

export function getStaticQuestions() {
  return staticQuestions.map((question) => ({
    ...question,
    voices: cloneVoices(question.voices),
  }));
}

function cloneVoices(voices: QuestionVoices): QuestionVoices {
  return JSON.parse(JSON.stringify(voices)) as QuestionVoices;
}

function rowToQuestion(row: QuestionRow): ManagedQuestion {
  const question = normaliseStoredQuestion({
    ...row,
    sourceLabel: row.sourceLabel,
    licenseNote: row.licenseNote,
    voices: row.voices,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!question) throw new Error(`题目 ${row.id} 的存储数据不符合当前格式`);
  return question;
}

function rowValues(question: NormalizedQuestion) {
  return {
    id: question.id,
    title: question.title,
    genre: question.genre,
    voiceCount: question.voiceCount,
    clefs: question.clefs,
    keySignature: question.keySignature,
    bwv: question.bwv,
    measures: question.measures,
    duration: question.duration,
    bpm: question.bpm,
    source: question.source,
    sourceLabel: question.sourceLabel,
    analysis: question.analysis,
    licenseNote: question.licenseNote,
    voices: question.voices,
    enabled: question.enabled,
    sortOrder: question.sortOrder,
  };
}

function isMissingTable(error: unknown) {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return message.includes("no such table") || message.includes("questions");
}

export function databaseUnavailableMessage(error?: unknown) {
  if (isMissingTable(error)) {
    return "题库数据表尚未创建。请先执行 npm run db:generate，并将生成的 drizzle SQL 应用到 Cloudflare D1。";
  }
  return "题库数据库当前不可用。请检查 Cloudflare D1 的 DB 绑定和部署配置。";
}

export async function listQuestions(includeDisabled = false): Promise<QuestionListResult> {
  try {
    const db = getDb();
    const rows = includeDisabled
      ? await db.select().from(questions).orderBy(asc(questions.sortOrder), asc(questions.id))
      : await db
          .select()
          .from(questions)
          .where(eq(questions.enabled, true))
          .orderBy(asc(questions.sortOrder), asc(questions.id));

    return {
      questions: rows.map(rowToQuestion),
      storage: "database",
    };
  } catch (error) {
    return {
      questions: getStaticQuestions(),
      storage: "static",
      warning: databaseUnavailableMessage(error),
    };
  }
}

export async function createQuestion(question: NormalizedQuestion): Promise<ManagedQuestion> {
  const db = getDb();
  const [row] = await db.insert(questions).values(rowValues(question)).returning();
  if (!row) throw new Error("创建题目后未返回数据");
  return rowToQuestion(row);
}

export async function updateQuestion(
  id: string,
  patch: NormalizedQuestionPatch,
): Promise<ManagedQuestion | null> {
  const db = getDb();
  const [existingRow] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!existingRow) return null;

  const existing = rowToQuestion(existingRow);
  const merged = parseQuestionInput({
    ...existing,
    ...patch,
    id,
    enabled: patch.enabled ?? existing.enabled,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
  });
  if (!merged.success) throw new QuestionValidationError(merged.error);

  const { id: rowId, ...values } = rowValues(merged.data);
  void rowId;
  const [row] = await db
    .update(questions)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(questions.id, id))
    .returning();
  return row ? rowToQuestion(row) : null;
}

export async function deleteQuestion(id: string): Promise<ManagedQuestion | null> {
  const db = getDb();
  const [existing] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!existing) return null;
  await db.delete(questions).where(eq(questions.id, id));
  return rowToQuestion(existing);
}
