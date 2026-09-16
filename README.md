# 拼出巴赫

四声部圣咏盲听拼图。每题从女高音、女低音、男高音、男低音的四个候选中各选一条，找出真正的巴赫组合。

制作：田清新。

## 本地运行

```bash
npm install
npm run dev
```

## 验证与构建

```bash
node scripts/validate_questions.mjs
npm run build
```

题库与音频可通过下列命令重新生成：

```bash
python3 scripts/generate_music_assets.py
```

素材、许可与生成方法见 [SOURCES.md](./SOURCES.md)，自动检查记录见 [MUSIC_VALIDATION.md](./MUSIC_VALIDATION.md)。

## GitHub Pages

`.github/workflows/deploy.yml` 会根据仓库名自动设置子路径。在 GitHub 仓库的 **Settings → Pages** 中选择 **GitHub Actions** 为发布来源，推送 `main` 分支后即可发布。
