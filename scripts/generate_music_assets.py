#!/usr/bin/env python3
"""生成 30 道四声部巴赫众赞歌的三选项音乐素材。"""
from __future__ import annotations

import itertools
import json
import math
import re
import wave
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from music21 import clef, corpus, instrument, key, meter, stream

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / "public" / "music"
QUESTIONS = ROOT / "app" / "questions.generated.json"
RATE = 22050
EPS = 1e-5
PERFECT = {0, 7}
DISSONANT = {1, 2, 6, 10, 11}
KINDS = ("ivory", "quill", "folio")
M21 = "https://www.music21.org/music21docs/about/referenceCorpus.html"
VOICE_KEYS = ("soprano", "alto", "tenor", "bass")

# q1–q15 保留既有众赞歌；q31–q45 从同一 music21 参考语料库扩充。
CHORALE_SPECS = {
    "q31": ("bach/bwv28.6", "BWV 28.6"),
    "q32": ("bach/bwv38.6", "BWV 38.6"),
    "q33": ("bach/bwv40.8", "BWV 40.8"),
    "q34": ("bach/bwv33.6", "BWV 33.6"),
    "q35": ("bach/bwv86.6", "BWV 86.6"),
    "q36": ("bach/bwv145.5", "BWV 145.5"),
    "q37": ("bach/bwv318", "BWV 318"),
    "q38": ("bach/bwv180.7", "BWV 180.7"),
    "q39": ("bach/bwv36.8-2", "BWV 36.8-2"),
    "q40": ("bach/bwv32.6", "BWV 32.6"),
    "q41": ("bach/bwv248.53-5", "BWV 248.53-5"),
    "q42": ("bach/bwv115.6", "BWV 115.6"),
    "q43": ("bach/bwv122.6", "BWV 122.6"),
    "q44": ("bach/bwv159.5", "BWV 159.5"),
    "q45": ("bach/bwv194.6", "BWV 194.6"),
}


@dataclass(frozen=True)
class Event:
    index: int
    offset: float
    duration: float
    midi: int
    node_index: int


@dataclass
class Part:
    path: Path
    events: list[Event]
    all_events: list[tuple[float, float, bool]]
    nodes: list[ET.Element]
    bar: float
    time: str
    key: str
    clef: str
    total: float


def tn(node: ET.Element) -> str:
    return node.tag.rsplit("}", 1)[-1]


def first(node: ET.Element | None, name: str) -> ET.Element | None:
    return next((item for item in list(node or []) if tn(item) == name), None)


def txt(node: ET.Element | None, name: str, default: str = "") -> str:
    item = first(node, name)
    return (item.text or "").strip() if item is not None else default


def midi(node: ET.Element) -> int:
    pitch = first(node, "pitch")
    if pitch is None:
        raise ValueError("音符没有 pitch")
    base = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[txt(pitch, "step").upper()]
    return round(12 * (int(txt(pitch, "octave")) + 1) + base + float(txt(pitch, "alter", "0")))


def parse(path: Path) -> Part:
    tree = ET.parse(path)
    root = tree.getroot()
    attributes = root.find(".//attributes")
    time_node = first(attributes, "time")
    beats, beat_type = int(txt(time_node, "beats", "4")), int(txt(time_node, "beat-type", "4"))
    bar = beats * 4 / beat_type
    key_node = first(attributes, "key")
    fifths = int(txt(key_node, "fifths")) if key_node is not None else 0
    count = abs(fifths)
    key = "no accidentals" if count == 0 else f"{count} {'sharp' if fifths > 0 else 'flat'}{'s' if count != 1 else ''}"
    clef_node = first(attributes, "clef")
    sign, line = txt(clef_node, "sign"), int(txt(clef_node, "line", "0"))
    octave = int(txt(clef_node, "clef-octave-change", "0") or 0)
    clef = "treble-8" if sign == "G" and line == 2 and octave == -1 else "treble" if sign == "G" and line == 2 else "alto" if sign == "C" and line == 3 else "bass" if sign == "F" and line == 4 else f"{sign}{line}"
    nodes = [node for node in root.iter() if tn(node) == "note"]
    node_ids = {id(node): index for index, node in enumerate(nodes)}
    divisions_node = first(attributes, "divisions")
    divisions = float((divisions_node.text or "1").strip() if divisions_node is not None else "1")
    part_nodes = [node for node in root.iter() if tn(node) == "part"]
    if not part_nodes:
        raise ValueError(f"缺少 part: {path}")
    events: list[Event] = []
    all_events: list[tuple[float, float, bool]] = []
    absolute = 0.0
    for measure in [item for item in list(part_nodes[0]) if tn(item) == "measure"]:
        local = 0.0
        previous = 0.0
        for item in list(measure):
            name = tn(item)
            if name in ("backup", "forward"):
                delta = float(txt(item, "duration", "0")) / divisions
                local += delta if name == "forward" else -delta
                continue
            if name != "note":
                continue
            duration = float(txt(item, "duration", "0")) / divisions
            is_chord = first(item, "chord") is not None
            # 每个候选文件代表一个独立旋律声部。源谱偶尔把同一声部的
            # 纵向重复音写成带 <chord/> 的附加 note；跳过附加音，避免
            # 音频出现纵向音程，也让导出的 MusicXML 保持单旋律结构。
            if is_chord:
                continue
            onset = previous if is_chord else local
            absolute_onset = absolute + onset
            rest = first(item, "rest") is not None
            all_events.append((absolute_onset, duration, rest))
            if not rest and first(item, "pitch") is not None:
                events.append(Event(len(events), absolute_onset, duration, midi(item), node_ids[id(item)]))
            if not is_chord:
                previous = local
                local += duration
            else:
                previous = onset
        absolute += bar
    total = max([absolute] + [offset + duration for offset, duration, _ in all_events])
    return Part(path, events, all_events, nodes, bar, f"{beats}/{beat_type}", key, clef, total)


def at(events: list[Event], time: float) -> int | None:
    for event in events:
        if event.offset <= time + EPS < event.offset + event.duration - EPS:
            return event.midi
    return None


def changed(events: list[Event], mutation: tuple[int, int]) -> list[Event]:
    index, value = mutation
    return [Event(e.index, e.offset, e.duration, value if e.index == index else e.midi, e.node_index) for e in events]


def boundaries(events: list[Event]) -> list[float]:
    return sorted({round(value, 6) for event in events for value in (event.offset, event.offset + event.duration)})


def stable_times(total: float, bar: float) -> list[float]:
    step = bar / 2
    return [round(value, 6) for value in np.arange(0, total - EPS, step)]


def intr(a: int, b: int) -> int:
    return abs(a - b) % 12


def bases(source: list[list[Event]], bar: float):
    total = max(event.offset + event.duration for voice in source for event in voice)
    stable: set[tuple[float, int, int, int]] = set()
    for time in stable_times(total, bar):
        pitches = [at(voice, time + EPS) for voice in source]
        for a, b in itertools.combinations(range(len(source)), 2):
            if pitches[a] is None or pitches[b] is None:
                continue
            value = intr(pitches[a], pitches[b])
            if value in DISSONANT:
                stable.add((time, a, b, value))
    parallel: set[tuple[float, int, int, int, int]] = set()
    for a, b in itertools.combinations(range(len(source)), 2):
        grid = sorted(set(boundaries(source[a]) + boundaries(source[b])))
        for time in grid[1:-1]:
            before = (at(source[a], time - EPS), at(source[b], time - EPS))
            after = (at(source[a], time + EPS), at(source[b], time + EPS))
            if None in before + after:
                continue
            old, new = intr(before[0], before[1]), intr(after[0], after[1])
            if old in PERFECT and new in PERFECT and (after[0] - before[0]) * (after[1] - before[1]) > 0:
                parallel.add((time, a, b, old, new))
    return stable, parallel


def order_dissonance(current: list[list[Event]], source: list[list[Event]], stable: set[tuple[float, int, int, int]], bar: float, check_order=True) -> bool:
    total = max(event.offset + event.duration for voice in source for event in voice)
    for time in stable_times(total, bar):
        original = [at(voice, time + EPS) for voice in source]
        now = [at(voice, time + EPS) for voice in current]
        for a, b in itertools.combinations(range(len(source)), 2):
            if now[a] is None or now[b] is None:
                continue
            value = intr(now[a], now[b])
            if value in DISSONANT and (time, a, b, value) not in stable:
                return True
            if check_order and original[a] is not None and original[b] is not None:
                old_sign = (original[a] > original[b]) - (original[a] < original[b])
                new_sign = (now[a] > now[b]) - (now[a] < now[b])
                if old_sign and old_sign != new_sign:
                    return True
    return False


def parallels(current: list[list[Event]], baseline: set[tuple[float, int, int, int, int]]) -> list[tuple[float, int, int, int, int]]:
    result = []
    for a, b in itertools.combinations(range(len(current)), 2):
        grid = sorted(set(boundaries(current[a]) + boundaries(current[b])))
        for time in grid[1:-1]:
            before = (at(current[a], time - EPS), at(current[b], time - EPS))
            after = (at(current[a], time + EPS), at(current[b], time + EPS))
            if None in before + after:
                continue
            old, new = intr(before[0], before[1]), intr(after[0], after[1])
            event = (time, a, b, old, new)
            if old in PERFECT and new in PERFECT and (after[0] - before[0]) * (after[1] - before[1]) > 0 and event not in baseline:
                result.append(event)
    return result


def replacements(old: int, low: int, high: int) -> list[int]:
    result = []
    for step in (1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 7, -7, 9, -9):
        value = old + step
        if low <= value <= high and value % 12 != old % 12 and abs(step) != 12:
            result.append(value)
    return result


def proposals(source: list[list[Event]], voice: int, kind: str, bar: float, stable: set[tuple[float, int, int, int]]) -> list[tuple[int, int]]:
    events = source[voice]
    low = min(event.midi for event in events) - 5
    high = max(event.midi for event in events) + 5
    total = max(event.offset + event.duration for voice_events in source for event in voice_events)
    result = []
    for event in events:
        stable_onset = abs(event.offset % bar) < EPS
        if (kind == "voice-leading" and stable_onset) or (kind == "harmony" and not stable_onset):
            continue
        sample = event.offset + min(event.duration / 2, 0.08)
        if kind == "voice-leading" and any(at(other, sample) is None for index, other in enumerate(source) if index != voice):
            continue
        # 片段筛选已经保证每声部都有持续活动；和声改写可以落在某个
        # 声部暂时承担和声支点的稳定拍，不要求所有声部恰好同时起音。
        for value in replacements(event.midi, low, high):
            item = changed(events, (event.index, value))
            current = source.copy()
            current[voice] = item
            if order_dissonance(current, source, stable, bar):
                continue
            if kind == "voice-leading":
                if any(at(item, time + EPS) != at(events, time + EPS) for time in stable_times(total, bar)):
                    continue
            else:
                original = [at(other, event.offset + EPS) for other in source]
                altered = original.copy()
                altered[voice] = value
                if {p % 12 for p in original if p is not None} == {p % 12 for p in altered if p is not None}:
                    continue
            result.append((event.index, value))
    result.sort(key=lambda item: abs(item[1] - events[item[0]].midi))
    # 个别四声部片段的低声部在稳定拍只承担和弦重复音，所有近邻音都
    # 会被原和弦音级集合吸收。仍选取实际改变音级集合的局部改写，作为
    # 有意改变和声的干扰项；组合校验会对正确组合继续执行严格检查。
    if kind == "harmony" and not result:
        for event in events:
            if abs(event.offset % bar) >= EPS:
                continue
            original = [at(other, event.offset + EPS) for other in source]
            for value in replacements(event.midi, low, high):
                altered = original.copy(); altered[voice] = value
                if {p % 12 for p in original if p is not None} != {p % 12 for p in altered if p is not None}:
                    result.append((event.index, value))
                    break
            if result:
                break
    return result[:8]


def choose(source: list[list[Event]], bar: float):
    stable, parallel_base = bases(source, bar)
    options = []
    report = []
    for voice, events in enumerate(source):
        lead = proposals(source, voice, "voice-leading", bar, stable)
        harmony = proposals(source, voice, "harmony", bar, stable)
        if not lead or not harmony:
            raise RuntimeError(f"voice{voice + 1} 缺少可验证的两类干扰位置")
        sets = []
        for a in lead:
            for b in harmony:
                if a[0] != b[0]:
                    sets.append([events, changed(events, a), changed(events, b)])
        if not sets:
            raise RuntimeError(f"voice{voice + 1} 两类干扰位置重复")
        # 每个声部保留少量近邻候选即可；全组合会按实际声部数验证，避免
        # 对包含大量装饰音的赋格片段进行指数级重复搜索。
        options.append(sets[:3])
        report.append({"voice": voice + 1, "voiceLeadingProposals": len(lead), "harmonyProposals": len(harmony), "candidateSets": len(sets)})

    def valid(picked) -> bool:
        for indexes in itertools.product(range(3), repeat=len(source)):
            current = [picked[v][indexes[v]] for v in range(len(source))]
            # 和声干扰允许产生刻意的局部不协和；原作组合与声部进行
            # 组合仍须保持原有稳定和声骨架与声部顺序。
            if order_dissonance(current, source, stable, bar) and 2 not in indexes:
                return False
            new_parallel = parallels(current, parallel_base)
            if all(index == 0 for index in indexes):
                if new_parallel:
                    return False
            elif len(new_parallel) > 2:
                return False
            else:
                measures = sorted(int(item[0] // bar) + 1 for item in new_parallel)
                if any(right - left < 2 for left, right in zip(measures, measures[1:])):
                    return False
        return True

    found = next((list(picked) for picked in itertools.product(*options) if valid(picked)), None)
    if found is None:
        raise RuntimeError("候选组合没有通过协和、声部顺序与平行五八度容差")
    return found, {"stableExceptions": len(stable), "parallelExceptions": len(parallel_base), "proposals": report}


def components(value: int, flats: bool):
    names = {0: ("C", 0), 1: ("D", -1), 2: ("D", 0), 3: ("E", -1), 4: ("E", 0), 5: ("F", 0), 6: ("G", -1), 7: ("G", 0), 8: ("A", -1), 9: ("A", 0), 10: ("B", -1), 11: ("B", 0)} if flats else {0: ("C", 0), 1: ("C", 1), 2: ("D", 0), 3: ("D", 1), 4: ("E", 0), 5: ("F", 0), 6: ("F", 1), 7: ("G", 0), 8: ("G", 1), 9: ("A", 0), 10: ("A", 1), 11: ("B", 0)}
    step, alter = names[value % 12]
    return step, alter, value // 12 - 1


def mutate_node(node: ET.Element, value: int, flats: bool):
    pitch = first(node, "pitch")
    if pitch is None:
        raise ValueError("候选音符缺少 pitch")
    step, alter, octave = components(value, flats)
    first(pitch, "step").text = step  # type: ignore[union-attr]
    old_alter = first(pitch, "alter")
    if alter:
        if old_alter is None:
            old_alter = ET.Element("alter")
            pitch.insert(1, old_alter)
        old_alter.text = str(alter)
    elif old_alter is not None:
        pitch.remove(old_alter)
    first(pitch, "octave").text = str(octave)  # type: ignore[union-attr]


def write_xml(part: Part, mutations: list[tuple[int, int]], output: Path, flats: bool):
    output.parent.mkdir(parents=True, exist_ok=True)
    tree = ET.parse(part.path)
    nodes = [node for node in tree.getroot().iter() if tn(node) == "note"]
    for index, value in mutations:
        mutate_node(nodes[part.events[index].node_index], value, flats)
    for parent in tree.getroot().iter():
        for node in list(parent):
            if tn(node) == "note" and first(node, "chord") is not None:
                parent.remove(node)
    ET.indent(tree, space="  ")
    output.write_text('<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(tree.getroot(), encoding="unicode"), encoding="utf-8")


def audio(events: list[Event], total: float, output: Path, bpm=72, gain=.23):
    seconds_per_quarter = 60 / bpm
    samples = int((total * seconds_per_quarter + .8) * RATE)
    signal = np.zeros(samples)
    for event in events:
        start = int(event.offset * seconds_per_quarter * RATE)
        seconds = max(event.duration * seconds_per_quarter, .02)
        count = max(1, int(seconds * RATE))
        t = np.arange(count) / RATE
        frequency = 440 * 2 ** ((event.midi - 69) / 12)
        envelope = np.minimum(1, t / .012) * np.minimum(1, np.maximum(0, (seconds - t) / .08)) * np.exp(-1.5 * t / max(seconds, .2))
        tone = sum(weight * np.sin(2 * math.pi * frequency * multiple * t) for multiple, weight in ((1, 1), (2, .35), (3, .14)))
        end = min(samples, start + count)
        signal[start:end] += tone[:end - start] * envelope[:end - start] * gain
    peak = max(1, float(np.max(np.abs(signal))) / .92)
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(RATE)
        stream.writeframes(np.int16(np.clip(signal / peak, -1, 1) * 32767).tobytes())


def max_rest(part: Part) -> float:
    current = longest = 0.0
    previous = None
    for offset, duration, rest in sorted(part.all_events):
        if rest and previous is not None and abs(offset - previous) < 1e-4:
            current += duration
        elif rest:
            current = duration
        else:
            current = 0
        longest = max(longest, current)
        previous = offset + duration
    return round(longest, 6)


def label(voice: str, index: int) -> str:
    return {"soprano": "女高音", "alto": "女低音", "tenor": "男高音", "bass": "男低音"}.get(voice, f"第 {index + 1} 声部")


def parse_range(value: str):
    numbers = [int(item) for item in re.findall(r"\d+", value or "")]
    return (numbers[0], numbers[-1]) if numbers else (1, 4)


def enrich_old(items):
    for question in items:
        voices = question.get("voices", {})
        order = list(question.get("voiceOrder") or voices.keys())
        first_candidate = voices[order[0]][0]
        first_part = parse(ROOT / "public" / str(first_candidate["score"])[1:])
        start, end = parse_range(str(question.get("measures", "")))
        clefs, rests = {}, {}
        for voice in order:
            part = parse(ROOT / "public" / str(voices[voice][0]["score"])[1:])
            clefs[voice], rests[voice] = part.clef, max_rest(part)
        question.update({
            "voiceOrder": order,
            "voiceLabels": {voice: label(voice, index) for index, voice in enumerate(order)},
            "timeSignature": first_part.time,
            "measureStart": start,
            "measureEnd": end,
            "sourceEdition": question.get("sourceLabel") or M21,
            "sourceLicense": f"巴赫作品为公共领域；编码来源 music21 参考语料库：{M21}",
            "maxRestByVoice": rests,
            "revision": int(question.get("revision") or 1),
            "clefs": clefs,
            "keySignature": first_part.key,
        })
    return items


def build(qid: str, corpus_id: str, bwv: str):
    start, end = 1, 4
    order = list(VOICE_KEYS)
    parts = [parse(MUSIC / qid / f"{voice}-ivory.musicxml") for voice in order]
    if any(not part.events for part in parts):
        raise RuntimeError(f"{qid} 存在空声部")
    source = [part.events for part in parts]
    try:
        candidates, report = choose(source, parts[0].bar)
    except RuntimeError as error:
        raise RuntimeError(f"{qid}（{corpus_id}）：{error}") from error
    qdir = MUSIC / qid
    qdir.mkdir(parents=True, exist_ok=True)
    expected_files = {f"{voice}-{kind}.{ext}" for voice in order for kind in KINDS for ext in ("wav", "musicxml")}
    for path in qdir.iterdir():
        if path.is_file() and path.name not in expected_files:
            path.unlink()
    voices = {}
    flats = "flat" in parts[0].key
    total = max(part.total for part in parts)
    for voice_index, (voice, part, variants) in enumerate(zip(order, parts, candidates)):
        entries = []
        for variant, events in enumerate(variants):
            mutations = [] if variant == 0 else [(event.index, events[event.index].midi) for event in part.events if events[event.index].midi != event.midi]
            if variant > 0 and len(mutations) != 1:
                raise RuntimeError(f"{qid}/{voice} 干扰项改写数量不是 1")
            stem = f"{voice}-{KINDS[variant]}"
            xml = qdir / f"{stem}.musicxml"; wav = qdir / f"{stem}.wav"
            write_xml(part, mutations, xml, flats)
            audio(events, total, wav, gain=.24 - voice_index * .025)
            if variant == 0:
                explanation, kind = "巴赫原作：保留源谱音高、节奏、休止、谱号、调号和拍号。", "original"
            elif variant == 1:
                explanation, kind = "声部进行干扰：改写非稳定拍的局部音级，稳定拍和声骨架保持不变。", "voice-leading"
            else:
                explanation, kind = "和声干扰：改写稳定拍音级，改变局部和声成员。", "harmony"
            entries.append({"id": stem, "audio": f"/music/{qid}/{stem}.mp3", "audioFallback": f"/music/{qid}/{stem}.wav", "score": f"/music/{qid}/{stem}.musicxml", "isOriginal": variant == 0, "variant": variant, "decoyType": kind, "explanation": explanation})
        voices[voice] = entries
    question = {
        "id": qid, "title": f"巴赫四声部众赞歌（{bwv}）", "bwv": bwv, "measures": f"第 {start}–{end} 小节", "duration": round(total * 60 / 72, 1), "bpm": 72,
        "genre": "chorale", "voiceCount": 4, "voiceOrder": order, "voiceLabels": {"soprano": "女高音", "alto": "女低音", "tenor": "男高音", "bass": "男低音"},
        "clefs": {voice: part.clef for voice, part in zip(order, parts)}, "keySignature": parts[0].key, "timeSignature": parts[0].time,
        "measureStart": start, "measureEnd": end, "source": M21, "sourceLabel": f"music21 参考语料库：{corpus_id}",
        "sourceEdition": f"music21 参考语料库：{corpus_id}（节选第 {start}–{end} 小节）", "sourceLicense": f"巴赫作品为公共领域；编码来源 music21 参考语料库：{M21}",
        "analysis": "四个声部以圣咏式节律共同推进；可对照外声部轮廓、内声部级进与终止前的和声连接进行听辨。每个声部提供原作、声部进行干扰和和声干扰。",
        "licenseNote": f"巴赫作品为公共领域；编码来源 music21 参考语料库：{M21}", "maxRestByVoice": {voice: max_rest(part) for voice, part in zip(order, parts)}, "revision": 1, "voices": voices,
    }
    return question, report


def excerpt_part(part, start: int, end: int, voice_index: int, fifths: int, time_signature: str):
    result = stream.Part(id=part.id)
    result.partName = part.partName
    result.insert(0, instrument.Piano())
    result.insert(0, key.KeySignature(fifths))
    result.insert(0, meter.TimeSignature(time_signature))
    result.insert(0, clef.TrebleClef() if voice_index < 2 else clef.BassClef())
    for measure in part.getElementsByClass(stream.Measure):
        if start <= measure.number <= end:
            copied = measure.coreCopyAsDerivation("chorale-excerpt")
            copied.number = measure.number - start + 1
            result.append(copied)
    return result


def write_chorale_source(qid: str, corpus_id: str):
    score = corpus.parse(corpus_id)
    if len(score.parts) != 4:
        raise RuntimeError(f"{corpus_id} 不是四声部众赞歌")
    qdir = MUSIC / qid
    qdir.mkdir(parents=True, exist_ok=True)
    signature = next(iter(score.recurse().getElementsByClass(key.KeySignature)), key.KeySignature(0))
    timing = next(iter(score.recurse().getElementsByClass(meter.TimeSignature)), meter.TimeSignature("4/4"))
    for voice_index, (voice, part) in enumerate(zip(VOICE_KEYS, score.parts)):
        excerpt = excerpt_part(part, 1, 4, voice_index, signature.sharps, timing.ratioString)
        if not list(excerpt.recurse().notes):
            raise RuntimeError(f"{corpus_id}/{voice} 在第 1–4 小节没有音符")
        excerpt.write("musicxml", fp=str(qdir / f"{voice}-ivory.musicxml"))


def remove_unused_assets(manifest):
    expected = {
        MUSIC / question["id"] / f"{candidate['id']}.{extension}"
        for question in manifest
        for candidates in question["voices"].values()
        for candidate in candidates
        for extension in ("mp3", "wav", "musicxml")
    }
    for qdir in MUSIC.iterdir():
        if not qdir.is_dir():
            continue
        for path in qdir.iterdir():
            if path.is_file() and path.suffix in (".mp3", ".wav", ".musicxml") and path not in expected:
                path.unlink()


def main():
    old = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    if not isinstance(old, list) or len(old) < 15:
        raise RuntimeError("现有题库缺少 q1-q15")
    manifest = enrich_old(old[:15]) + old[15:30]
    for question in manifest[:15]:
        question["genre"] = "chorale"
        question["voiceCount"] = 4
        question["voiceOrder"] = list(VOICE_KEYS)
        question["voiceLabels"] = {"soprano": "女高音", "alto": "女低音", "tenor": "男高音", "bass": "男低音"}
        question["voices"] = {voice: question["voices"][voice][:3] for voice in VOICE_KEYS}
    reports = []
    for qid, (corpus_id, bwv) in CHORALE_SPECS.items():
        write_chorale_source(qid, corpus_id)
        question, report = build(qid, corpus_id, bwv)
        manifest.append(question); reports.append({"id": qid, **report})
    if len(manifest) != 45:
        raise RuntimeError(f"题库数量错误：{len(manifest)}")
    counts = {genre: sum(item.get("genre") == genre for item in manifest) for genre in ("chorale", "fugue", "other")}
    if counts != {"chorale": 30, "fugue": 10, "other": 5}:
        raise RuntimeError(f"分类数量错误：{counts}")
    remove_unused_assets(manifest)
    QUESTIONS.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tracks = sum(len(candidates) for question in manifest for candidates in question["voices"].values())
    print(json.dumps({"questions": len(manifest), "categories": counts, "tracks": tracks, "wav": tracks, "musicxml": tracks, "new": reports}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
