import assert from "node:assert/strict";
import {
  drawQuestionIds,
  newGame,
  restoreGame,
  scoreGame,
  voicesForQuestion,
} from "./game.ts";

const voiceNames = ["soprano", "alto", "tenor", "bass"];

function makeCandidate(questionId, voice, variant, isOriginal = variant === 0) {
  return {
    id: `${questionId}-${voice}-${variant}`,
    audio: `/audio/${questionId}-${voice}-${variant}.mp3`,
    audioFallback: `/audio/${questionId}-${voice}-${variant}.wav`,
    score: `/score/${questionId}-${voice}-${variant}.svg`,
    isOriginal,
    variant,
    decoyType: isOriginal ? "original" : "mixed",
    explanation: "",
  };
}

function makeQuestion(id, activeVoices = voiceNames) {
  return {
    id,
    title: id,
    bwv: id,
    measures: "1–4",
    duration: 4,
    bpm: 80,
    source: "https://example.com",
    sourceLabel: "source",
    analysis: "",
    licenseNote: "",
    activeVoices,
    voices: Object.fromEntries(activeVoices.map((voice) => [
      voice,
      [makeCandidate(id, voice, 0), makeCandidate(id, voice, 1)],
    ])),
  };
}

const pool = [
  makeQuestion("q1", ["soprano", "alto", "tenor"]),
  makeQuestion("q2"),
  makeQuestion("q3"),
  makeQuestion("q4"),
  makeQuestion("q5"),
];

const firstDraw = drawQuestionIds(pool, 20260917);
assert.equal(firstDraw.length, 3);
assert.deepEqual(firstDraw, drawQuestionIds(pool, 20260917));
assert.equal(new Set(firstDraw).size, 3);

const state = newGame(pool, 20260917);
const restored = restoreGame(pool, state, 1);
assert.deepEqual(restored.questionIds, state.questionIds);
assert.equal(restored.questionIds.length, 3);
assert.equal(voicesForQuestion(pool[0]).length, 3);
assert.equal(voicesForQuestion(pool[1]).length, 4);

const selections = {
  q1: Object.fromEntries(["soprano", "alto", "tenor"].map((voice) => [voice, pool[0].voices[voice][0].id])),
  q2: Object.fromEntries(voiceNames.slice(0, 2).map((voice) => [voice, pool[1].voices[voice][0].id])),
  q3: Object.fromEntries(voiceNames.map((voice) => [voice, pool[2].voices[voice][1].id])),
};
const score = scoreGame(pool.slice(0, 3), selections);
assert.equal(score.questions, 1);
assert.equal(score.totalQuestions, 3);
assert.equal(score.voices, 5);
assert.equal(score.totalVoices, 11);
assert.ok(Math.abs(score.questionPoints - 40 / 3) < 1e-9);
assert.ok(Math.abs(score.voicePoints - (5 / 11) * 60) < 1e-9);

const fugue = makeQuestion("fugue", ["voice1", "voice2", "voice3"]);
fugue.voiceOrder = ["voice1", "voice2", "voice3"];
fugue.voiceLabels = { voice1: "第一声部", voice2: "第二声部", voice3: "第三声部" };
assert.deepEqual(voicesForQuestion(fugue), ["voice1", "voice2", "voice3"]);
const weighted = scoreGame([fugue], {
  fugue: Object.fromEntries(["voice1", "voice2", "voice3"].map((voice) => [voice, fugue.voices[voice][0].id])),
}, { completeQuestion: 25, voiceAccuracy: 75 });
assert.equal(weighted.questions, 1);
assert.equal(weighted.questionPoints, 25);
assert.equal(weighted.voicePoints, 75);

console.log("game.test.mjs passed");
