#!/usr/bin/env python3
"""生成巴赫圣咏拼图的素材，并实际枚举四声部的全部组合。"""

from __future__ import annotations

import itertools
import json
import math
import re
import shutil
import wave
from dataclasses import dataclass
from copy import deepcopy
from functools import lru_cache
from pathlib import Path

import numpy as np
from music21 import converter, corpus, instrument, metadata, note, stream, tempo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "music"
SAMPLE_RATE = 22_050
BPM = 62
VOICE_KEYS = ("soprano", "alto", "tenor", "bass")
VOICE_NAMES = ("女高音", "女低音", "男高音", "男低音")
VOICE_RANGES = ((60, 81), (55, 72), (48, 69), (38, 64))
STABLE_BEAT_STEP = 2
STABLE_HOLD = 0.5
EPSILON = 1e-6
DISSONANT_INTERVALS = frozenset({1, 2, 5, 6, 10, 11})
PERFECT_INTERVALS = frozenset({0, 7})
VARIANT_TYPES = ("original", "voice-leading", "harmony", "mixed")

SOURCE_URL = "https://www.music21.org/music21docs/about/referenceCorpus.html"

# 这些曲目均来自 music21（音乐分析与记谱库）内置的 Bach 四声部圣咏语料。
# 前三题保留四个候选，后续题目使用三个候选以控制预生成乐谱数量。
PIECES = (
    {"id": "q1", "corpus": "bach/bwv66.6", "bwv": "BWV 66.6", "title": "Erfreut euch, ihr Herzen（终曲圣咏）", "variants": 4, "analysis": "原作在四分拍中以赞美诗式节律推进；外声部形成清晰轮廓，内声部以紧凑级进衔接和声。"},
    {"id": "q2", "corpus": "bach/bwv140.7", "bwv": "BWV 140.7", "title": "Gloria sei dir gesungen", "variants": 4, "analysis": "这是康塔塔《醒来吧，声音在呼唤》的终曲圣咏，外声部轮廓坚定，内声部以级进和反向进行丰富和声。"},
    {"id": "q3", "corpus": "bach/bwv244.54", "bwv": "BWV 244.54", "title": "O Haupt voll Blut und Wunden", "variants": 4, "analysis": "这首《马太受难曲》圣咏以紧凑的和声节奏前进，弱拍经过音和终止前的声部趋向构成了关键辨识线索。"},
    {"id": "q4", "corpus": "bach/bwv10.7", "bwv": "BWV 10.7", "title": "Meine Seel erhebt den Herren", "variants": 3, "analysis": "圣咏段落以长时值开头和连续级进展开，适合比较外声部的旋律方向与内声部的和声支撑。"},
    {"id": "q5", "corpus": "bach/bwv101.7", "bwv": "BWV 101.7", "title": "Nimm von uns, Herr, du treuer Gott", "variants": 3, "analysis": "四声部在稳定和声与经过音之间保持清楚层次，旋律线条和低音方向都具有较强辨识度。"},
    {"id": "q6", "corpus": "bach/bwv103.6", "bwv": "BWV 103.6", "title": "Ihr werdet weinen und heulen", "variants": 3, "analysis": "原作以级进旋律和多处短时值内声部衔接推进，适合训练对声部进行的听辨。"},
    {"id": "q7", "corpus": "bach/bwv104.6", "bwv": "BWV 104.6", "title": "Du Hirte Israel, höre", "variants": 3, "analysis": "外声部轮廓与内声部的分解和声并行展开，终止前的音高趋向提供了清晰线索。"},
    {"id": "q8", "corpus": "bach/bwv122.6", "bwv": "BWV 122.6", "title": "Das neugeborne Kindelein", "variants": 3, "analysis": "该圣诞圣咏在简洁节拍框架中交替使用级进与跳进，四声部的纵向关系较为鲜明。"},
    {"id": "q9", "corpus": "bach/bwv123.6", "bwv": "BWV 123.6", "title": "Liebster Immanuel, Herzog der Frommen", "variants": 3, "analysis": "原作的旋律动机在各声部之间形成呼应，和声声部承担稳定的纵向支撑。"},
    {"id": "q10", "corpus": "bach/bwv111.6", "bwv": "BWV 111.6", "title": "Was mein Gott will, das g'scheh allzeit", "variants": 3, "analysis": "四声部保持紧密的音域关系，短时值经过音与终止进行构成主要辨识点。"},
    {"id": "q11", "corpus": "bach/bwv113.8", "bwv": "BWV 113.8", "title": "Lord, the God of my salvation", "variants": 3, "analysis": "旋律以规则节奏推进，低音和中声部的反向进行使纵向和声轮廓清晰。"},
    {"id": "q12", "corpus": "bach/bwv114.7", "bwv": "BWV 114.7", "title": "Ach, lieben Christen, seid getrost", "variants": 3, "analysis": "原作兼有级进旋律与分解和弦，适合比较旋律变形和稳定拍和声变化。"},
    {"id": "q13", "corpus": "bach/bwv115.6", "bwv": "BWV 115.6", "title": "Mache dich, mein Geist, bereit", "variants": 3, "analysis": "四声部在稳定拍上形成明确和弦，非稳定拍的旋律衔接提供了干扰项辨识线索。"},
    {"id": "q14", "corpus": "bach/bwv116.6", "bwv": "BWV 116.6", "title": "Du Friedefürst, Herr Jesu Christ", "variants": 3, "analysis": "外声部旋律平稳，内声部以级进和反向进行完善和声连接。"},
    {"id": "q15", "corpus": "bach/bwv117.4", "bwv": "BWV 117.4", "title": "Sei Lob und Ehr dem höchsten Gut", "variants": 3, "analysis": "该圣咏的四声部配置紧凑，低音进行和终止前的声部趋向构成核心听辨线索。"},
)

for _piece in PIECES:
    _piece.update({
        "measures": (1, 4),
        "source": SOURCE_URL,
        "sourceLabel": f"music21 参考语料库：Bach {_piece['bwv']}",
    })

VARIANT_NAMES = ("ivory", "quill", "folio", "cadence")

# 现有三题已经过人工与组合规则校验，保留其确定性改写，避免扩充题库时
# 改变旧题的听辨边界；新增题目使用下方的自动候选搜索。
LEGACY_MUTATIONS = {
    "q1": {
        "soprano": {"voice-leading": (14, 71, 78), "harmony": (2, 73, 72)},
        "alto": {"voice-leading": (3, 64, 69), "harmony": (16, 63, 62)},
        "tenor": {"voice-leading": (7, 62, 55), "harmony": (0, 61, 62)},
        "bass": {"voice-leading": (19, 47, 40), "harmony": (14, 56, 51)},
    },
    "q2": {
        "soprano": {"voice-leading": (1, 67, 74), "harmony": (6, 72, 70)},
        "alto": {"voice-leading": (7, 65, 58), "harmony": (2, 67, 66)},
        "tenor": {"voice-leading": (1, 58, 53), "harmony": (12, 58, 60)},
        "bass": {"voice-leading": (10, 48, 41), "harmony": (15, 55, 54)},
    },
    "q3": {
        "soprano": {"voice-leading": (1, 72, 79), "harmony": (4, 67, 74)},
        "alto": {"voice-leading": (4, 64, 57), "harmony": (3, 62, 63)},
        "tenor": {"voice-leading": (2, 65, 58), "harmony": (11, 62, 61)},
        "bass": {"voice-leading": (13, 45, 38), "harmony": (0, 58, 53)},
    },
}

Event = tuple[float, float, int]


@dataclass(frozen=True)
class Mutation:
    index: int
    offset: float
    duration: float
    old_midi: int
    new_midi: int


@dataclass(frozen=True)
class Candidate:
    events: tuple[Event, ...]
    mutations: tuple[Mutation, ...]


@dataclass(frozen=True)
class Baseline:
    stable_dissonances: frozenset[tuple[float, int, int, int]]
    parallel_perfects: frozenset[tuple[float, int, int, int, int]]


def excerpt_part(part: stream.Part, first: int, last: int) -> stream.Part:
    result = stream.Part(id=part.id)
    result.partName = part.partName
    result.insert(0, instrument.Piano())
    # 有些 music21（音乐分析与记谱库）语料把调号和谱号放在声部上下文，
    # 直接复制小节会丢失它们；显式带入上下文，保证独立 MusicXML 可渲染。
    for class_name in ("KeySignature", "TimeSignature", "Clef"):
        context = part.recurse().getElementsByClass(class_name)
        if context:
            notation = deepcopy(context[0])
            notation.offset = 0
            result.insert(0, notation)
    for measure in part.getElementsByClass(stream.Measure):
        if first <= measure.number <= last:
            clone = measure.coreCopyAsDerivation("excerpt")
            clone.number = measure.number - first + 1
            result.append(clone)
    return result


def clef_label(part: stream.Part) -> str:
    """把 music21 谱号转换为后台使用的稳定标识。"""
    clefs = part.recurse().getElementsByClass("Clef")
    if not clefs:
        raise RuntimeError(f"{part.id} 缺少谱号")
    clef = clefs[0]
    sign, line, octave_change = clef.sign, int(clef.line), getattr(clef, "octaveChange", 0) or 0
    if sign == "G" and line == 2 and octave_change == -1:
        return "treble-8"
    if sign == "G" and line == 2:
        return "treble"
    if sign == "C" and line == 3:
        return "alto"
    if sign == "F" and line == 4:
        return "bass"
    return f"{sign}{line}{'+' if octave_change > 0 else ''}{octave_change or ''}"


def key_signature_label(part: stream.Part) -> str:
    """把源谱调号转换为跨声部一致、可由校验器反查的字符串。"""
    keys = part.recurse().getElementsByClass("KeySignature")
    if not keys:
        raise RuntimeError(f"{part.id} 缺少调号")
    key = keys[0]
    count = abs(int(key.sharps))
    accidental = "sharp" if key.sharps > 0 else "flat" if key.sharps < 0 else "natural"
    if count == 0:
        return "no accidentals"
    return f"{count} {accidental}{'s' if count != 1 else ''}"


def part_notes(part: stream.Part) -> list[note.Note]:
    notes = [element for element in part.recurse().notes if isinstance(element, note.Note)]
    if not notes:
        raise ValueError("声部中没有音符")
    return notes


def part_events(part: stream.Part) -> tuple[Event, ...]:
    return tuple(
        (float(element.offset), float(element.quarterLength), int(element.pitch.midi))
        for element in part.flatten().notesAndRests
        if isinstance(element, note.Note)
    )


def signature(events: tuple[Event, ...]) -> tuple[Event, ...]:
    return tuple((round(offset, 6), round(duration, 6), midi) for offset, duration, midi in events)


def shape(events: tuple[Event, ...]) -> tuple[tuple[float, float], ...]:
    return tuple((offset, duration) for offset, duration, _ in events)


def pitch_at(events: tuple[Event, ...], time: float) -> int | None:
    for offset, duration, midi in events:
        if offset <= time < offset + duration:
            return midi
    return None


def boundaries(*parts: tuple[Event, ...]) -> tuple[float, ...]:
    return tuple(sorted({round(value, 6) for events in parts for offset, duration, _ in events for value in (offset, offset + duration)}))


def sign(value: int) -> int:
    return (value > 0) - (value < 0)


def interval_class(upper: int, lower: int) -> int:
    return (upper - lower) % 12


def is_stable_onset(offset: float) -> bool:
    return abs(offset - round(offset)) < EPSILON and int(round(offset)) % STABLE_BEAT_STEP == 0


def stable_times(total_quarters: float) -> tuple[float, ...]:
    return tuple(float(value) for value in range(0, math.ceil(total_quarters), STABLE_BEAT_STEP))


def sustained_pitch(events: tuple[Event, ...], time: float) -> int | None:
    start = pitch_at(events, time)
    return start if start is not None and pitch_at(events, time + STABLE_HOLD - EPSILON) == start else None


def original_baseline(source: tuple[tuple[Event, ...], ...]) -> Baseline:
    duration = max(offset + length for events in source for offset, length, _ in events)
    stable: set[tuple[float, int, int, int]] = set()
    for time in stable_times(duration):
        pitches = [sustained_pitch(events, time) for events in source]
        if any(pitch is None for pitch in pitches):
            continue
        for upper, lower in itertools.combinations(range(len(source)), 2):
            interval = interval_class(pitches[upper], pitches[lower])  # type: ignore[arg-type]
            if interval in DISSONANT_INTERVALS:
                stable.add((time, upper, lower, interval))

    parallels: set[tuple[float, int, int, int, int]] = set()
    for time in boundaries(*source)[1:-1]:
        before = [pitch_at(events, time - EPSILON) for events in source]
        after = [pitch_at(events, time + EPSILON) for events in source]
        for upper, lower in itertools.combinations(range(len(source)), 2):
            if None in (before[upper], before[lower], after[upper], after[lower]):
                continue
            old_interval = interval_class(before[upper], before[lower])  # type: ignore[arg-type]
            new_interval = interval_class(after[upper], after[lower])  # type: ignore[arg-type]
            upper_motion = after[upper] - before[upper]  # type: ignore[operator]
            lower_motion = after[lower] - before[lower]  # type: ignore[operator]
            if old_interval in PERFECT_INTERVALS and new_interval in PERFECT_INTERVALS and upper_motion * lower_motion > 0:
                parallels.add((time, upper, lower, old_interval, new_interval))
    return Baseline(frozenset(stable), frozenset(parallels))


@lru_cache(maxsize=None)
def pair_problem(
    first: tuple[Event, ...],
    first_voice: int,
    second: tuple[Event, ...],
    second_voice: int,
    source: tuple[tuple[Event, ...], ...],
    baseline: Baseline,
    check_parallel: bool = True,
) -> str | None:
    if first_voice < second_voice:
        upper, upper_voice, lower, lower_voice = first, first_voice, second, second_voice
    else:
        upper, upper_voice, lower, lower_voice = second, second_voice, first, first_voice

    time_grid = boundaries(upper, lower)
    for left, right in zip(time_grid, time_grid[1:]):
        time = (left + right) / 2
        current = (pitch_at(upper, time), pitch_at(lower, time))
        original = (pitch_at(source[upper_voice], time), pitch_at(source[lower_voice], time))
        if None not in current + original and sign(current[0] - current[1]) != sign(original[0] - original[1]):  # type: ignore[operator]
            return "voice_order"

    duration = max(offset + length for events in (upper, lower) for offset, length, _ in events)
    for time in stable_times(duration):
        upper_pitch, lower_pitch = sustained_pitch(upper, time), sustained_pitch(lower, time)
        if upper_pitch is None or lower_pitch is None:
            continue
        interval = interval_class(upper_pitch, lower_pitch)
        if interval in DISSONANT_INTERVALS and (time, upper_voice, lower_voice, interval) not in baseline.stable_dissonances:
            return "stable_dissonance"

    for time in time_grid[1:-1]:
        before = (pitch_at(upper, time - EPSILON), pitch_at(lower, time - EPSILON))
        after = (pitch_at(upper, time + EPSILON), pitch_at(lower, time + EPSILON))
        if None in before + after:
            continue
        old_interval = interval_class(before[0], before[1])  # type: ignore[arg-type]
        new_interval = interval_class(after[0], after[1])  # type: ignore[arg-type]
        upper_motion, lower_motion = after[0] - before[0], after[1] - before[1]  # type: ignore[operator]
        if check_parallel and (
            old_interval in PERFECT_INTERVALS
            and new_interval in PERFECT_INTERVALS
            and upper_motion * lower_motion > 0
            and (time, upper_voice, lower_voice, old_interval, new_interval) not in baseline.parallel_perfects
        ):
            return "parallel_perfect"
    return None


def parallel_perfect_events(
    first: tuple[Event, ...],
    first_voice: int,
    second: tuple[Event, ...],
    second_voice: int,
    source: tuple[tuple[Event, ...], ...],
    baseline: Baseline,
) -> tuple[tuple[float, int, int, int, int], ...]:
    """返回相对原作新增的同向纯五度/纯八度事件。"""
    if first_voice < second_voice:
        upper, upper_voice, lower, lower_voice = first, first_voice, second, second_voice
    else:
        upper, upper_voice, lower, lower_voice = second, second_voice, first, first_voice
    result = []
    time_grid = boundaries(upper, lower)
    for time in time_grid[1:-1]:
        before = (pitch_at(upper, time - EPSILON), pitch_at(lower, time - EPSILON))
        after = (pitch_at(upper, time + EPSILON), pitch_at(lower, time + EPSILON))
        if None in before + after:
            continue
        old_interval = interval_class(before[0], before[1])  # type: ignore[arg-type]
        new_interval = interval_class(after[0], after[1])  # type: ignore[arg-type]
        upper_motion, lower_motion = after[0] - before[0], after[1] - before[1]  # type: ignore[operator]
        event = (time, upper_voice, lower_voice, old_interval, new_interval)
        if (
            old_interval in PERFECT_INTERVALS
            and new_interval in PERFECT_INTERVALS
            and upper_motion * lower_motion > 0
            and event not in baseline.parallel_perfects
        ):
            result.append(event)
    return tuple(result)


def candidate_from(source: tuple[Event, ...], mutations: tuple[Mutation, ...]) -> Candidate:
    changed = list(source)
    for mutation in mutations:
        offset, duration, old_midi = changed[mutation.index]
        if (offset, duration, old_midi) != (mutation.offset, mutation.duration, mutation.old_midi):
            raise RuntimeError("干扰项没有对应到预期原作音符")
        changed[mutation.index] = (offset, duration, mutation.new_midi)
    return Candidate(tuple(changed), mutations)


def resolved_mutation(source: tuple[Event, ...], spec: tuple[int, int, int], decoy_type: str) -> Mutation:
    index, expected_midi, replacement_midi = spec
    offset, duration, actual_midi = source[index]
    if actual_midi != expected_midi:
        raise RuntimeError(f"原作音高已变化：第 {index} 个音符应为 {expected_midi}，实际为 {actual_midi}")
    if decoy_type == "voice-leading" and is_stable_onset(offset):
        raise RuntimeError("声部进行干扰不能改写稳定拍")
    if decoy_type == "harmony" and not is_stable_onset(offset):
        raise RuntimeError("和声干扰必须改写稳定拍")
    return Mutation(index, offset, duration, actual_midi, replacement_midi)


def legacy_candidate_sets(
    piece_id: str,
    source: tuple[tuple[Event, ...], ...],
    variant_count: int,
) -> tuple[tuple[Candidate, ...], ...]:
    specs = LEGACY_MUTATIONS[piece_id]
    result = []
    for voice_index, voice in enumerate(VOICE_KEYS):
        leading = resolved_mutation(source[voice_index], specs[voice]["voice-leading"], "voice-leading")
        harmony = resolved_mutation(source[voice_index], specs[voice]["harmony"], "harmony")
        variants = (
            Candidate(source[voice_index], ()),
            candidate_from(source[voice_index], (leading,)),
            candidate_from(source[voice_index], (harmony,)),
        )
        if variant_count == 4:
            variants += (candidate_from(source[voice_index], (harmony, leading)),)
        result.append(variants)
    return tuple(result)


# 禁止用纯八度折叠伪造干扰项；替换音必须改变实际音级类。
PITCH_STEPS = (2, -2, 1, -1, 3, -3, 4, -4, 5, -5, 7, -7, 9, -9)


def replacement_pitches(old_midi: int, low: int, high: int) -> tuple[int, ...]:
    """按接近原音的顺序返回音域内替换音高，确保候选确实改变音频。"""
    return tuple(
        candidate
        for step in PITCH_STEPS
        for candidate in (old_midi + step,)
        if low <= candidate <= high and candidate != old_midi
    )


def mutation_proposals(
    source: tuple[tuple[Event, ...], ...],
    voice_index: int,
    decoy_type: str,
) -> tuple[Mutation, ...]:
    """从原作自动寻找候选改写，避免依赖某一首曲目的固定音符下标。"""
    events = source[voice_index]
    low, high = VOICE_RANGES[voice_index]
    proposals: list[Mutation] = []
    for index, (offset, duration, old_midi) in enumerate(events):
        if decoy_type == "voice-leading" and is_stable_onset(offset):
            continue
        if decoy_type == "harmony" and not is_stable_onset(offset):
            continue
        original_pitches = [pitch_at(events_for_voice, offset + EPSILON) for events_for_voice in source]
        if any(pitch is None for pitch in original_pitches):
            continue
        for new_midi in replacement_pitches(old_midi, low, high):
            if decoy_type == "voice-leading":
                changed_events = list(events)
                changed_events[index] = (offset, duration, new_midi)
                total_duration = max(event_offset + event_duration for event_offset, event_duration, _ in events)
                if any(
                    pitch_at(tuple(changed_events), time) != pitch_at(events, time)
                    for time in stable_times(total_duration)
                ):
                    continue
            if decoy_type == "harmony":
                changed_pitches = list(original_pitches)
                changed_pitches[voice_index] = new_midi
                original_classes = {pitch % 12 for pitch in original_pitches if pitch is not None}
                changed_classes = {pitch % 12 for pitch in changed_pitches if pitch is not None}
                if changed_classes == original_classes:
                    continue
            proposals.append(Mutation(index, offset, duration, old_midi, new_midi))
    return tuple(proposals)


def candidate_sets_for_voice(
    source: tuple[tuple[Event, ...], ...],
    voice_index: int,
    variant_count: int,
    proposal_limit: int,
    baseline: Baseline,
) -> tuple[tuple[Candidate, ...], ...]:
    """为一个声部构造三选项或四选项候选集合。"""
    original_candidates = tuple(Candidate(events, ()) for events in source)

    def individually_safe(mutation: Mutation) -> bool:
        candidate = candidate_from(source[voice_index], (mutation,))
        return all(
            other_voice == voice_index
            or not pair_problem(candidate.events, voice_index, other.events, other_voice, source, baseline, check_parallel=False)
            for other_voice, other in enumerate(original_candidates)
        )

    leading_all = mutation_proposals(source, voice_index, "voice-leading")
    harmony_all = mutation_proposals(source, voice_index, "harmony")
    leading_safe = tuple(mutation for mutation in leading_all if individually_safe(mutation))
    harmony_safe = tuple(mutation for mutation in harmony_all if individually_safe(mutation))
    leading = (leading_safe or leading_all)[:proposal_limit]
    harmony = (harmony_safe or harmony_all)[:proposal_limit]
    if not leading or not harmony:
        raise RuntimeError(f"{VOICE_KEYS[voice_index]} 没有足够的声部进行或和声改写位置")

    options: list[tuple[Candidate, ...]] = []
    for leading_mutation in leading:
        for harmony_mutation in harmony:
            if leading_mutation.index == harmony_mutation.index:
                continue
            variants = (
                Candidate(source[voice_index], ()),
                candidate_from(source[voice_index], (leading_mutation,)),
                candidate_from(source[voice_index], (harmony_mutation,)),
            )
            if variant_count == 4:
                variants += (candidate_from(source[voice_index], (harmony_mutation, leading_mutation)),)
            if len({signature(candidate.events) for candidate in variants}) != variant_count:
                continue
            options.append(variants)
    if not options:
        raise RuntimeError(f"{VOICE_KEYS[voice_index]} 无法构造不重复的候选集合")
    return tuple(options)


def candidate_set_compatible(
    candidate_set: tuple[Candidate, ...],
    voice_index: int,
    source: tuple[tuple[Event, ...], ...],
    baseline: Baseline,
) -> bool:
    """先排除与其余声部原作候选冲突的集合，减少组合搜索量。"""
    low, high = VOICE_RANGES[voice_index]
    if any(any(midi < low or midi > high for _, _, midi in candidate.events) for candidate in candidate_set):
        return False
    original = tuple(Candidate(events, ()) for events in source)
    for other_voice, other_candidate in enumerate(original):
        if other_voice == voice_index:
            continue
        for candidate in candidate_set:
            if pair_problem(candidate.events, voice_index, other_candidate.events, other_voice, source, baseline, check_parallel=False):
                return False
    return True


def select_candidates(
    piece_id: str,
    source: tuple[tuple[Event, ...], ...],
    baseline: Baseline,
    variant_count: int,
) -> tuple[tuple[Candidate, ...], ...]:
    """搜索四个声部的候选集合，使所有跨声部组合都满足原有约束。"""
    for proposal_limit in (2, 4, 8, 16, 32, 48):
        option_sets = tuple(
            candidate_sets_for_voice(source, voice_index, variant_count, proposal_limit, baseline)
            for voice_index in range(len(VOICE_KEYS))
        )
        filtered = tuple(
            tuple(
                option
                for option in options
                if candidate_set_compatible(option, voice_index, source, baseline)
            )
            for voice_index, options in enumerate(option_sets)
        )
        if any(not options for options in filtered):
            continue

        selected: list[tuple[Candidate, ...]] = []

        def search(voice_index: int) -> tuple[tuple[Candidate, ...], ...] | None:
            if voice_index == len(VOICE_KEYS):
                try:
                    validate_combinations(piece_id, tuple(selected), source, baseline)
                except RuntimeError:
                    return None
                return tuple(selected)
            for candidate_set in filtered[voice_index]:
                compatible = True
                for other_voice, other_set in enumerate(selected):
                    for candidate in candidate_set:
                        for other_candidate in other_set:
                            if pair_problem(
                                candidate.events,
                                voice_index,
                                other_candidate.events,
                                other_voice,
                                source,
                                baseline,
                                check_parallel=False,
                            ):
                                compatible = False
                                break
                        if not compatible:
                            break
                    if not compatible:
                        break
                if not compatible:
                    continue
                selected.append(candidate_set)
                result = search(voice_index + 1)
                if result is not None:
                    return result
                selected.pop()
            return None

        result = search(0)
        if result is not None:
            return result

    raise RuntimeError(f"{piece_id} 无法为四个声部找到通过组合约束的候选集合")


def validate_harmony_changes(piece_id: str, candidates: tuple[tuple[Candidate, ...], ...], source: tuple[tuple[Event, ...], ...]) -> None:
    """确保每条和声干扰都改变其稳定拍的纵向音高类集合。"""
    for voice_index, voice_candidates in enumerate(candidates):
        mutation = voice_candidates[2].mutations[0]
        time = mutation.offset + EPSILON
        original = [pitch_at(events, time) for events in source]
        changed = original.copy()
        changed[voice_index] = mutation.new_midi
        if any(pitch is None for pitch in original) or set(pitch % 12 for pitch in original if pitch is not None) == set(pitch % 12 for pitch in changed if pitch is not None):
            raise RuntimeError(f"{piece_id}/{VOICE_KEYS[voice_index]} 的和声干扰没有改变稳定拍和弦音集合")


def validate_candidate_semantics(
    piece_id: str,
    candidates: tuple[tuple[Candidate, ...], ...],
    source: tuple[tuple[Event, ...], ...],
) -> None:
    """校验三类干扰的音乐语义，禁止八度替换冒充新候选。"""
    duration = max(offset + length for events in source for offset, length, _ in events)
    for voice_index, voice_candidates in enumerate(candidates):
        for candidate in voice_candidates[1:]:
            for mutation in candidate.mutations:
                if abs(mutation.new_midi - mutation.old_midi) == 12:
                    raise RuntimeError(f"{piece_id}/{VOICE_KEYS[voice_index]} 使用纯八度替换，禁止作为干扰项")
                if mutation.new_midi % 12 == mutation.old_midi % 12:
                    raise RuntimeError(f"{piece_id}/{VOICE_KEYS[voice_index]} 的干扰没有改变实际音级类")

        leading = voice_candidates[1]
        leading_mutation = leading.mutations[0]
        if is_stable_onset(leading_mutation.offset):
            raise RuntimeError(f"{piece_id}/{VOICE_KEYS[voice_index]} 的 voice-leading 改写了稳定拍")
        stable_grid = stable_times(duration)
        for time in stable_grid:
            original_stable = [pitch_at(events, time) for events in source]
            changed_stable = [pitch_at(events, time) for events in source]
            changed_stable[voice_index] = pitch_at(leading.events, time)
            if original_stable != changed_stable:
                raise RuntimeError(f"{piece_id}/{VOICE_KEYS[voice_index]} 的 voice-leading 改变了稳定拍和弦骨架")

        time = leading_mutation.offset + min(leading_mutation.duration / 2, 0.25)
        original_pitches = [pitch_at(events, time) for events in source]
        changed_pitches = [pitch_at(events, time) for events in source]
        changed_pitches[voice_index] = pitch_at(leading.events, time)
        if original_pitches == changed_pitches:
            raise RuntimeError(f"{piece_id}/{VOICE_KEYS[voice_index]} 的 voice-leading 没有可听差异")

        harmony = voice_candidates[2]
        harmony_mutation = harmony.mutations[0]
        harmony_time = harmony_mutation.offset + EPSILON
        original_harmony = [pitch_at(events, harmony_time) for events in source]
        changed_harmony = [pitch_at(events, harmony_time) for events in source]
        changed_harmony[voice_index] = pitch_at(harmony.events, harmony_time)
        original_classes = {pitch % 12 for pitch in original_harmony if pitch is not None}
        changed_classes = {pitch % 12 for pitch in changed_harmony if pitch is not None}
        if original_classes == changed_classes:
            raise RuntimeError(f"{piece_id}/{VOICE_KEYS[voice_index]} 的 harmony 没有改变稳定拍和弦走向")

        if len(voice_candidates) == 4:
            mixed = voice_candidates[3]
            if len(mixed.mutations) != 2 or mixed.mutations[0] != harmony_mutation or mixed.mutations[1] != leading_mutation:
                raise RuntimeError(f"{piece_id}/{VOICE_KEYS[voice_index]} 的 mixed 未同时包含两类干扰")


def validate_combinations(
    piece_id: str,
    candidates: tuple[tuple[Candidate, ...], ...],
    source: tuple[tuple[Event, ...], ...],
    baseline: Baseline,
) -> dict[str, int | str]:
    failures = {"range": 0, "voice_order": 0, "stable_dissonance": 0, "parallel_perfect": 0, "parallel_chain": 0}
    allowed_parallel_events = 0
    passed = 0
    variant_count = len(candidates[0])
    for selected_variants in itertools.product(range(variant_count), repeat=4):
        selected = tuple(candidates[voice][variant] for voice, variant in enumerate(selected_variants))
        problems: set[str] = set()
        for voice, candidate in enumerate(selected):
            low, high = VOICE_RANGES[voice]
            if any(midi < low or midi > high for _, _, midi in candidate.events):
                problems.add("range")
        new_parallel_events = []
        for first, second in itertools.combinations(range(4), 2):
            problem = pair_problem(selected[first].events, first, selected[second].events, second, source, baseline, check_parallel=False)
            if problem:
                problems.add(problem)
            new_parallel_events.extend(
                parallel_perfect_events(selected[first].events, first, selected[second].events, second, source, baseline)
            )
        is_original_combination = all(variant == 0 for variant in selected_variants)
        if is_original_combination and new_parallel_events:
            problems.add("parallel_perfect")
        else:
            event_measures = sorted(int(event[0] // 4) + 1 for event in new_parallel_events)
            too_close = any(right - left < 2 for left, right in zip(event_measures, event_measures[1:]))
            if len(new_parallel_events) > 2 or too_close:
                problems.add("parallel_perfect")
                failures["parallel_chain"] += 1
            else:
                allowed_parallel_events += len(new_parallel_events)
        for problem in problems:
            failures[problem] += 1
        if problems:
            raise RuntimeError(f"{piece_id} 的组合 {selected_variants} 未通过：{', '.join(sorted(problems))}")
        passed += 1
    return {
        "id": piece_id,
        "combinations": variant_count**4,
        "passed": passed,
        "rangeViolations": failures["range"],
        "voiceOrderViolations": failures["voice_order"],
        "stableDissonanceViolations": failures["stable_dissonance"],
        "parallelPerfectViolations": failures["parallel_perfect"],
        "parallelChainViolations": failures["parallel_chain"],
        "allowedDecoyParallelEvents": allowed_parallel_events,
        "baselineStableExceptions": len(baseline.stable_dissonances),
        "baselineParallelExceptions": len(baseline.parallel_perfects),
    }


def apply_candidate(original: stream.Part, candidate: Candidate, variant: int) -> stream.Part:
    result = original.coreCopyAsDerivation(f"candidate-{variant}")
    notes = part_notes(result)
    if len(notes) != len(candidate.events):
        raise RuntimeError("复制后的声部音符数量发生变化")
    for mutation in candidate.mutations:
        notes[mutation.index].pitch.midi = mutation.new_midi
    if signature(part_events(result)) != signature(candidate.events):
        raise RuntimeError("候选声部写入后与事件计划不一致")
    return result


def synthesize(events: tuple[Event, ...], total_quarters: float, path: Path, gain: float) -> None:
    seconds_per_quarter = 60 / BPM
    length = int((total_quarters * seconds_per_quarter + 0.75) * SAMPLE_RATE)
    audio = np.zeros(length, dtype=np.float64)
    for offset, duration, midi in events:
        start = int(offset * seconds_per_quarter * SAMPLE_RATE)
        seconds = duration * seconds_per_quarter
        count = max(1, int(seconds * SAMPLE_RATE))
        time = np.arange(count) / SAMPLE_RATE
        frequency = 440.0 * 2 ** ((midi - 69) / 12)
        envelope = np.minimum(1.0, time / 0.012) * np.minimum(1.0, np.maximum(0.0, (seconds - time) / 0.08)) * np.exp(-1.65 * time / max(seconds, 0.2))
        tone = sum(weight * np.sin(2 * math.pi * frequency * multiple * time) for multiple, weight in ((1, 1), (2, 0.38), (3, 0.16), (4, 0.07)))
        end = min(length, start + count)
        audio[start:end] += (tone * envelope * gain)[: end - start]
    pcm = np.int16(np.clip(audio / max(1.0, float(np.max(np.abs(audio))) / 0.92), -1, 1) * 32767)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())


def write_xml(part: stream.Part, path: Path, title: str) -> None:
    score = stream.Score(id="score")
    score.metadata = metadata.Metadata(title=title, composer="Johann Sebastian Bach / puzzle variant")
    part.partName = title
    score.insert(0, tempo.MetronomeMark(number=BPM))
    score.insert(0, part)
    score.write("musicxml", fp=path)
    # music21 为每次导出生成随机 XML 标识符；规范化它们以保持素材字节可复现。
    xml = path.read_text(encoding="utf-8")
    xml = re.sub(r'id="P[0-9a-f]+"', 'id="P1"', xml)
    path.write_text(re.sub(r'id="I[0-9a-f]+"', 'id="I1"', xml), encoding="utf-8")


def note_label(midi: int) -> str:
    return note.Note(midi).nameWithOctave


def position_label(offset: float) -> str:
    measure, beat = int(offset // 4) + 1, offset % 4 + 1
    return f"第 {measure} 小节第 {int(beat) if beat.is_integer() else f'{beat:g}'} 拍"


def candidate_metadata(variant: int, candidate: Candidate) -> tuple[str, str]:
    if variant == 0:
        return "original", "原作：该声部的音高、时值和节奏均未改写。"
    if variant == 1:
        change = candidate.mutations[0]
        return "voice-leading", f"声部进行干扰：在{position_label(change.offset)}将 {note_label(change.old_midi)} 改为 {note_label(change.new_midi)}，扰动局部旋律连接。"
    if variant == 2:
        change = candidate.mutations[0]
        return "harmony", f"和声干扰：在{position_label(change.offset)}的稳定拍将 {note_label(change.old_midi)} 改为 {note_label(change.new_midi)}，改变该拍的和声成员。"
    harmony, leading = candidate.mutations
    return "mixed", f"混合干扰：在{position_label(harmony.offset)}将 {note_label(harmony.old_midi)} 改为 {note_label(harmony.new_midi)} 改变和声，并在{position_label(leading.offset)}将 {note_label(leading.old_midi)} 改为 {note_label(leading.new_midi)} 扰动声部连接。"


def verify_xml(path: Path, expected: tuple[Event, ...]) -> None:
    actual = part_events(converter.parse(path).parts[0])
    if signature(actual) != signature(expected):
        raise RuntimeError(f"MusicXML（音乐记谱交换格式）写入后事件不一致：{path}")


def main() -> None:
    prepared = []
    reports = []
    for piece in PIECES:
        score = corpus.parse(piece["corpus"])
        first, last = piece["measures"]
        originals = tuple(excerpt_part(part, first, last) for part in score.parts)
        source = tuple(part_events(part) for part in originals)
        if len(source) != 4 or any(not events for events in source):
            raise RuntimeError(f"{piece['id']} 未取得完整四声部")
        if piece["variants"] not in (3, 4):
            raise RuntimeError(f"{piece['id']} 的候选数量必须为 3 或 4")
        baseline = original_baseline(source)
        candidates = (
            legacy_candidate_sets(piece["id"], source, piece["variants"])
            if piece["id"] in LEGACY_MUTATIONS
            else select_candidates(piece["id"], source, baseline, piece["variants"])
        )
        for voice, voice_candidates, events in zip(VOICE_KEYS, candidates, source):
            if signature(voice_candidates[0].events) != signature(events) or shape(voice_candidates[0].events) != shape(events):
                raise RuntimeError(f"{piece['id']}/{voice} 的 variant 0 不再是原作")
        validate_harmony_changes(piece["id"], candidates, source)
        validate_candidate_semantics(piece["id"], candidates, source)
        reports.append(validate_combinations(piece["id"], candidates, source, baseline))
        prepared.append((piece, originals, source, candidates))

    OUT.mkdir(parents=True, exist_ok=True)
    piece_ids = {piece["id"] for piece in PIECES}
    # public/music 只由本脚本维护；删除过期题目目录，确保题库不会引用到陈旧资源。
    for child in OUT.iterdir():
        if child.is_dir() and (child.name.startswith("q") or child.name not in piece_ids):
            shutil.rmtree(child)

    manifest = []
    file_sets: dict[str, set[str]] = {}
    for piece, originals, source, candidates in prepared:
        qdir = OUT / piece["id"]
        qdir.mkdir(parents=True, exist_ok=True)
        expected_files: set[str] = set()
        voices = {}
        for voice_index, (voice, name, original, voice_candidates) in enumerate(zip(VOICE_KEYS, VOICE_NAMES, originals, candidates)):
            entries = []
            for variant, candidate in enumerate(voice_candidates):
                part = apply_candidate(original, candidate, variant)
                opaque_id = f"{voice}-{VARIANT_NAMES[variant]}"
                wav_path, xml_path = qdir / f"{opaque_id}.wav", qdir / f"{opaque_id}.musicxml"
                synthesize(candidate.events, float(part.highestTime), wav_path, (0.28, 0.25, 0.27, 0.31)[voice_index])
                write_xml(part, xml_path, f"{name} 候选 {variant + 1}")
                if not wav_path.exists() or wav_path.stat().st_size <= 44 or not xml_path.exists() or xml_path.stat().st_size == 0:
                    raise RuntimeError(f"{piece['id']}/{opaque_id} 的音乐资源写入失败")
                verify_xml(xml_path, candidate.events)
                if variant == 0 and signature(candidate.events) != signature(source[voice_index]):
                    raise RuntimeError(f"{piece['id']}/{voice} 的原作资源被改写")
                decoy_type, explanation = candidate_metadata(variant, candidate)
                entries.append({
                    "id": opaque_id,
                    "audio": f"/music/{piece['id']}/{opaque_id}.mp3",
                    "audioFallback": f"/music/{piece['id']}/{wav_path.name}",
                    "score": f"/music/{piece['id']}/{xml_path.name}",
                    "isOriginal": variant == 0,
                    "variant": variant,
                    "decoyType": decoy_type,
                    "explanation": explanation,
                })
                expected_files.update((wav_path.name, xml_path.name))
            voices[voice] = entries
        actual_files = {path.name for path in qdir.iterdir() if path.suffix in {".wav", ".musicxml"}}
        if actual_files != expected_files:
            raise RuntimeError(f"{piece['id']} 资源集合不完整：缺少={sorted(expected_files - actual_files)}，多余={sorted(actual_files - expected_files)}")
        file_sets[piece["id"]] = expected_files
        duration = max(float(part.highestTime) for part in originals)
        clefs = {voice: clef_label(part) for voice, part in zip(VOICE_KEYS, originals)}
        key_signature = key_signature_label(originals[0])
        manifest.append({
            "id": piece["id"], "title": piece["title"], "bwv": piece["bwv"],
            "measures": f"第 {piece['measures'][0]}–{piece['measures'][1]} 小节", "duration": round(duration * 60 / BPM, 1), "bpm": BPM,
            "genre": "chorale", "voiceCount": len(VOICE_KEYS), "clefs": clefs, "keySignature": key_signature,
            "source": piece["source"], "sourceLabel": piece["sourceLabel"], "analysis": piece["analysis"],
            "licenseNote": "巴赫作品为公共领域；编码来自 music21 参考语料库，本项目自行渲染音频。", "voices": voices,
        })

    (ROOT / "app" / "questions.generated.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    wav_count = sum(sum(name.endswith(".wav") for name in files) for files in file_sets.values())
    xml_count = sum(sum(name.endswith(".musicxml") for name in files) for files in file_sets.values())
    track_count = sum(len(voice_candidates) for _, _, _, candidates in prepared for voice_candidates in candidates)
    if (wav_count, xml_count) != (track_count, track_count):
        raise RuntimeError(f"资源总数错误：WAV={wav_count}，MusicXML={xml_count}，候选声部={track_count}")
    print(json.dumps({
        "questions": len(PIECES), "tracks": track_count, "resources": wav_count + xml_count, "wav": wav_count, "musicxml": xml_count,
        "combinationsChecked": sum(int(report["combinations"]) for report in reports), "combinationsPassed": sum(int(report["passed"]) for report in reports),
        "checks": reports,
        "thresholds": {
            "ranges": {voice: list(bounds) for voice, bounds in zip(VOICE_KEYS, VOICE_RANGES)},
            "voiceOrder": "每个时段均不得新增相对原作的声部交叉、越位或同音",
            "harmonyChange": "每条和声干扰必须改变指定稳定拍的纵向音高类集合",
            "stableDissonance": "每两拍检查一次；共同持续半拍的稳定拍不协和不得超出原作例外",
            "parallelPerfect": "原作基线事件允许保留；含干扰组合相对基线最多新增两处，且每两小节窗口至多一处",
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
