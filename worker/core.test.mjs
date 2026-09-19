import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GAME_RULES,
  drawQuestions,
  publicQuestion,
  scoreSelections,
  seededRandom,
  validateRules,
} from "./core.mjs";

function question(id, genre, voiceCount = 3) {
  const voiceOrder = Array.from({ length: voiceCount }, (_, index) => `voice${index + 1}`);
  const voices = Object.fromEntries(voiceOrder.map((voice) => [
    voice,
    [
      { id: `${voice}-original`, optionId: `${voice}-original`, audio: `${id}/${voice}/a.mp3`, isOriginal: true, variant: 0, decoyType: "original" },
      { id: `${voice}-decoy`, optionId: `${voice}-decoy`, audio: `${id}/${voice}/b.mp3`, isOriginal: false, variant: 1, decoyType: "voice-leading" },
      { id: `${voice}-harmony`, optionId: `${voice}-harmony`, audio: `${id}/${voice}/c.mp3`, isOriginal: false, variant: 2, decoyType: "harmony" },
    ],
  ]));
  return { id, title: id, genre, voiceCount, voiceOrder, voices };
}

test("规则默认值严格满足三道众赞歌和 25/75 权重", () => {
  const result = validateRules(DEFAULT_GAME_RULES, { chorale: 5, fugue: 0, other: 0 });
  assert.equal(result.ok, true);
});

test("规则会拒绝配额总和或众赞歌库存不足", () => {
  const result = validateRules({ ...DEFAULT_GAME_RULES, allocation: { chorale: 4, fugue: 0, other: 0 } }, { chorale: 1, fugue: 0, other: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("配额总和")));
  assert.ok(result.errors.some((error) => error.includes("chorale")));
});

test("抽题按众赞歌配额并能用种子复现", () => {
  const pool = [question("c1", "chorale"), question("c2", "chorale"), question("c3", "chorale"), question("f1", "fugue", 4)];
  const first = drawQuestions(pool, DEFAULT_GAME_RULES, seededRandom(42));
  const second = drawQuestions(pool, DEFAULT_GAME_RULES, seededRandom(42));
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.deepEqual(first.map((item) => item.genre).sort(), ["chorale", "chorale", "chorale"]);
  assert.equal(first.length, 3);
});

test("公开题目会移除正确答案字段", () => {
  const result = publicQuestion(question("c1", "chorale"));
  assert.equal(result.voices.voice1[0].isOriginal, undefined);
  assert.equal(result.voices.voice1[0].decoyType, undefined);
  assert.equal(result.voices.voice1[0].explanation, undefined);
  assert.equal(result.voices.voice1[0].variant, undefined);
  assert.equal(result.voices.voice1[0].id, "voice1-original");
});

test("评分按完整题目 25% 与声部比例 75% 计算", () => {
  const questions = [question("c1", "chorale"), question("c2", "chorale", 4), question("c3", "chorale")];
  const selections = {
    c1: { voice1: "voice1-original", voice2: "voice2-original", voice3: "voice3-original" },
    c2: { voice1: "voice1-original", voice2: "voice2-original", voice3: "voice3-decoy", voice4: "voice4-original" },
    c3: { voice1: "voice1-decoy", voice2: "voice2-original", voice3: "voice3-original" },
  };
  const score = scoreSelections(questions, selections, DEFAULT_GAME_RULES);
  assert.equal(score.questions, 1);
  assert.equal(score.totalQuestions, 3);
  assert.equal(score.voices, 8);
  assert.equal(score.totalVoices, 10);
  assert.ok(Math.abs(score.questionPoints - 25 / 3) < 1e-9);
  assert.equal(score.voicePoints, 60);
});
