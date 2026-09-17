import { fileURLToPath } from "node:url";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");

// 保留一个稳定的脚本入口，供本地工具或旧工作流调用；实际构建统一使用
// Next.js（Next.js）原生静态导出，产物位于 out/。
const cli = new URL("../node_modules/next/dist/bin/next", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command, ...args];
await import(cli.href);
