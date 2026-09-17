# 音乐素材生成与自动验证记录

## 范围与复现

题库包含 15 首来自 music21（音乐分析与记谱库）参考语料的 Bach 四声部圣咏，每题取连续第 1–4 小节。q1–q3 保留四个候选，q4–q15 使用三个候选。生成器会为每个候选分别写入 WAV（波形音频）与 MusicXML（音乐记谱交换格式），再由 Node 脚本编码 MP3（压缩音频）并为所有候选组合预生成 SVG（可缩放矢量乐谱）。

按以下顺序执行：

```bash
python3 scripts/generate_music_assets.py
npm run prepare:assets
npm run validate
```

本次生成结果：

```text
questions=15
tracks=192
resources=384
wav=192
musicxml=192
combinationsChecked=1740
combinationsPassed=1740
```

资源准备阶段包含：

```text
mp3Files=192
generatedScoreFiles=1740
```

题库校验器从 `app/questions.generated.json` 动态计算每题候选数量、声部候选总数和组合数，不依赖固定的 q1–q3 或每声部四选项约定。

## 题源与候选规模

| 题目 | Bach 语料 | 曲目 | 每声部候选 | 组合数 |
| --- | --- | --- | ---: | ---: |
| q1 | BWV 66.6 | Erfreut euch, ihr Herzen | 4 | 256 |
| q2 | BWV 140.7 | Gloria sei dir gesungen | 4 | 256 |
| q3 | BWV 244.54 | O Haupt voll Blut und Wunden | 4 | 256 |
| q4 | BWV 10.7 | Meine Seel erhebt den Herren | 3 | 81 |
| q5 | BWV 101.7 | Nimm von uns, Herr, du treuer Gott | 3 | 81 |
| q6 | BWV 103.6 | Ihr werdet weinen und heulen | 3 | 81 |
| q7 | BWV 104.6 | Du Hirte Israel, höre | 3 | 81 |
| q8 | BWV 122.6 | Das neugeborne Kindelein | 3 | 81 |
| q9 | BWV 123.6 | Liebster Immanuel, Herzog der Frommen | 3 | 81 |
| q10 | BWV 111.6 | Was mein Gott will, das g'scheh allzeit | 3 | 81 |
| q11 | BWV 113.8 | Lord, the God of my salvation | 3 | 81 |
| q12 | BWV 114.7 | Ach, lieben Christen, seid getrost | 3 | 81 |
| q13 | BWV 115.6 | Mache dich, mein Geist, bereit | 3 | 81 |
| q14 | BWV 116.6 | Du Friedefürst, Herr Jesu Christ | 3 | 81 |
| q15 | BWV 117.4 | Sei Lob und Ehr dem höchsten Gut | 3 | 81 |

每个声部的候选顺序保持一致：

| `variant` | `decoyType`（干扰类型） | 含义 |
| ---: | --- | --- |
| 0 | `original` | 原作音高、时值和节奏 |
| 1 | `voice-leading` | 非稳定拍的声部进行改写 |
| 2 | `harmony` | 稳定拍改写，且改变纵向音高类集合 |
| 3 | `mixed` | 同时包含声部进行和稳定拍和声改写；仅四选项题提供 |

所有候选都有独立的音频和 MusicXML 文件。三选项题并非复制音频，`voice-leading` 与 `harmony` 均至少修改一个原作音符，且资源路径、文件内容和题库元数据一一对应。

## 自动检查方法与阈值

生成器在写出资源前对每道题的全部候选组合进行穷举。四选项题检查 `4^4=256` 种组合，三选项题检查 `3^4=81` 种组合，共 `1740` 种组合，全部通过。

1. 音域：soprano（女高音）为 C4–A5，MIDI（乐器数字接口）60–81；alto（女低音）为 G3–C5，MIDI 55–72；tenor（男高音）为 C3–A4，MIDI 48–69；bass（男低音）为 D2–E4，MIDI 38–64。
2. 声部关系：相对原作，不允许新增声部交叉、越位或同音。
3. 和声变化有效性：每条 `harmony` 候选必须在指定稳定拍改变四声部纵向音高类集合。
4. 稳定拍不协和：每两拍检查一次共同持续至少半拍的稳定拍不协和，不得超过原作基线例外。
5. 平行纯音程：原作全组合不得新增同向纯五度或纯八度；含干扰项的组合按相对原作基线统计新增事件，并执行下方分离窗口阈值。
6. 干扰语义：所有非原作 mutation（音符改写）的 `abs(new-old)` 均不等于 12，禁止用纯八度折叠冒充新候选。`harmony` 必须改变稳定拍的纵向 pitch-class（音级类）集合；`voice-leading` 只能改写非稳定位置，且保持所有稳定拍的和弦骨架不变，同时在改写位置产生可观测的声部关系变化；`mixed` 同时包含两类改写。
7. 平行纯五/八度：原作已有事件先记录为 `originalBaselineEvents`，不计为新增错误。原作全组合必须保持该基线；含干扰项的组合只统计相对基线的 `decoyAddedEvents`，每个四小节组合最多允许 2 处新增事件，且两处必须相隔至少 2 个小节（任意连续 2 小节窗口至多 1 处），禁止连续链式出现。
8. 记谱上下文：每条 MusicXML 均必须包含原作调号，并按声部写入正确谱号；常规女高音/女低音为 G2（高音谱号），男低音为 F4（低音谱号），男高音保留原作 F4 或 G2 低八度谱号。题目 JSON 同步记录 `genre`、`voiceCount`、`clefs`、`keySignature`；校验器逐个候选反查 MusicXML 的调号升降号数量与谱号标识。SVG 生成器会在交给 Verovio（乐谱渲染器）前逐个检查调号与谱号，输出后检查 SVG 中至少包含对应数量的谱号。
9. 资源完整性：校验器检查 MP3、WAV、MusicXML 和预生成 SVG 均存在、非空，且没有未被题库引用的过期文件。

这些约束与项目既有历史规则一致：提交 `8f514b9` 将干扰项从纯八度折叠改为 `voice-leading`、`harmony`、`mixed` 三类，提交 `2223ed4` 又要求和声干扰改变稳定拍音级类集合。关于风格边界，Altschuler（2024）对 Bach 圣咏的统计显示平行纯五/八度极少，Puget Sound 开放教材与 Oxford 指南均将非和弦音、连续五/八度作为区分声部进行与和声连接的重要依据。因此这里将原作基线作为例外，并对新增事件设置分离窗口约束。

## 分题组合结果

15 题的 `combinationsPassed` 与 `combinationsChecked` 分别为：

```text
q1–q3:   256/256 each; originalBaselineEvents=3–10 per question; decoyAddedEvents=0
q4–q15:   81/81 each; originalBaselineEvents=0–12 per question; decoyAddedEvents=0–45 aggregate per question
total:  1740/1740; all original combinations pass; all decoy combinations satisfy the ≤2 separated-event rule
```

原作候选 `variant 0` 已通过事件检查与 MusicXML 回读检查；生成器对三选项题和四选项题均使用真实语料事件生成独立候选资源。

## 人工审听边界

本记录说明自动生成、资源路径、调号/谱号和组合规则检查结果。真实播放设备上的音色偏好、手机端加载体验和人工听辨仍需在目标设备上另行确认。
