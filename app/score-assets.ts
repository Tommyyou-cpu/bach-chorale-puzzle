/**
 * 预生成乐谱资源的路径协议。
 *
 * 这个文件同时被乐谱组件和页面使用，确保浏览器端不会自行拼出与构建脚本
 * 不一致的文件名。候选项 ID 只能包含路径安全字符；不同候选项之间使用双
 * 连字符分隔，避免 ID 本身包含单个连字符时产生歧义。
 */

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
export const MIN_SCORE_VOICES = 3;
export const MAX_SCORE_VOICES = 4;
export const GENERATED_SCORE_ROOT = "/generated-scores";

export type ScoreSelection = {
  questionId: string;
  candidateIds: string[];
};

function isSafeId(value: string) {
  return SAFE_ID.test(value);
}

function hasSupportedVoiceCount(count: number) {
  return count >= MIN_SCORE_VOICES && count <= MAX_SCORE_VOICES;
}

/** 返回构建阶段生成的三或四声部组合谱 SVG（可缩放矢量图）路径。 */
export function generatedScorePath(questionId: string, candidateIds: readonly string[]) {
  if (!isSafeId(questionId) || !hasSupportedVoiceCount(candidateIds.length) || candidateIds.some((id) => !isSafeId(id))) {
    return null;
  }

  return `${GENERATED_SCORE_ROOT}/${encodeURIComponent(questionId)}/${candidateIds.map((id) => encodeURIComponent(id)).join("--")}.svg`;
}

/**
 * 从旧版组件仍然传入的 MusicXML（音乐交换格式）路径中恢复静态资源键。
 * 这样页面在逐步切换到显式 questionId/candidateIds props 时仍可安全回退。
 */
export function scoreSelectionFromPaths(paths: readonly string[]): ScoreSelection | null {
  if (!hasSupportedVoiceCount(paths.length)) return null;

  const entries = paths.map((path) => {
    try {
      const url = new URL(path, "https://score-assets.invalid/");
      const match = url.pathname.match(/\/music\/([^/]+)\/([^/]+)\.musicxml$/);
      if (!match) return null;
      const [, questionId, candidateId] = match;
      const decodedQuestionId = decodeURIComponent(questionId);
      const decodedCandidateId = decodeURIComponent(candidateId);
      if (!isSafeId(decodedQuestionId) || !isSafeId(decodedCandidateId)) return null;
      return { questionId: decodedQuestionId, candidateId: decodedCandidateId };
    } catch {
      return null;
    }
  });

  if (entries.some((entry) => entry === null)) return null;
  const resolved = entries as Array<{ questionId: string; candidateId: string }>;
  const questionId = resolved[0].questionId;
  if (resolved.some((entry) => entry.questionId !== questionId)) return null;

  return { questionId, candidateIds: resolved.map((entry) => entry.candidateId) };
}
