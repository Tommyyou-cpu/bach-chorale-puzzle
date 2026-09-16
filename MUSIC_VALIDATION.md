# 音乐素材生成与自动验证记录

## 范围与复现

本记录覆盖三首已选圣咏的候选声部生成、资源完整性与组合规则检查。三首选曲未更换；生成器的音高改写采用确定性规则。

按以下顺序执行：

```bash
python3 scripts/generate_music_assets.py
node scripts/validate_questions.mjs
```

第一条命令已成功完成，输出如下：

```text
questions=3
tracks=48
resources=96
wav=48
musicxml=48
combinationsChecked=768
combinationsPassed=768
```

第二条命令用于校验题库与资源，已成功完成，输出如下：

```text
questions=3
tracks=48
combinations=768
wavFiles=48
musicxmlFiles=48
```

## 候选项与资源

每题包含四个声部，每个声部有四个候选项，共 `3 × 4 × 4 = 48` 条声部候选。每条候选均具有 `explanation`（说明）字段，并分别配有一个 WAV（波形音频）文件和一个 MusicXML（音乐记谱交换格式）文件，因此共生成 48 个 WAV 文件和 48 个 MusicXML 文件。

| 编号 | `decoyType`（干扰类型字段） | 含义 |
| --- | --- | --- |
| `variant 0` | `original` | 未改写原作 |
| `variant 1` | `voice-leading` | 声部进行干扰 |
| `variant 2` | `harmony` | 和声干扰 |
| `variant 3` | `mixed` | 混合干扰 |

`variant 0`（未改写原作）已经过事件检查与 MusicXML（音乐记谱交换格式）回读检查。

## 自动检查方法与阈值

对每题四个声部各选择一条候选，穷举 `4^4 = 256` 种组合；三题合计检查 768 种组合。检查规则如下：

1. **音域**：soprano（高声部）为 C4–A5，MIDI（乐器数字接口）60–81；alto（中声部）为 G3–C5，MIDI 55–72；tenor（次中音声部）为 C3–A4，MIDI 48–69；bass（低声部）为 D2–E4，MIDI 38–64。
2. **声部关系**：相对原作，不允许新增声部交叉、越位或同音。
3. **稳定拍不协和**：每两拍检查一次共同持续至少半拍的稳定拍不协和；不得超过原作的基线例外。
4. **平行纯音程**：在全部音符边界，不允许新增同向纯五度或纯八度；原作中已有实例记录为基线例外。

## 分题结果

| 题目 | 曲目 | 组合通过数 | 音域违规 | 声部顺序违规 | 稳定拍不协和违规 | 平行纯音程违规 | 稳定拍不协和原作基线例外 | 平行纯音程原作基线例外 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| q1 | `BWV 66.6` / `Erfreut euch, ihr Herzen`（终曲圣咏） | 256/256 | 0 | 0 | 0 | 0 | 6 | 3 |
| q2 | `BWV 140.7` / `Gloria sei dir gesungen` | 256/256 | 0 | 0 | 0 | 0 | 6 | 2 |
| q3 | `BWV 244.54` / `O Haupt voll Blut und Wunden` | 256/256 | 0 | 0 | 0 | 0 | 10 | 2 |

表中的原作基线例外对应既有的原作实例，用于判定候选组合不得新增相应问题。

## 人工审听边界

本记录仅说明自动生成与自动验证结果，未进行人工试听。真实播放设备上的人工听辨需要另行完成。
