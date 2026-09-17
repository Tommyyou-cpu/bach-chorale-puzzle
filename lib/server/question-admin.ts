import { env } from "cloudflare:workers";
import { getChatGPTUser, type ChatGPTUser } from "../../app/chatgpt-auth";

type RuntimeValues = Record<string, unknown>;

export type AdminAuthorisation =
  | { ok: true; user: ChatGPTUser }
  | { ok: false; status: 401 | 403; error: string };

function runtimeValue(name: string): string | undefined {
  try {
    const value = (env as unknown as RuntimeValues)[name];
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    // 本地静态构建阶段可能没有 Cloudflare 运行时环境。
  }

  if (typeof process !== "undefined") {
    const value = process.env[name];
    if (value?.trim()) return value;
  }
  return undefined;
}

function administratorEmails() {
  const configured =
    runtimeValue("QUESTION_ADMIN_EMAILS") ??
    runtimeValue("ADMIN_EMAILS") ??
    runtimeValue("ADMIN_EMAIL");

  return (configured ?? "")
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function authoriseQuestionAdmin(): Promise<AdminAuthorisation> {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "请先使用 ChatGPT 登录后再管理题库。",
    };
  }

  const allowlist = administratorEmails();
  if (allowlist.length > 0 && !allowlist.includes(user.email.trim().toLowerCase())) {
    return {
      ok: false,
      status: 403,
      error: "当前登录账号没有题库管理权限。",
    };
  }

  return { ok: true, user };
}

export function adminConfigurationNote() {
  return administratorEmails().length > 0
    ? "管理权限由环境变量 QUESTION_ADMIN_EMAILS 控制。"
    : "当前未设置管理员邮箱白名单；所有已登录的 ChatGPT 用户可管理题库。生产环境建议设置 QUESTION_ADMIN_EMAILS。";
}
