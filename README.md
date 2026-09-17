# 拼出巴赫

从众赞歌、赋格和三声部创意曲（Sinfonia）片段中，逐个声部听辨巴赫的原作。正式游戏由服务端抽题和判分，浏览器只加载当前这一局抽中的题目资源。

## 线上入口

- 游戏：[https://tommyyou-cpu.github.io/bach-chorale-puzzle/](https://tommyyou-cpu.github.io/bach-chorale-puzzle/)
- 管理后台：[https://tommyyou-cpu.github.io/bach-chorale-puzzle/admin/](https://tommyyou-cpu.github.io/bach-chorale-puzzle/admin/)
- Worker 接口：部署后将 `WORKER_API_URL` 写入 GitHub Actions Variables；仓库不预设无法从代码推断的 Cloudflare 域名。

GitHub Pages（GitHub 静态页面托管）只提供前端静态文件。管理员登录、题库维护、抽题和判分由 Cloudflare Worker（Cloudflare 边缘函数）处理，D1（边缘数据库）保存题库与会话。当前生产部署不启用 R2（对象存储），内置题目的音频、MusicXML（音乐交换格式）和 SVG（可缩放矢量图）随 GitHub Pages 一起发布，因此不会产生对象存储订阅费用。

## 题库与规则

构建版本固定包含 30 道题：15 道众赞歌、10 道赋格、5 道三声部 Sinfonia。默认每局抽取 3 道，分类配额为众赞歌 1 道、赋格 1 道、其他 1 道。管理后台可在分类库存满足配额时调整每局题数、分类配额和评分权重。

默认评分为：完全猜中题目的数量占 40%，所有声部选项的正确比例占 60%。规则修改后由服务端递增规则版本；进行中的旧会话仍使用创建时保存的答案和规则快照。

新增赋格和 Sinfonia 按题目实际声部数显示第一声部至第四声部。题库元数据包含声部顺序、显示名称、谱号、调号、拍号、小节范围、来源许可和各声部最长休止检查结果。正式题目的正确组合不会新增平行五度或八度，干扰组合允许有限的声部进行或和声变化。

## 本地开发

```bash
npm install
npm run dev
```

本地静态预览：

```bash
npm run build
npm run preview
```

常用检查：

```bash
npm run test
npm run typecheck
npm run lint
npm run validate
```

`npm run build` 会生成移动端优先的 MP3、所有题目候选组合的预生成 SVG（可缩放矢量图），然后通过 Next.js（Next.js 前端框架）的 `output: export` 输出 `out/`。GitHub Pages 发布 `out/`，管理页面对应 `out/admin/`。

素材、来源许可、窗口选择和音乐检查记录见 [SOURCES.md](./SOURCES.md) 与 [MUSIC_VALIDATION.md](./MUSIC_VALIDATION.md)。

## Cloudflare 初始化

首次部署前，在 Cloudflare 创建一个 D1 数据库。Worker 配置只绑定 D1，静态题目资源由仓库和 GitHub Pages 管理：

```bash
npx wrangler d1 create bach-chorale-puzzle
```

将 D1 返回的真实 `database_id` 写入部署环境的 `CLOUDFLARE_D1_DATABASE_ID`。Worker 的迁移位于 [worker/migrations](./worker/migrations)，GitHub Actions 会在部署 Worker 前运行远程 D1 迁移，随后部署 Worker 和健康检查。

生产 Worker 需要以下 GitHub Secrets（GitHub 加密变量）：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_D1_DATABASE_ID`
- `ADMIN_BOOTSTRAP_USERNAME`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `SESSION_SECRET`

其中管理员初始用户名按项目约定设置为 `Tommy-yjx`；初始密码只通过 `ADMIN_BOOTSTRAP_PASSWORD` Secret 注入 Worker，不写入仓库、前端代码、静态产物或迁移文件。第一次登录后可在后台的“规则与权重”页面修改密码，系统只保存带随机盐的密码哈希（密码散列）。

生产前端需要在 GitHub Actions Variables（GitHub Actions 配置变量）中设置：

- `WORKER_API_URL`：Worker 根地址，例如 `https://bach-chorale-puzzle-api.example.workers.dev`，不要带末尾 `/api`。
- `NEXT_PUBLIC_API_BASE_URL`：通常与 `WORKER_API_URL` 相同；工作流会把它传给静态构建。

上述 Cloudflare 账号、真实 D1 `database_id`、Worker 域名和 GitHub Secret 均无法从仓库内容安全推断，缺少任一项时工作流会在部署前明确失败。当前工作流不读取、不要求 `CLOUDFLARE_R2_BUCKET_NAME`，也不会创建或使用 R2 资源。

## GitHub Actions 发布顺序

`.github/workflows/deploy.yml` 使用同一仓库完成发布，顺序为：

1. 安装依赖，运行测试、类型检查和代码检查。
2. 应用远程 D1 迁移。
3. 部署 Cloudflare Worker。
4. 调用 Worker 健康检查，并验证默认规则和 30 道题库存。
5. 构建 Next.js 静态页面，检查 `out/index.html` 与 `out/admin/index.html`。
6. 动态核对 30 道题及其音频、MusicXML 和预生成 SVG 资源。
7. 将 `out/` 发布到 GitHub Pages。

在仓库的 **Settings → Pages** 中选择 **GitHub Actions** 作为发布来源。推送 `main` 或手动运行工作流即可发布。

## 管理后台

打开管理入口后使用 `ADMIN_BOOTSTRAP_USERNAME` 与 `ADMIN_BOOTSTRAP_PASSWORD` 登录。令牌（token）只保存在当前浏览器会话，并通过 `Authorization` 请求头发送。

后台包含四个主要工具：

- 题库：查看启用和停用题目、全部声部候选、正确答案和干扰说明，支持创建、编辑、排序、启停、删除。
- 规则与权重：调整每局题数、三类配额和两个评分权重，保存前检查库存与权重总和。
- 模拟抽取：用当前规则和可选随机种子检查分类分配。
- 模拟答题：复用正式页面的试听、两声部起播、静音、视觉进度条、提交和评分结果。

资源管理：当前部署不提供上传和删除对象接口。后台的“资源管理”页会明确提示这一点；新增或替换 MP3、WAV、MusicXML 和 SVG 时，应将文件提交到仓库静态资源目录，更新题目资源路径后重新运行 GitHub Actions。Worker 的资源接口在未绑定对象存储时统一返回 503 和静态资源说明，避免误以为资源已写入云端。

## 接口概览

公开接口只返回当前游戏会话的候选资源，不返回正确答案或 `isOriginal`：

- `POST /api/game/sessions`
- `POST /api/game/sessions/:id/submit`
- `GET /api/health`

管理员接口需要有效令牌，包括 `/api/auth/*`、`/api/admin/questions`、`/api/admin/settings`、`/api/admin/simulation/*` 和 `/api/admin/assets/*`。正式判分使用创建会话时的答案与规则快照，后台改题不会改变已经开始的游戏。
