import type { Plan } from "./types.ts";

export function isoWeekRange(year: number, week: number): { start: string; end: string };
export function parsePlan(src: string, file: string): Plan;
export function setTask(src: string, line: number, done: boolean): string | null;
