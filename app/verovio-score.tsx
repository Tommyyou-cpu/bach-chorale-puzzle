"use client";

import { useEffect, useMemo, useState } from "react";
import { generatedScorePath, scoreSelectionFromPaths } from "./score-assets";

const FALLBACK_VOICE_NAMES = ["女高音", "女低音", "男高音", "男低音"] as const;
const FALLBACK_VOICE_CLEFS = [["G", "2"], ["G", "2"], ["F", "4"], ["F", "4"]] as const;

type VerovioToolkit = {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  renderToSVG(page: number): string;
  getPageCount(): number;
  destroy(): void;
};

type VerovioScoreProps = {
  paths: string[];
  title: string;
  /** 题库题目 ID；传入后可直接定位预生成组合谱。 */
  questionId?: string;
  /** 按女高音、女低音、男高音、男低音顺序排列的稳定候选项 ID。 */
  candidateIds?: readonly string[];
  /** 按 paths 顺序提供声部显示名称；赋格题不再假设 SATB。 */
  voiceLabels?: readonly string[];
  /** 按 paths 顺序提供题库谱号。 */
  clefs?: readonly string[];
};

function clefToVerovio(value: string | undefined, index: number) {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("bass") || normalized === "f" || normalized === "f4") return ["F", "4"] as const;
  if (normalized.includes("alto") || normalized.includes("c3")) return ["C", "3"] as const;
  if (normalized.includes("tenor") || normalized.includes("c4")) return ["C", "4"] as const;
  if (normalized.includes("treble-8") || normalized.includes("g-8") || normalized.includes("g8")) return ["G", "2"] as const;
  if (normalized.includes("treble") || normalized === "g" || normalized === "g2") return ["G", "2"] as const;
  return FALLBACK_VOICE_CLEFS[index] ?? ["G", "2"] as const;
}

function resolveAsset(path: string) {
  return new URL(path.replace(/^\//, ""), document.baseURI).toString();
}

function isMobileScore() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 900px)").matches || window.matchMedia("(pointer: coarse)").matches;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function combineParts(
  paths: readonly string[],
  signal?: AbortSignal,
  voiceLabels: readonly string[] = [],
  clefs: readonly string[] = [],
) {
  const texts = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(resolveAsset(path), signal ? { signal } : undefined);
      if (!response.ok) throw new Error(`MusicXML（音乐交换格式）加载失败（HTTP ${response.status}）`);
      return response.text();
    }),
  );

  const parser = new DOMParser();
  const docs = texts.map((text) => parser.parseFromString(text, "application/xml"));
  const output = docs[0].cloneNode(true) as XMLDocument;
  const root = output.documentElement;
  root.querySelectorAll("part").forEach((node) => node.remove());

  const list = root.querySelector("part-list");
  if (!list) throw new Error("MusicXML 缺少 part-list（声部列表）");
  list.querySelectorAll("score-part").forEach((node) => node.remove());

  docs.forEach((doc, index) => {
    const scorePart = doc.querySelector("score-part");
    const part = doc.querySelector("part");
    if (!scorePart || !part) throw new Error("MusicXML 缺少声部数据");

    const id = `P${index + 1}`;
    const [sign, line] = clefToVerovio(clefs[index], index);
    scorePart.setAttribute("id", id);
    const partName = scorePart.querySelector("part-name");
    if (partName) partName.textContent = voiceLabels[index] || FALLBACK_VOICE_NAMES[index] || `声部 ${index + 1}`;
    part.setAttribute("id", id);

    part.querySelectorAll("clef").forEach((node) => node.remove());
    let attributes = part.querySelector("attributes");
    if (!attributes) {
      attributes = doc.createElement("attributes");
      part.insertBefore(attributes, part.firstChild);
    }
    const clef = doc.createElement("clef");
    const signNode = doc.createElement("sign");
    const lineNode = doc.createElement("line");
    signNode.textContent = sign;
    lineNode.textContent = line;
    clef.appendChild(signNode);
    clef.appendChild(lineNode);
    attributes.appendChild(clef);

    list.appendChild(output.importNode(scorePart, true));
    root.appendChild(output.importNode(part, true));
  });

  return new XMLSerializer().serializeToString(output);
}

async function fetchStaticScore(path: string, signal?: AbortSignal) {
  const response = await fetch(
    resolveAsset(path),
    signal ? { signal, cache: "force-cache" } : { cache: "force-cache" },
  );
  if (!response.ok) throw new Error(`静态 SVG（可缩放矢量图）加载失败（HTTP ${response.status}）`);
  const markup = await response.text();
  if (!/<svg(?:\s|>)/i.test(markup)) throw new Error("静态 SVG 内容无效");
  return markup;
}

async function renderDynamicScore(
  paths: readonly string[],
  signal?: AbortSignal,
  voiceLabels: readonly string[] = [],
  clefs: readonly string[] = [],
) {
  // 只在没有预生成组合谱、且用户打开揭晓页时加载。远程 ESM（ECMAScript 模块）
  // 导入留在浏览器运行时，避免 Next.js 静态构建解析 Verovio 中仅供 Node.js 使用的分支。
  const externalImport = (url: string) => import(/* webpackIgnore: true */ url) as Promise<Record<string, unknown>>;
  const verovioBase = "https://cdn.jsdelivr.net/npm/verovio@6.2.0/dist";
  const [wasm, esm, xml] = await Promise.all([
    externalImport(`${verovioBase}/verovio-module.mjs`),
    externalImport(`${verovioBase}/verovio.mjs`),
    combineParts(paths, signal, voiceLabels, clefs),
  ]);
  const createModule = wasm.default as () => Promise<unknown>;
  const Toolkit = esm.VerovioToolkit as new (module: unknown) => VerovioToolkit;
  if (typeof createModule !== "function" || typeof Toolkit !== "function") throw new Error("Verovio 动态模块加载失败");
  const verovioModule = await createModule();
  const toolkit = new Toolkit(verovioModule);
  try {
    toolkit.setOptions({
      scale: 36,
      pageWidth: 2200,
      pageHeight: 1450,
      adjustPageHeight: true,
      breaks: "auto",
      footer: "none",
      header: "none",
    });
    if (!toolkit.loadData(xml)) throw new Error("MusicXML 数据无法生成乐谱");

    let pages = "";
    for (let page = 1; page <= toolkit.getPageCount(); page += 1) pages += toolkit.renderToSVG(page);
    if (!pages) throw new Error("没有生成乐谱页面");
    return pages;
  } finally {
    toolkit.destroy();
  }
}

function scoreSelection(
  questionId: string | undefined,
  candidateIds: readonly string[] | undefined,
  paths: readonly string[],
) {
  const inferred = scoreSelectionFromPaths(paths);
  const resolvedQuestionId = questionId || inferred?.questionId;
  // Worker（边缘函数）会为公开题目的选项生成一次性 ID；MusicXML 路径仍保留构建阶段
  // 的稳定候选 ID，因此静态组合谱优先从资源路径恢复候选 ID。
  const resolvedCandidateIds = inferred?.candidateIds || (candidateIds?.length === paths.length ? [...candidateIds] : undefined);
  if (!resolvedQuestionId || !resolvedCandidateIds) return null;
  return { questionId: resolvedQuestionId, candidateIds: resolvedCandidateIds };
}

export function VerovioScore({ paths, title, questionId, candidateIds, voiceLabels = [], clefs = [] }: VerovioScoreProps) {
  const pathsKey = paths.join("|");
  const candidateIdsKey = candidateIds?.join("|") || "";
  // 数组由页面渲染时重新创建；只在实际资源键变化时替换稳定副本。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePaths = useMemo(() => paths.slice(), [pathsKey]);
  const selection = useMemo(
    () => scoreSelection(questionId, candidateIds, stablePaths),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidateIdsKey, questionId, stablePaths],
  );
  const staticPath = selection ? generatedScorePath(selection.questionId, selection.candidateIds) : null;
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    queueMicrotask(() => {
      if (!cancelled) {
        setSvg("");
        setError("");
        setLoading(true);
      }
    });

    const load = async () => {
      if (isMobileScore()) {
        if (!staticPath) {
          if (!cancelled) {
            setError("静态乐谱加载失败：当前组合缺少稳定资源 ID");
            setLoading(false);
          }
          return;
        }
        try {
          const markup = await fetchStaticScore(staticPath, controller?.signal);
          if (!cancelled) {
            setSvg(markup);
            setLoading(false);
          }
        } catch (staticError) {
          if (!cancelled) {
            console.error("静态乐谱加载失败", staticError);
            setError(`静态乐谱加载失败：${getErrorMessage(staticError, "资源读取失败")}`);
            setLoading(false);
          }
        }
        return;
      }

      try {
        const markup = await renderDynamicScore(stablePaths, controller?.signal, voiceLabels, clefs);
        if (!cancelled) {
          setSvg(markup);
          setLoading(false);
        }
        return;
      } catch (dynamicError) {
        if (cancelled) return;
        console.error("动态乐谱雕刻失败", dynamicError);
        if (!staticPath) {
          setError(`动态乐谱雕刻失败：${getErrorMessage(dynamicError, "乐谱渲染失败")}`);
          setLoading(false);
          return;
        }
        try {
          const markup = await fetchStaticScore(staticPath, controller?.signal);
          if (!cancelled) {
            setSvg(markup);
            setLoading(false);
          }
        } catch (staticError) {
          if (!cancelled) {
            console.error("静态乐谱回退失败", staticError);
            setError(
              `动态乐谱雕刻失败：${getErrorMessage(dynamicError, "乐谱渲染失败")}；静态乐谱加载失败：${getErrorMessage(staticError, "资源读取失败")}`,
            );
            setLoading(false);
          }
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [clefs, pathsKey, retry, stablePaths, staticPath, voiceLabels]);

  const downloadLinks = paths.map((path, index) => (
    <a key={path} href={resolveAsset(path)} download>
      下载{voiceLabels[index] || FALLBACK_VOICE_NAMES[index] || `声部 ${index + 1}`} MusicXML
    </a>
  ));

  return (
    <div className="score-wrap" aria-label={`${title}五线谱`}>
      {error ? (
        <>
          <p className="score-status" role="alert">{error}</p>
          <div className="score-actions">
            <button type="button" onClick={() => setRetry((value) => value + 1)}>重新加载乐谱</button>
            {downloadLinks}
          </div>
        </>
      ) : loading ? (
        <p className="score-status" aria-live="polite">正在雕刻乐谱……</p>
      ) : (
        <div className="score-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}
