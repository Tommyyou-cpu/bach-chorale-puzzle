import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const QUESTIONS_PATH = path.join(ROOT, "app", "questions.generated.json");
const MUSIC_DIR = path.join(ROOT, "public", "music");
const GENERATED_SCORES_DIR = path.join(ROOT, "public", "generated-scores");
const VOICES = ["soprano", "alto", "tenor", "bass"];
const QUESTION_IDS = ["q1", "q2", "q3"];
const DECOY_TYPES = ["voice-leading", "harmony", "mixed"];
const VARIANTS_PER_VOICE = 4;
const EXPECTED_ASSETS_PER_FORMAT = QUESTION_IDS.length * VOICES.length * VARIANTS_PER_VOICE;

const errors = [];
const referenced = { mp3: new Set(), wav: new Set(), musicxml: new Set() };

function fail(message) {
  errors.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function display(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function assetRoute(questionId, candidateId, extension) {
  return `/music/${questionId}/${candidateId}.${extension}`;
}

function localAssetPath(route) {
  if (!route.startsWith("/music/")) return null;
  const filePath = path.resolve(ROOT, "public", `.${route}`);
  const relative = path.relative(MUSIC_DIR, filePath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}

function verifyAsset({ questionId, voice, variant, candidate, field, extension }) {
  const label = `${questionId}/${voice}/variant ${variant}/${field}`;
  const route = candidate[field];
  if (!isNonEmptyString(route)) {
    fail(`${label} 必须是非空字符串`);
    return;
  }

  referenced[extension].add(route);
  const expected = isNonEmptyString(candidate.id) ? assetRoute(questionId, candidate.id, extension) : null;
  if (route !== expected) {
    fail(`${label} 必须为 ${expected ?? "由有效 candidate id 生成的资源路径"}，当前为 ${display(route)}`);
  }

  const filePath = localAssetPath(route);
  if (!filePath) {
    fail(`${label} 必须指向 public/music 内的资源：${route}`);
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) fail(`${label} 不是文件：${route}`);
    else if (stat.size === 0) fail(`${label} 资源为空：${route}`);
  } catch {
    fail(`${label} 缺少资源：${route}`);
  }
}

function collectMusicAssets() {
  const assets = { mp3: new Set(), wav: new Set(), musicxml: new Set() };
  if (!fs.existsSync(MUSIC_DIR)) {
    fail("缺少 public/music 目录");
    return assets;
  }

  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        const route = `/music/${path.relative(MUSIC_DIR, fullPath).split(path.sep).join("/")}`;
        if (entry.name.endsWith(".mp3")) assets.mp3.add(route);
        if (entry.name.endsWith(".wav")) assets.wav.add(route);
        if (entry.name.endsWith(".musicxml")) assets.musicxml.add(route);
      }
    }
  };

  visit(MUSIC_DIR);
  return assets;
}

function verifyGeneratedScores(questions) {
  const expected = new Set();
  for (const question of questions) {
    if (!isRecord(question) || !isNonEmptyString(question.id) || !isRecord(question.voices)) continue;
    const candidates = VOICES.map((voice) => question.voices[voice]);
    if (candidates.some((items) => !Array.isArray(items))) continue;
    for (const soprano of candidates[0]) for (const alto of candidates[1]) {
      for (const tenor of candidates[2]) for (const bass of candidates[3]) {
        const selected = [soprano, alto, tenor, bass];
        if (selected.some((candidate) => !isRecord(candidate) || !isNonEmptyString(candidate.id))) continue;
        expected.add(path.join(GENERATED_SCORES_DIR, question.id, `${selected.map((candidate) => candidate.id).join("--")}.svg`));
      }
    }
  }

  let verified = 0;
  for (const filePath of expected) {
    try {
      const markup = fs.readFileSync(filePath, "utf8");
      if (!/<svg(?:\s|>)/i.test(markup)) fail(`预生成乐谱不是有效 SVG：${path.relative(ROOT, filePath)}`);
      else verified += 1;
    } catch {
      fail(`缺少预生成乐谱：${path.relative(ROOT, filePath)}`);
    }
  }
  return { expected: expected.size, verified };
}

let questions;
try {
  questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf8"));
} catch (error) {
  fail(`无法读取或解析 app/questions.generated.json：${error.message}`);
}

if (!Array.isArray(questions)) {
  fail("app/questions.generated.json 顶层必须是题目数组");
  questions = [];
}

if (questions.length !== QUESTION_IDS.length) {
  fail(`题目数应为 ${QUESTION_IDS.length}，当前为 ${questions.length}`);
}

const seenQuestionIds = new Map();
for (const [index, question] of questions.entries()) {
  const label = `question[${index}]`;
  if (!isRecord(question)) {
    fail(`${label} 必须是对象`);
    continue;
  }
  if (!isNonEmptyString(question.id)) {
    fail(`${label}.id 必须是非空字符串`);
    continue;
  }
  if (seenQuestionIds.has(question.id)) {
    fail(`题目 id 重复：${question.id}（question[${seenQuestionIds.get(question.id)}] 与 ${label}）`);
  } else {
    seenQuestionIds.set(question.id, index);
  }
}

for (const questionId of QUESTION_IDS) {
  if (!seenQuestionIds.has(questionId)) fail(`缺少预期题目：${questionId}`);
}
for (const questionId of seenQuestionIds.keys()) {
  if (!QUESTION_IDS.includes(questionId)) fail(`存在非预期题目 id：${questionId}`);
}

for (const question of questions) {
  if (!isRecord(question) || !isNonEmptyString(question.id)) continue;
  const questionId = question.id;
  const voices = question.voices;
  if (!isRecord(voices)) {
    fail(`${questionId}.voices 必须是包含四个声部的对象`);
    continue;
  }

  const voiceKeys = Object.keys(voices);
  for (const voice of VOICES) {
    if (!(voice in voices)) fail(`${questionId}.voices 缺少 ${voice} 声部`);
  }
  for (const voice of voiceKeys) {
    if (!VOICES.includes(voice)) fail(`${questionId}.voices 包含非预期声部：${voice}`);
  }

  for (const voice of VOICES) {
    const candidates = voices[voice];
    if (!Array.isArray(candidates)) {
      fail(`${questionId}/${voice} 必须是变体数组`);
      continue;
    }
    if (candidates.length !== VARIANTS_PER_VOICE) {
      fail(`${questionId}/${voice} 应有 ${VARIANTS_PER_VOICE} 个变体，当前为 ${candidates.length}`);
    }

    const candidateIds = new Set();
    const originalCount = candidates.filter((candidate) => isRecord(candidate) && candidate.isOriginal === true).length;
    if (originalCount !== 1) {
      fail(`${questionId}/${voice} 的原作候选必须唯一，当前为 ${originalCount} 个`);
    }

    const decoyTypes = [];
    for (const [variant, candidate] of candidates.entries()) {
      const label = `${questionId}/${voice}/variant ${variant}`;
      if (!isRecord(candidate)) {
        fail(`${label} 必须是对象`);
        continue;
      }

      if (!isNonEmptyString(candidate.id)) {
        fail(`${label}.id 必须是非空字符串`);
      } else if (candidateIds.has(candidate.id)) {
        fail(`${questionId}/${voice} 的 candidate id 重复：${candidate.id}`);
      } else {
        candidateIds.add(candidate.id);
      }

      if (typeof candidate.isOriginal !== "boolean") {
        fail(`${label}.isOriginal 必须是布尔值`);
      }
      if (candidate.variant !== variant) {
        fail(`${label}.variant 必须为 ${variant}，当前为 ${display(candidate.variant)}`);
      }
      if (!isNonEmptyString(candidate.explanation)) {
        fail(`${label}.explanation 必须是非空字符串`);
      }
      if (variant === 0) {
        if (candidate.isOriginal !== true) fail(`${label} 必须是原作（isOriginal: true）`);
        if (candidate.decoyType !== "original") {
          fail(`${label}.decoyType 必须为 "original"，当前为 ${display(candidate.decoyType)}`);
        }
      } else {
        if (candidate.isOriginal !== false) fail(`${label} 必须是干扰项（isOriginal: false）`);
        if (!DECOY_TYPES.includes(candidate.decoyType)) {
          fail(`${label}.decoyType 必须是 ${DECOY_TYPES.join("、")} 之一，当前为 ${display(candidate.decoyType)}`);
        } else {
          decoyTypes.push(candidate.decoyType);
        }
      }

      verifyAsset({ questionId, voice, variant, candidate, field: "audio", extension: "mp3" });
      verifyAsset({ questionId, voice, variant, candidate, field: "audioFallback", extension: "wav" });
      verifyAsset({ questionId, voice, variant, candidate, field: "score", extension: "musicxml" });
    }

    if (decoyTypes.length === VARIANTS_PER_VOICE - 1) {
      for (const decoyType of DECOY_TYPES) {
        const count = decoyTypes.filter((type) => type === decoyType).length;
        if (count !== 1) {
          fail(`${questionId}/${voice} 的三个干扰项必须各含一个 ${decoyType} decoyType，当前为 ${count} 个`);
        }
      }
    }
  }
}

const musicAssets = collectMusicAssets();
const generatedScores = verifyGeneratedScores(questions);
const dynamicExpectedAssets = questions.length * VOICES.length * VARIANTS_PER_VOICE;
if (dynamicExpectedAssets !== EXPECTED_ASSETS_PER_FORMAT) {
  fail(`按当前题目数计算应有 ${dynamicExpectedAssets} 个 MP3、WAV 与 MusicXML；项目约定应为 ${EXPECTED_ASSETS_PER_FORMAT} 个`);
}

for (const extension of ["mp3", "wav", "musicxml"]) {
  if (referenced[extension].size !== EXPECTED_ASSETS_PER_FORMAT) {
    fail(`题库引用的 ${extension} 资源应为 ${EXPECTED_ASSETS_PER_FORMAT} 个唯一文件，当前为 ${referenced[extension].size}`);
  }
  if (musicAssets[extension].size !== EXPECTED_ASSETS_PER_FORMAT) {
    fail(`public/music 中的 ${extension} 资源应为 ${EXPECTED_ASSETS_PER_FORMAT} 个，当前为 ${musicAssets[extension].size}`);
  }
  for (const route of musicAssets[extension]) {
    if (!referenced[extension].has(route)) fail(`存在未被题库引用的 ${extension} 资源：${route}`);
  }
}

if (errors.length > 0) {
  console.error(`题库校验失败（${errors.length} 项）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    questions: questions.length,
    tracks: dynamicExpectedAssets,
    combinations: questions.length * VARIANTS_PER_VOICE ** VOICES.length,
    mp3Files: musicAssets.mp3.size,
    wavFiles: musicAssets.wav.size,
    musicxmlFiles: musicAssets.musicxml.size,
    generatedScoreFiles: generatedScores.verified,
    scoreCases: { allCorrect: "3/12", allWrong: "0/0", partial: "0–3/0–12" },
  }, null, 2));
}
