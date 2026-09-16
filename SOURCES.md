# 素材来源

## 巴赫圣咏

- Johann Sebastian Bach, `BWV 66.6`, 第 1–4 小节。
- Johann Sebastian Bach, `BWV 140.7`, *Gloria sei dir gesungen*，第 1–4 小节。
- Johann Sebastian Bach, `BWV 244.54`, *O Haupt voll Blut und Wunden*，第 1–4 小节。

三份编码均由 `music21` 参考语料库提供：<https://www.music21.org/music21docs/about/referenceCorpus.html>。巴赫原作已进入公共领域；本项目没有复制现代商业录音，48 条 WAV 音轨均由 `scripts/generate_music_assets.py` 以同一合成钢琴音色本地渲染。

## 干扰声部

每条原作声部对应三个局部重塑版本。重塑保留每一时点的音高类，通过局部八度折叠改变声部线条与音区。因此，每题 256 种组合均保留巴赫原作的垂直音高类。自动检查只能证明这一结构约束，不代表全部组合经过了人工审美判定。

## 谱面引擎

揭晓页使用 Verovio 6.2.0 渲染 MusicXML。本机源码位于用户提供的 `Verovio仓库/verovio-develop`，产品构建使用对应的 npm 浏览器发布包。Verovio 采用 LGPL-3.0-or-later 许可证：<https://www.verovio.org/>。
