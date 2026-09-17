/* eslint-disable @typescript-eslint/no-explicit-any -- 该文件为 JavaScript 纯函数模块提供运行时 JSON 边界声明 */
export const CATEGORIES: readonly string[];
export const DEFAULT_GAME_RULES: {
  readonly questionsPerGame: 3;
  readonly allocation: { readonly chorale: 1; readonly fugue: 1; readonly other: 1 };
  readonly scoreWeights: { readonly completeQuestion: 40; readonly voiceAccuracy: 60 };
  readonly revision: 1;
};
export function cloneRules(rules?: unknown): any;
export function validateRules(input: unknown, inventory?: Record<string, number>): { ok: boolean; rules: any; errors?: string[] };
export function shuffle<T>(items: T[], random?: () => number): T[];
export function seededRandom(seed: number | string): () => number;
export function drawQuestions<T>(questions: T[], rules: any, random?: () => number): T[];
export function publicCandidate(candidate: any): any;
export function publicQuestion(question: any): any;
export function adminQuestion(question: any): any;
export function scoreSelections(questions: any[], selections: any, rules: any): any;
