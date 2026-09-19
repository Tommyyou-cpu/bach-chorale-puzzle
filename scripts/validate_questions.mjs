import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const QUESTIONS_PATH = path.join(ROOT, "app", "questions.generated.json");
const MUSIC_DIR = path.join(ROOT, "public", "music");
const GENERATED_SCORES_DIR = path.join(ROOT, "public", "generated-scores");
const DECOY_TYPES = ["voice-leading", "harmony", "mixed"];
const EXPECTED_QUESTIONS = 45;
const EXPECTED_GENRES = { chorale: 30, fugue: 10, other: 5 };

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

function keySignatureLabel(fifths) {
  const count = Math.abs(fifths);
  const accidental = fifths > 0 ? "sharp" : fifths < 0 ? "flat" : "natural";
  return count === 0 ? "no accidentals" : `${count} ${accidental}${count === 1 ? "" : "s"}`;
}

function musicXmlKeySignature(markup) {
  const keyBlock = markup.match(/<key\b[^>]*>([\s\S]*?)<\/key>/i);
  if (!keyBlock) return null;
  const fifthsMatch = keyBlock[1].match(/<fifths>\s*(-?\d+)\s*<\/fifths>/i);
  if (!fifthsMatch) return null;
  return keySignatureLabel(Number(fifthsMatch[1]));
}

function musicXmlClef(markup) {
  const clefBlock = markup.match(/<clef\b[^>]*>([\s\S]*?)<\/clef>/i);
  if (!clefBlock) return null;
  const signMatch = clefBlock[1].match(/<sign>\s*([^<]+?)\s*<\/sign>/i);
  const lineMatch = clefBlock[1].match(/<line>\s*(\d+)\s*<\/line>/i);
  const octaveMatch = clefBlock[1].match(/<clef-octave-change>\s*(-?\d+)\s*<\/clef-octave-change>/i);
  if (!signMatch || !lineMatch) return null;
  const sign = signMatch[1].trim();
  const line = Number(lineMatch[1]);
  const octaveChange = octaveMatch ? Number(octaveMatch[1]) : 0;
  if (sign === "G" && line === 2 && octaveChange === -1) return "treble-8";
  if (sign === "G" && line === 2 && octaveChange === 0) return "treble";
  if (sign === "C" && line === 3 && octaveChange === 0) return "alto";
  if (sign === "F" && line === 4 && octaveChange === 0) return "bass";
  return `${sign}${line}${octaveChange > 0 ? "+" : ""}${octaveChange || ""}`;
}

function musicXmlTimeSignature(markup) {
  const timeBlock = markup.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i);
  if (!timeBlock) return null;
  const beats = timeBlock[1].match(/<beats>\s*([^<]+?)\s*<\/beats>/i)?.[1]?.trim();
  const beatType = timeBlock[1].match(/<beat-type>\s*([^<]+?)\s*<\/beat-type>/i)?.[1]?.trim();
  return beats && beatType ? `${beats}/${beatType}` : null;
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

function verifyAsset({ question, questionId, voice, variant, candidate, field, extension }) {
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
    else if (extension === "musicxml") {
      const markup = fs.readFileSync(filePath, "utf8");
      const actualKeySignature = musicXmlKeySignature(markup);
      if (!actualKeySignature) {
        fail(`${label} 缺少调号：${route}`);
      }
      if (isNonEmptyString(question.keySignature) && actualKeySignature !== question.keySignature) {
        fail(`${label} 调号与题目元数据不一致：JSON=${display(question.keySignature)}，MusicXML=${display(actualKeySignature)}`);
      }
      const actualClef = musicXmlClef(markup);
      const expectedClef = isRecord(question.clefs) ? question.clefs[voice] : null;
      if (!actualClef) {
        fail(`${label} 缺少正确谱号：${route}`);
      } else if (isNonEmptyString(expectedClef) && actualClef !== expectedClef) {
        fail(`${label} 谱号与题目元数据不一致：JSON=${display(expectedClef)}，MusicXML=${display(actualClef)}`);
      }
      const actualTimeSignature = musicXmlTimeSignature(markup);
      if (!actualTimeSignature) {
        fail(`${label} 缺少拍号：${route}`);
      } else if (isNonEmptyString(question.timeSignature) && actualTimeSignature !== question.timeSignature) {
        fail(`${label} 拍号与题目元数据不一致：JSON=${display(question.timeSignature)}，MusicXML=${display(actualTimeSignature)}`);
      }
      if (/<chord\s*\/>/i.test(markup)) fail(`${label} 必须是单旋律声部，不能包含 chord 节点：${route}`);
      const logicalVoices = new Set([...markup.matchAll(/<voice>\s*([^<]+?)\s*<\/voice>/gi)].map((match) => match[1].trim()));
      if (logicalVoices.size > 1) fail(`${label} 包含多个逻辑声部：${[...logicalVoices].join("、")}`);
    }
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
  const expectedVoiceCounts = new Map();
  for (const question of questions) {
    if (!isRecord(question) || !isNonEmptyString(question.id) || !isRecord(question.voices)) continue;
    const voiceOrder = Array.isArray(question.voiceOrder) ? question.voiceOrder : Object.keys(question.voices);
    const candidates = voiceOrder.map((voice) => question.voices[voice]);
    if (candidates.some((items) => !Array.isArray(items))) continue;
    const collect = (voiceIndex, selected) => {
      if (voiceIndex === candidates.length) {
        if (selected.some((candidate) => !isRecord(candidate) || !isNonEmptyString(candidate.id))) return;
        const filePath = path.join(GENERATED_SCORES_DIR, question.id, `${selected.map((candidate) => candidate.id).join("--")}.svg`);
        expected.add(filePath);
        expectedVoiceCounts.set(filePath, voiceOrder.length);
        return;
      }
      for (const candidate of candidates[voiceIndex]) collect(voiceIndex + 1, [...selected, candidate]);
    };
    collect(0, []);
  }

  let verified = 0;
  for (const filePath of expected) {
    try {
      const markup = fs.readFileSync(filePath, "utf8");
      if (!/<svg(?:\s|>)/i.test(markup)) {
        fail(`预生成乐谱不是有效 SVG：${path.relative(ROOT, filePath)}`);
      } else if ((markup.match(/class="clef"/g) || []).length < (expectedVoiceCounts.get(filePath) || 0)) {
        fail(`预生成乐谱缺少声部谱号：${path.relative(ROOT, filePath)}`);
      } else verified += 1;
    } catch {
      fail(`缺少预生成乐谱：${path.relative(ROOT, filePath)}`);
    }
  }
  const actual = new Set();
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && entry.name.endsWith(".svg")) actual.add(filePath);
    }
  };
  visit(GENERATED_SCORES_DIR);
  for (const filePath of actual) {
    if (!expected.has(filePath)) fail(`存在未被题库引用的 SVG：${path.relative(ROOT, filePath)}`);
  }
  return { expected: expected.size, verified, actual: actual.size };
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

if (questions.length !== EXPECTED_QUESTIONS) fail(`题目数应为 ${EXPECTED_QUESTIONS}，当前为 ${questions.length}`);
for (const [genre, expected] of Object.entries(EXPECTED_GENRES)) {
  const actual = questions.filter((question) => question?.genre === genre).length;
  if (actual !== expected) fail(`${genre} 题目数应为 ${expected}，当前为 ${actual}`);
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

for (const question of questions) {
  if (!isRecord(question) || !isNonEmptyString(question.id)) continue;
  const questionId = question.id;
  const voices = question.voices;
  const voiceOrder = question.voiceOrder;
  if (!isNonEmptyString(question.genre)) {
    fail(`${questionId}.genre 必须是非空字符串`);
  }
  if (!Array.isArray(voiceOrder) || voiceOrder.length < 2 || voiceOrder.some((voice) => !isNonEmptyString(voice))) {
    fail(`${questionId}.voiceOrder 必须是至少包含两个有效声部的数组`);
    continue;
  }
  if (new Set(voiceOrder).size !== voiceOrder.length) fail(`${questionId}.voiceOrder 不得包含重复声部`);
  if (question.voiceCount !== voiceOrder.length) {
    fail(`${questionId}.voiceCount 必须为 voiceOrder.length（${voiceOrder.length}），当前为 ${display(question.voiceCount)}`);
  }
  if (!isNonEmptyString(question.keySignature)) {
    fail(`${questionId}.keySignature 必须是非空字符串`);
  }
  if (!isRecord(question.clefs)) {
    fail(`${questionId}.clefs 必须是包含各声部谱号的对象`);
  } else {
    for (const voice of voiceOrder) {
      if (!isNonEmptyString(question.clefs[voice])) {
        fail(`${questionId}.clefs.${voice} 必须是非空字符串`);
      }
    }
  }
  if (!isRecord(voices)) {
    fail(`${questionId}.voices 必须是包含 voiceOrder 中各声部的对象`);
    continue;
  }

  const voiceKeys = Object.keys(voices);
  for (const voice of voiceOrder) {
    if (!(voice in voices)) fail(`${questionId}.voices 缺少 ${voice} 声部`);
  }
  for (const voice of voiceKeys) {
    if (!voiceOrder.includes(voice)) fail(`${questionId}.voices 包含非预期声部：${voice}`);
  }

  for (const voice of voiceOrder) {
    const candidates = voices[voice];
    if (!Array.isArray(candidates)) {
      fail(`${questionId}/${voice} 必须是变体数组`);
      continue;
    }
    if (candidates.length !== 3) {
      fail(`${questionId}/${voice} 必须有三个候选项，当前为 ${candidates.length}`);
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

      verifyAsset({ question, questionId, voice, variant, candidate, field: "audio", extension: "mp3" });
      verifyAsset({ question, questionId, voice, variant, candidate, field: "audioFallback", extension: "wav" });
      verifyAsset({ question, questionId, voice, variant, candidate, field: "score", extension: "musicxml" });
    }

    if (decoyTypes.length === candidates.length - 1) {
      const expectedDecoys = candidates.length === 3 ? DECOY_TYPES.slice(0, 2) : DECOY_TYPES;
      for (const decoyType of expectedDecoys) {
        const count = decoyTypes.filter((type) => type === decoyType).length;
        if (count !== 1) {
          fail(`${questionId}/${voice} 的干扰项必须各含一个 ${decoyType} decoyType，当前为 ${count} 个`);
        }
      }
      for (const decoyType of DECOY_TYPES.filter((type) => !expectedDecoys.includes(type))) {
        if (decoyTypes.includes(decoyType)) fail(`${questionId}/${voice} 三选项题不应包含 ${decoyType} decoyType`);
      }
    }
  }
}

const musicAssets = collectMusicAssets();
const generatedScores = verifyGeneratedScores(questions);
const candidateCounts = questions.flatMap((question) => (question.voiceOrder || []).map((voice) => question?.voices?.[voice]?.length || 0));
const dynamicExpectedAssets = candidateCounts.reduce((total, count) => total + count, 0);
const combinations = questions.reduce(
  (total, question) => total + (question.voiceOrder || []).reduce((product, voice) => product * (question.voices?.[voice]?.length || 0), 1),
  0,
);
if (candidateCounts.some((count) => count !== 3)) fail("每个声部必须恰好包含三个选项");

for (const extension of ["mp3", "wav", "musicxml"]) {
  if (referenced[extension].size !== dynamicExpectedAssets) {
    fail(`题库引用的 ${extension} 资源应为 ${dynamicExpectedAssets} 个唯一文件，当前为 ${referenced[extension].size}`);
  }
  if (musicAssets[extension].size !== dynamicExpectedAssets) {
    fail(`public/music 中的 ${extension} 资源应为 ${dynamicExpectedAssets} 个，当前为 ${musicAssets[extension].size}`);
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
    combinations,
    mp3Files: musicAssets.mp3.size,
    wavFiles: musicAssets.wav.size,
    musicxmlFiles: musicAssets.musicxml.size,
    generatedScoreFiles: generatedScores.verified,
    generatedScoreFilesExpected: generatedScores.expected,
    candidateCounts: {
      three: candidateCounts.filter((count) => count === 3).length,
      four: candidateCounts.filter((count) => count === 4).length,
    },
  }, null, 2));
}
