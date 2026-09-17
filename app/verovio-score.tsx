"use client";

import { useEffect, useMemo, useState } from "react";
import { generatedScorePath, scoreSelectionFromPaths } from "./score-assets";

const VOICE_NAMES = ["女高音", "女低音", "男高音", "男低音"] as const;
const VOICE_CLEFS = [["G", "2"], ["G", "2"], ["F", "4"], ["F", "4"]] as const;

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
};

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

async function combineParts(paths: readonly string[], signal?: AbortSignal) {
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
    const [sign, line] = VOICE_CLEFS[index];
    scorePart.setAttribute("id", id);
    const partName = scorePart.querySelector("part-name");
    if (partName) partName.textContent = VOICE_NAMES[index];
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

async function renderDynamicScore(paths: readonly string[], signal?: AbortSignal) {
  // 只在桌面路径执行动态导入；移动端不会请求 Verovio 的 WebAssembly（网页汇编）模块。
  const [wasm, esm, xml] = await Promise.all([
    import("verovio/wasm"),
    import("verovio/esm"),
    combineParts(paths, signal),
  ]);
  const verovioModule = await wasm.default();
  const toolkit: VerovioToolkit = new esm.VerovioToolkit(verovioModule);
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
    if (!toolkit.loadData(xml)) throw new Error("MusicXML 数据无法交给 Verovio 雕刻");

    let pages = "";
    for (let page = 1; page <= toolkit.getPageCount(); page += 1) pages += toolkit.renderToSVG(page);
    if (!pages) throw new Error("Verovio 没有生成乐谱页面");
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
  const resolvedCandidateIds = candidateIds?.length === paths.length ? [...candidateIds] : inferred?.candidateIds;
  if (!resolvedQuestionId || !resolvedCandidateIds) return null;
  return { questionId: resolvedQuestionId, candidateIds: resolvedCandidateIds };
}

export function VerovioScore({ paths, title, questionId, candidateIds }: VerovioScoreProps) {
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
        const markup = await renderDynamicScore(stablePaths, controller?.signal);
        if (!cancelled) {
          setSvg(markup);
          setLoading(false);
        }
        return;
      } catch (dynamicError) {
        if (cancelled) return;
        console.error("动态乐谱雕刻失败", dynamicError);
        if (!staticPath) {
          setError(`动态乐谱雕刻失败：${getErrorMessage(dynamicError, "Verovio 渲染失败")}`);
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
              `动态乐谱雕刻失败：${getErrorMessage(dynamicError, "Verovio 渲染失败")}；静态乐谱加载失败：${getErrorMessage(staticError, "资源读取失败")}`,
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
  }, [pathsKey, retry, stablePaths, staticPath]);

  const downloadLinks = paths.map((path, index) => (
    <a key={path} href={resolveAsset(path)} download>
      下载{VOICE_NAMES[index] || "声部"} MusicXML
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
