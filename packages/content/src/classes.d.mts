import type { ClassSession } from "./types.ts";

export interface ClassesConfig {
  day: string | number;
  time?: string;
  minutes?: number;
  groups?: Record<string, { day?: string | number; time?: string; minutes?: number }>;
  group?: string;
  joinUrl?: string;
  changes?: { date: string; to?: string; cancelled?: boolean; note?: string; group?: string }[];
}

export function weekday(v: string | number | undefined): number;
export function zoneOffset(local: string, timeZone: string): string;
export function zoned(local: string, timeZone: string): string;
export function pickGroup(cfg: ClassesConfig, eclassGroups?: string[]): string | undefined;
export function buildClasses(o: {
  code: string;
  cfg?: ClassesConfig;
  weeks: { index: number; name: string; start?: string; end?: string }[];
  joinUrl?: string;
  groups?: string[];
  general?: { title: string; href?: string; ext?: string }[];
  timeZone?: string;
}): ClassSession[];
export function findTime(s: string): string | undefined;
export function detectClasses(meta: unknown): (ClassesConfig & { source?: string }) | undefined;
export function setClassTime(cfg: unknown, code: string, slot: { day: string; time: string; group?: string }): unknown;
