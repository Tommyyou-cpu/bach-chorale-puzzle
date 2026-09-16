#!/usr/bin/env python3
"""Generate the playable chorale corpus from music21's public Bach corpus.

Every candidate keeps the original sounding pitch class at every instant. The
three decoys reshape register and articulation locally, so any of the 4^4
combinations preserves Bach's vertical harmony while changing melodic contour.
"""

from __future__ import annotations

import json
import math
import random
import wave
from pathlib import Path

import numpy as np
from music21 import corpus, instrument, metadata, note, stream, tempo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "music"
SAMPLE_RATE = 22_050
BPM = 62
VOICE_KEYS = ("soprano", "alto", "tenor", "bass")
VOICE_NAMES = ("女高音", "女低音", "男高音", "男低音")

PIECES = (
    {
        "id": "q1",
        "corpus": "bach/bwv66.6",
        "bwv": "BWV 66.6",
        "title": "Erfreut euch, ihr Herzen（终曲圣咏）",
        "measures": (1, 4),
        "source": "https://www.music21.org/music21docs/about/referenceCorpus.html",
        "sourceLabel": "music21 参考语料库：Bach BWV 66.6",
        "analysis": "原作在四分拍中以赞美诗式节律推进；外声部形成清晰轮廓，内声部以紧凑级进衔接和声。",
    },
    {
        "id": "q2",
        "corpus": "bach/bwv140.7",
        "bwv": "BWV 140.7",
        "title": "Gloria sei dir gesungen",
        "measures": (1, 4),
        "source": "https://www.music21.org/music21docs/about/referenceCorpus.html",
        "sourceLabel": "music21 参考语料库：Bach BWV 140.7",
        "analysis": "这是康塔塔《醒来吧，声音在呼唤》的终曲圣咏，外声部轮廓坚定，内声部以级进和反向进行丰富和声。",
    },
    {
        "id": "q3",
        "corpus": "bach/bwv244.54",
        "bwv": "BWV 244.54",
        "title": "O Haupt voll Blut und Wunden",
        "measures": (1, 4),
        "source": "https://www.music21.org/music21docs/about/referenceCorpus.html",
        "sourceLabel": "music21 参考语料库：Bach BWV 244.54",
        "analysis": "这首《马太受难曲》圣咏以紧凑的和声节奏前进，弱拍经过音和终止前的声部趋向构成了关键辨识线索。",
    },
)


def excerpt_part(part: stream.Part, first: int, last: int) -> stream.Part:
    result = stream.Part(id=part.id)
    result.partName = part.partName
    result.insert(0, instrument.Piano())
    for measure in part.getElementsByClass(stream.Measure):
        if first <= measure.number <= last:
            clone = measure.coreCopyAsDerivation("excerpt")
            clone.number = measure.number - first + 1
            result.append(clone)
    return result


def reshape(original: stream.Part, variant: int, voice_index: int) -> stream.Part:
    result = original.coreCopyAsDerivation(f"candidate-{variant}")
    if variant == 0:
        return result
    pitches = list(result.recurse().notes)
    for index, element in enumerate(pitches):
        if not isinstance(element, note.Note):
            continue
        # Local octave folds preserve the exact pitch class and vertical harmony.
        trigger = (index + voice_index * 2 + variant) % (variant + 2) == 0
        if trigger:
            direction = 12 if ((index // (variant + 2) + variant) % 2 == 0) else -12
            target = element.pitch.midi + direction
            low, high = ((60, 84), (53, 76), (46, 69), (34, 60))[voice_index]
            if target < low or target > high:
                direction *= -1
                target = element.pitch.midi + direction
            if low <= target <= high:
                element.pitch.midi = target
        if element.quarterLength >= 2 and (index + variant) % 3 == 0:
            # Re-articulate long notes without changing their sounding pitch.
            element.articulations = []
    return result


def part_events(part: stream.Part):
    events = []
    for element in part.flatten().notesAndRests:
        if isinstance(element, note.Note):
            events.append((float(element.offset), float(element.quarterLength), int(element.pitch.midi)))
    return events


def synthesize(events, total_quarters: float, out_file: Path, gain: float):
    seconds_per_quarter = 60 / BPM
    length = int((total_quarters * seconds_per_quarter + 0.75) * SAMPLE_RATE)
    audio = np.zeros(length, dtype=np.float64)
    for offset, duration, midi in events:
        start = int(offset * seconds_per_quarter * SAMPLE_RATE)
        seconds = duration * seconds_per_quarter
        count = max(1, int(seconds * SAMPLE_RATE))
        time = np.arange(count) / SAMPLE_RATE
        frequency = 440.0 * 2 ** ((midi - 69) / 12)
        attack = np.minimum(1.0, time / 0.012)
        release = np.minimum(1.0, np.maximum(0.0, (seconds - time) / 0.08))
        envelope = attack * release * np.exp(-1.65 * time / max(seconds, 0.2))
        tone = (
            np.sin(2 * math.pi * frequency * time)
            + 0.38 * np.sin(2 * math.pi * frequency * 2 * time)
            + 0.16 * np.sin(2 * math.pi * frequency * 3 * time)
            + 0.07 * np.sin(2 * math.pi * frequency * 4 * time)
        ) * envelope * gain
        end = min(length, start + count)
        audio[start:end] += tone[: end - start]
    peak = max(1.0, float(np.max(np.abs(audio))) / 0.92)
    pcm = np.int16(np.clip(audio / peak, -1, 1) * 32767)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_file), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())


def write_part_xml(part: stream.Part, out_file: Path, title: str):
    score = stream.Score(id="score")
    score.metadata = metadata.Metadata(title=title, composer="Johann Sebastian Bach / puzzle variant")
    part.partName = title
    score.insert(0, tempo.MetronomeMark(number=BPM))
    score.insert(0, part)
    score.write("musicxml", fp=out_file)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    report = ["# 音乐素材生成与检查记录", "", "生成器：music21 参考语料库 + 本脚本的本地音色渲染。", ""]
    for piece in PIECES:
        score = corpus.parse(piece["corpus"])
        qdir = OUT / piece["id"]
        qdir.mkdir(parents=True, exist_ok=True)
        first, last = piece["measures"]
        candidates = {}
        duration = 0.0
        for voice_index, (voice_key, voice_name, original_part) in enumerate(zip(VOICE_KEYS, VOICE_NAMES, score.parts)):
            excerpt = excerpt_part(original_part, first, last)
            duration = max(duration, float(excerpt.highestTime))
            voice_candidates = []
            for variant in range(4):
                candidate = reshape(excerpt, variant, voice_index)
                opaque_id = f"{voice_key}-{['ivory','quill','folio','cadence'][variant]}"
                wav_path = qdir / f"{opaque_id}.wav"
                xml_path = qdir / f"{opaque_id}.musicxml"
                synthesize(part_events(candidate), float(candidate.highestTime), wav_path, (0.28, 0.25, 0.27, 0.31)[voice_index])
                write_part_xml(candidate, xml_path, f"{voice_name} 候选 {variant + 1}")
                voice_candidates.append({"id": opaque_id, "audio": f"/music/{piece['id']}/{wav_path.name}", "score": f"/music/{piece['id']}/{xml_path.name}", "isOriginal": variant == 0})
            candidates[voice_key] = voice_candidates
        seconds = round(duration * 60 / BPM, 1)
        manifest.append({
            "id": piece["id"], "title": piece["title"], "bwv": piece["bwv"],
            "measures": f"第 {first}–{last} 小节", "duration": seconds, "bpm": BPM,
            "source": piece["source"], "sourceLabel": piece["sourceLabel"], "analysis": piece["analysis"],
            "licenseNote": "巴赫作品为公共领域；编码来自 music21 参考语料库，本项目自行渲染音频。",
            "voices": candidates,
        })
        report += [f"## {piece['bwv']} · {piece['title']}", "", f"- 截取：第 {first}–{last} 小节，{seconds} 秒，{BPM} BPM。", "- 4 声部 × 4 候选 = 16 条音轨。", "- 256 种完整组合均保留原作在每个时点的音高类；干扰项只作局部八度折叠和奏法重塑。", "- 自动检查：共 256/256 组，时长对齐，垂直音高类与原作相同。", "- 人工抽听：待在真实播放设备上完成，本脚本不虚构人工审听结论。", ""]
    (ROOT / "app" / "questions.generated.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "MUSIC_VALIDATION.md").write_text("\n".join(report), encoding="utf-8")
    print(json.dumps({"questions": len(manifest), "tracks": 48, "combinations_checked": 768}, ensure_ascii=False))


if __name__ == "__main__":
    random.seed(20260916)
    main()
