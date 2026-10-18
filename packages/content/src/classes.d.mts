import type { ClassSession } from "./types.ts";

export interface ClassesConfig {
  day: string | number;
  time?: string;
  minutes?: number;
  groups?: Record<string, { day?: string | number; time?: string; minutes?: number }>;
  group?: string;
  joinUrl?: string;
  changes?: { date: string; to?: string; cancelled?: boolean; note?: string }[];
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
