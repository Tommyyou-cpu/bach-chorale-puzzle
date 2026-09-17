import { sql } from "drizzle-orm";
import { check, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type QuestionDecoyType =
  | "original"
  | "voice-leading"
  | "harmony"
  | "mixed";

export type QuestionCandidate = {
  id: string;
  audio: string;
  audioFallback: string;
  score: string;
  isOriginal: boolean;
  variant: number;
  decoyType: QuestionDecoyType;
  explanation: string;
};

/** 声部键保持开放，允许三声部赋格或四声部众赞歌等不同编制。 */
export type QuestionVoices = Record<string, QuestionCandidate[]>;
export type QuestionClefs = Record<string, string>;

/**
 * 题目正文和候选声部放在同一行，方便日常通过管理页面整体更新一题。
 * 声部内容使用 SQLite JSON 文本存储，候选数量由应用层限制为 3 或 4。
 */
export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  genre: text("genre").notNull(),
  voiceCount: integer("voice_count").notNull(),
  clefs: text("clefs", { mode: "json" }).$type<QuestionClefs>().notNull(),
  keySignature: text("key_signature").notNull(),
  bwv: text("bwv").notNull(),
  measures: text("measures").notNull(),
  duration: real("duration").notNull(),
  bpm: integer("bpm").notNull(),
  source: text("source").notNull(),
  sourceLabel: text("source_label").notNull(),
  analysis: text("analysis").notNull(),
  licenseNote: text("license_note").notNull(),
  voices: text("voices", { mode: "json" })
    .$type<QuestionVoices>()
    .notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("questions_voice_count_check", sql`${table.voiceCount} in (3, 4)`),
  check("questions_clefs_json_check", sql`json_valid(${table.clefs})`),
  check("questions_voices_json_check", sql`json_valid(${table.voices})`),
]);
