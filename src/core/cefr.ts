/** CEFR levels, without the word data (settings and the worker need only these). */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export const LEVEL_LABELS: Record<CefrLevel, string> = {
  A1: "A1 · Iniciante",
  A2: "A2 · Básico",
  B1: "B1 · Intermediário",
  B2: "B2 · Intermediário avançado",
  C1: "C1 · Avançado",
  C2: "C2 · Proficiente",
};

export function isCefrLevel(value: unknown): value is CefrLevel {
  return typeof value === "string" && (CEFR_LEVELS as readonly string[]).includes(value);
}
