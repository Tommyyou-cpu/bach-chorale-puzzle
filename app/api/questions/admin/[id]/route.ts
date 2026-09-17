import { authoriseQuestionAdmin } from "../../../../../lib/server/question-admin";
import {
  databaseUnavailableMessage,
  deleteQuestion,
  updateQuestion,
} from "../../../../../lib/server/question-store";
import {
  parseQuestionPatch,
  QuestionValidationError,
} from "../../../../../lib/server/question-validation";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

async function questionId(context: RouteContext) {
  const params = await context.params;
  return decodeURIComponent(params.id).trim();
}

function authError(result: Awaited<ReturnType<typeof authoriseQuestionAdmin>>) {
  if (result.ok) return null;
  return Response.json({ error: result.error }, { status: result.status });
}

async function bodyFrom(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("请求体必须是合法的 JSON");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authoriseQuestionAdmin();
  const denied = authError(auth);
  if (denied) return denied;

  const id = await questionId(context);
  if (!id) return Response.json({ error: "题目 ID 不能为空" }, { status: 400 });

  let body: unknown;
  try {
    body = await bodyFrom(request);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "请求体格式错误" }, { status: 400 });
  }

  const parsed = parseQuestionPatch(body);
  if (!parsed.success) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const question = await updateQuestion(id, parsed.data);
    if (!question) return Response.json({ error: `找不到题目：${id}` }, { status: 404 });
    return Response.json({ question });
  } catch (error) {
    if (error instanceof QuestionValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: databaseUnavailableMessage(error) }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  void request;
  const auth = await authoriseQuestionAdmin();
  const denied = authError(auth);
  if (denied) return denied;

  const id = await questionId(context);
  if (!id) return Response.json({ error: "题目 ID 不能为空" }, { status: 400 });

  try {
    const question = await deleteQuestion(id);
    if (!question) return Response.json({ error: `找不到题目：${id}` }, { status: 404 });
    return Response.json({ question });
  } catch (error) {
    return Response.json({ error: databaseUnavailableMessage(error) }, { status: 503 });
  }
}
