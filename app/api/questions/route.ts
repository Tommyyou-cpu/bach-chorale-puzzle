import { listQuestions } from "../../../lib/server/question-store";
import { toPublicQuestion } from "../../../lib/server/question-validation";

function positiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function sample<T>(items: T[], count: number) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result.slice(0, count);
}

/**
 * 公开题库接口。默认按后台排序返回所有启用题目，?sample=3 可随机抽取 3 题，
 * 便于客户端只为本轮挑战加载抽中的资源。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedSample = positiveInteger(url.searchParams.get("sample"));
  const requestedLimit = positiveInteger(url.searchParams.get("limit"));
  const result = await listQuestions(false);
  const selected = requestedSample
    ? sample(result.questions, Math.min(requestedSample, result.questions.length))
    : requestedLimit
      ? result.questions.slice(0, Math.min(requestedLimit, result.questions.length))
      : result.questions;

  return Response.json(
    {
      questions: selected.map(toPublicQuestion),
      count: selected.length,
      sampled: Boolean(requestedSample),
      storage: result.storage,
      ...(result.warning ? { warning: result.warning } : {}),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
