#!/usr/bin/env node

/**
 * 从仓库中的 app/questions.generated.json 生成 D1（Cloudflare 边缘数据库）种子迁移，
 * 或直接调用 Worker 管理导入接口。新题库更新后重新运行即可。
 *
 * 示例：
 *   node worker/scripts/seed-questions.mjs
 *   node worker/scripts/seed-questions.mjs --output worker/migrations/0002_seed_questions.sql
 *   node worker/scripts/seed-questions.mjs --url https://api.example.com --token TOKEN
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "../..");

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(typeof value === "string" ? value : JSON.stringify(value)).replaceAll("'", "''")}'`;
}

function measures(value) {
  const match = String(value ?? "").match(/(\d+)\D+(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

function normalize(question, sortOrder) {
  const voices = question.voices ?? {};
  const voiceOrder = question.voiceOrder?.length ? question.voiceOrder : Object.keys(voices);
  const [measureStart, measureEnd] = [question.measureStart, question.measureEnd].every(Number.isInteger)
    ? [question.measureStart, question.measureEnd]
    : measures(question.measures);
  return {
    ...question,
    genre: question.genre ?? question.category ?? "other",
    voiceCount: question.voiceCount ?? voiceOrder.length,
    voiceOrder,
    voiceLabels: question.voiceLabels ?? {},
    keySignature: question.keySignature ?? "",
    timeSignature: question.timeSignature ?? "4/4",
    measureStart,
    measureEnd,
    sourceEdition: question.sourceEdition ?? question.sourceLabel ?? "",
    sourceLicense: question.sourceLicense ?? question.licenseNote ?? "",
    maxRestByVoice: question.maxRestByVoice ?? {},
    revision: question.revision ?? 1,
    enabled: question.enabled !== false,
    sortOrder: question.sortOrder ?? sortOrder,
  };
}

function row(question) {
  return [
    question.id,
    question.title,
    question.genre,
    question.voiceCount,
    question.voiceOrder,
    question.voiceLabels,
    question.clefs,
    question.keySignature,
    question.timeSignature,
    question.bwv,
    question.measures,
    question.measureStart,
    question.measureEnd,
    question.duration,
    question.bpm,
    question.source,
    question.sourceLabel,
    question.analysis,
    question.licenseNote,
    question.sourceEdition,
    question.sourceLicense,
    question.maxRestByVoice,
    question.voices,
    question.revision,
    question.enabled,
    question.sortOrder,
  ].map(sql).join(", ");
}

function updateClause() {
  return [
    "title", "genre", "voice_count", "voice_order_json", "voice_labels_json", "clefs_json",
    "key_signature", "time_signature", "bwv", "measures", "measure_start", "measure_end",
    "duration", "bpm", "source", "source_label", "analysis", "license_note", "source_edition",
    "source_license", "max_rest_by_voice_json", "voices_json", "revision", "enabled", "sort_order",
  ].map((column) => `${column} = excluded.${column}`).join(",\n  ");
}

async function main() {
  const input = option("--input", path.join(rootDirectory, "app/questions.generated.json"));
  const output = option("--output", path.join(rootDirectory, "worker/migrations/0003_expand_chorales.sql"));
  const questions = JSON.parse(await fs.readFile(input, "utf8"));
  if (!Array.isArray(questions) || !questions.length) throw new Error("题库 JSON 为空");
  const normalized = questions.map(normalize);
  const categories = Object.fromEntries(["chorale", "fugue", "other"].map((category) => [category, normalized.filter((item) => item.genre === category).length]));
  const url = option("--url");
  const token = option("--token");
  if (url) {
    const response = await fetch(`${url.replace(/\/$/, "")}/api/admin/questions/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ questions: normalized }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`导入失败（${response.status}）：${text}`);
    console.log(text);
    return;
  }

  const statements = normalized.map((question) => `INSERT INTO questions (
  id, title, genre, voice_count, voice_order_json, voice_labels_json, clefs_json,
  key_signature, time_signature, bwv, measures, measure_start, measure_end,
  duration, bpm, source, source_label, analysis, license_note, source_edition,
  source_license, max_rest_by_voice_json, voices_json, revision, enabled, sort_order
) VALUES (${row(question)})
ON CONFLICT(id) DO UPDATE SET
  ${updateClause()};`).join("\n\n");
  const gameRules = JSON.stringify({
    questionsPerGame: 3,
    allocation: { chorale: 3, fugue: 0, other: 0 },
    scoreWeights: { completeQuestion: 25, voiceAccuracy: 75 },
    revision: 2,
  });
  const rulesStatement = `INSERT INTO settings (key, value_json, revision, updated_at)\nVALUES ('game_rules', '${gameRules}', 2, CURRENT_TIMESTAMP)\nON CONFLICT(key) DO UPDATE SET\n  value_json = excluded.value_json,\n  revision = excluded.revision,\n  updated_at = excluded.updated_at;`;
  const content = `-- Generated by worker/scripts/seed-questions.mjs.\n-- Questions: ${normalized.length}; categories: ${JSON.stringify(categories)}\n\nBEGIN;\n\n${statements}\n\n${rulesStatement}\n\nCOMMIT;\n`;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, content);
  console.log(`已生成 ${output}`);
  console.log(`题目 ${normalized.length} 道，分类 ${JSON.stringify(categories)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
