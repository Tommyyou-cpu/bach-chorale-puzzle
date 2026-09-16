#!/usr/bin/env node

/**
 * 在构建阶段将四个独立声部的 MusicXML（音乐交换格式）雕刻为静态 SVG。
 *
 * 每道题有 4^4 个组合，三道题共 768 个文件。脚本只写入
 * public/generated-scores，不改写题库或原始 MusicXML；重复执行会得到同一
 * 组路径和相同的 SVG 内容。
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { optimize } from "svgo";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUESTIONS_PATH = path.join(ROOT, "app", "questions.generated.json");
const MUSIC_ROOT = path.join(ROOT, "public", "music");
const OUTPUT_ROOT = path.join(ROOT, "public", "generated-scores");
const VOICES = ["soprano", "alto", "tenor", "bass"];
const VOICE_NAMES = ["女高音", "女低音", "男高音", "男低音"];
const VOICE_CLEFS = [["G", "2"], ["G", "2"], ["F", "4"], ["F", "4"]];
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const VARIANTS = 4;

function assertSafeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${label} 含有不安全的资源 ID：${String(value)}`);
  }
}

function scorePath(questionId, candidateIds) {
  assertSafeId(questionId, "题目");
  if (!Array.isArray(candidateIds) || candidateIds.length !== VOICES.length) {
    throw new Error(`${questionId} 的候选项数量不是四个`);
  }
  candidateIds.forEach((id) => assertSafeId(id, "候选项"));
  return path.join(OUTPUT_ROOT, questionId, `${candidateIds.join("--")}.svg`);
}

function resourcePath(score) {
  if (typeof score !== "string" || !score.startsWith("/music/")) {
    throw new Error(`非法 MusicXML 资源路径：${String(score)}`);
  }
  const resolved = path.resolve(ROOT, "public", score.slice(1));
  if (resolved !== path.resolve(MUSIC_ROOT) && !resolved.startsWith(`${path.resolve(MUSIC_ROOT)}${path.sep}`)) {
    throw new Error(`MusicXML 路径越出 public/music：${score}`);
  }
  return resolved;
}

function parseXml(xml, filePath) {
  const errors = [];
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") errors.push(message);
    },
  }).parseFromString(xml, "application/xml");
  if (errors.length || !document.documentElement || document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`无法解析 MusicXML：${filePath}`);
  }
  return document;
}

function replaceId(node, id) {
  node.setAttribute("id", id);
}

function createClef(document, sign, line) {
  const clef = document.createElement("clef");
  const signNode = document.createElement("sign");
  const lineNode = document.createElement("line");
  signNode.appendChild(document.createTextNode(sign));
  lineNode.appendChild(document.createTextNode(line));
  clef.appendChild(signNode);
  clef.appendChild(lineNode);
  return clef;
}

function normalizePart(document, index) {
  const scorePart = document.getElementsByTagName("score-part")[0];
  const part = document.getElementsByTagName("part")[0];
  if (!scorePart || !part) throw new Error("MusicXML 缺少 score-part 或 part");

  const id = `P${index + 1}`;
  const partName = scorePart.getElementsByTagName("part-name")[0];
  replaceId(scorePart, id);
  if (partName) {
    while (partName.firstChild) partName.removeChild(partName.firstChild);
    partName.appendChild(document.createTextNode(VOICE_NAMES[index]));
  }
  replaceId(part, id);

  const existingClefs = part.getElementsByTagName("clef");
  // getElementsByTagName 返回实时列表，反向删除可避免跳过节点。
  for (let item = existingClefs.length - 1; item >= 0; item -= 1) {
    existingClefs[item].parentNode?.removeChild(existingClefs[item]);
  }

  let attributes = part.getElementsByTagName("attributes")[0];
  if (!attributes) {
    attributes = document.createElement("attributes");
    part.insertBefore(attributes, part.firstChild);
  }
  const [sign, line] = VOICE_CLEFS[index];
  attributes.appendChild(createClef(document, sign, line));
  return { scorePart, part };
}

function combineParts(documents) {
  const output = documents[0].cloneNode(true);
  const root = output.documentElement;
  const partList = root.getElementsByTagName("part-list")[0];
  if (!partList) throw new Error("MusicXML 缺少 part-list");

  const oldParts = root.getElementsByTagName("part");
  for (let index = oldParts.length - 1; index >= 0; index -= 1) {
    oldParts[index].parentNode?.removeChild(oldParts[index]);
  }
  while (partList.firstChild) partList.removeChild(partList.firstChild);

  documents.forEach((document, index) => {
    const { scorePart, part } = normalizePart(document, index);
    partList.appendChild(output.importNode(scorePart, true));
    root.appendChild(output.importNode(part, true));
  });

  return new XMLSerializer().serializeToString(output);
}

function minifySvg(markup) {
  const withViewBox = markup.replace(/<svg\b([^>]*)>/i, (full, attributes) => {
    if (/\bviewBox\s*=\s*["']/i.test(attributes)) return full;
    const width = attributes.match(/\bwidth\s*=\s*["']([0-9.]+)(?:px)?["']/i);
    const height = attributes.match(/\bheight\s*=\s*["']([0-9.]+)(?:px)?["']/i);
    if (!width || !height) return full;
    return `<svg${attributes} viewBox="0 0 ${width[1]} ${height[1]}">`;
  });
  const result = optimize(withViewBox, {
    multipass: true,
    // 保留 width/height 与 viewBox，浏览器可据此按乐谱真实尺寸横向滚动。
    plugins: ["preset-default"],
  });
  if ("data" in result && typeof result.data === "string" && /<svg(?:\s|>)/i.test(result.data)) {
    return result.data;
  }
  throw new Error("SVGO 未生成有效 SVG");
}

async function renderCombination(toolkit, question, candidates) {
  const paths = candidates.map((candidate) => resourcePath(candidate.score));
  const documents = await Promise.all(paths.map(async (filePath) => parseXml(await readFile(filePath, "utf8"), filePath)));
  const xml = combineParts(documents);
  if (!toolkit.loadData(xml)) throw new Error(`${question.id} 的组合无法交给 Verovio`);

  const pages = [];
  for (let page = 1; page <= toolkit.getPageCount(); page += 1) pages.push(minifySvg(toolkit.renderToSVG(page)));
  if (!pages.length) throw new Error(`${question.id} 的组合没有生成 SVG 页面`);
  return pages.join("\n");
}

async function removeStaleSvgFiles(expected) {
  async function walk(directory) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    await Promise.all(entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(filePath);
      if (entry.isFile() && entry.name.endsWith(".svg") && !expected.has(filePath)) {
        // 只清理本脚本负责的过期 SVG，保留目录中的其他文件。
        await unlink(filePath);
      }
    }));
  }
  await walk(OUTPUT_ROOT);
}

async function main() {
  const questions = JSON.parse(await readFile(QUESTIONS_PATH, "utf8"));
  if (!Array.isArray(questions) || questions.length !== 3) throw new Error("题库必须包含三道题");

  const wasm = await import("verovio/wasm");
  const esm = await import("verovio/esm");
  const verovioModule = await wasm.default();
  const toolkit = new esm.VerovioToolkit(verovioModule);
  toolkit.setOptions({
    scale: 36,
    pageWidth: 2200,
    pageHeight: 1450,
    adjustPageHeight: true,
    breaks: "auto",
    footer: "none",
    header: "none",
  });

  const expected = new Set();
  let generated = 0;
  let totalBytes = 0;
  try {
    for (const question of questions) {
      assertSafeId(question.id, "题目");
      const voiceCandidates = VOICES.map((voice) => {
        const candidates = question.voices?.[voice];
        if (!Array.isArray(candidates) || candidates.length !== VARIANTS) {
          throw new Error(`${question.id}/${voice} 必须有四个候选项`);
        }
        candidates.forEach((candidate) => {
          assertSafeId(candidate.id, "候选项");
          resourcePath(candidate.score);
        });
        return candidates;
      });

      for (let soprano = 0; soprano < VARIANTS; soprano += 1) {
        for (let alto = 0; alto < VARIANTS; alto += 1) {
          for (let tenor = 0; tenor < VARIANTS; tenor += 1) {
            for (let bass = 0; bass < VARIANTS; bass += 1) {
              const indexes = [soprano, alto, tenor, bass];
              const candidates = indexes.map((variant, index) => voiceCandidates[index][variant]);
              const candidateIds = candidates.map((candidate) => candidate.id);
              const outputPath = scorePath(question.id, candidateIds);
              expected.add(outputPath);
              await mkdir(path.dirname(outputPath), { recursive: true });
              const svg = await renderCombination(toolkit, question, candidates);
              await writeFile(outputPath, svg, "utf8");
              totalBytes += Buffer.byteLength(svg);
              generated += 1;
            }
          }
        }
      }
    }
  } finally {
    toolkit.destroy();
  }

  await removeStaleSvgFiles(expected);
  const actual = [];
  for (const question of questions) {
    const directory = path.join(OUTPUT_ROOT, question.id);
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".svg")) continue;
      const filePath = path.join(directory, file.name);
      const fileStat = await stat(filePath);
      if (fileStat.size === 0) throw new Error(`空的 SVG：${filePath}`);
      actual.push(filePath);
    }
  }
  if (actual.length !== expected.size || generated !== 768) {
    throw new Error(`SVG 数量错误：生成=${generated}，期望=${expected.size}，实际=${actual.length}`);
  }
  console.log(JSON.stringify({ questions: questions.length, combinations: generated, files: actual.length, bytes: totalBytes }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
