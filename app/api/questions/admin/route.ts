import {
  authoriseQuestionAdmin,
  adminConfigurationNote,
} from "../../../../lib/server/question-admin";
import {
  createQuestion,
  databaseUnavailableMessage,
  listQuestions,
} from "../../../../lib/server/question-store";
import { parseQuestionInput } from "../../../../lib/server/question-validation";

function authError(result: Awaited<ReturnType<typeof authoriseQuestionAdmin>>) {
  if (result.ok) return null;
  return Response.json({ error: result.error }, { status: result.status });
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("请求体必须是合法的 JSON");
  }
}

function isDuplicateError(error: unknown) {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return message.includes("UNIQUE constraint") || message.includes("PRIMARY KEY");
}

/** 管理端列表包含停用题目，公开接口仍只返回启用题目。 */
export async function GET() {
  const auth = await authoriseQuestionAdmin();
  const denied = authError(auth);
  if (denied) return denied;

  const result = await listQuestions(true);
  return Response.json({
    questions: result.questions,
    count: result.questions.length,
    storage: result.storage,
    configuration: adminConfigurationNote(),
    ...(result.warning ? { warning: result.warning } : {}),
  });
}

export async function POST(request: Request) {
  const auth = await authoriseQuestionAdmin();
  const denied = authError(auth);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await requestBody(request);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "请求体格式错误" }, { status: 400 });
  }

  const parsed = parseQuestionInput(body);
  if (!parsed.success) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const question = await createQuestion(parsed.data);
    return Response.json({ question }, { status: 201 });
  } catch (error) {
    if (isDuplicateError(error)) {
      return Response.json({ error: `题目 ID 已存在：${parsed.data.id}` }, { status: 409 });
    }
    return Response.json({ error: databaseUnavailableMessage(error) }, { status: 503 });
  }
}
