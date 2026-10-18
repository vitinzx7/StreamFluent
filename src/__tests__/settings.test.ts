import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_SETTINGS,
  SettingsRepository,
  getLangPair,
  isLanguageDirection,
  normalizeSettings,
} from "../core/settings.ts";

import { installStudyWorker } from "./helpers/study-worker.ts";

let worker: ReturnType<typeof installStudyWorker>;
let store: Record<string, unknown>;

beforeEach(() => {
  worker = installStudyWorker();
  store = worker.storage;
});

describe("normalizeSettings", () => {
  it("falls back to the default for missing or malformed values", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("en-pt")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects a direction that is not one of the supported pairs", () => {
    expect(normalizeSettings({ direction: "en-es" })).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps a subtitle position that would put it off screen", () => {
    expect(normalizeSettings({ subtitleBottom: -50 }).subtitleBottom).toBe(2);
    expect(normalizeSettings({ subtitleBottom: 500 }).subtitleBottom).toBe(88);
    expect(normalizeSettings({ subtitleBottom: 40 }).subtitleBottom).toBe(40);
  });

  it("falls back to the default position for a non-numeric value", () => {
    expect(normalizeSettings({ subtitleBottom: "40" }).subtitleBottom).toBe(12);
    expect(normalizeSettings({ subtitleBottom: NaN }).subtitleBottom).toBe(12);
  });

  it("keeps highlightNewWords only when it is a boolean, defaulting to on", () => {
    expect(normalizeSettings({ highlightNewWords: false }).highlightNewWords).toBe(false);
    expect(normalizeSettings({ highlightNewWords: "no" }).highlightNewWords).toBe(true);
    expect(normalizeSettings({}).highlightNewWords).toBe(true);
  });

  it("keeps showTranslation only when it is a boolean", () => {
    expect(normalizeSettings({ showTranslation: false }).showTranslation).toBe(false);
    expect(normalizeSettings({ showTranslation: "no" }).showTranslation).toBe(true);
    expect(normalizeSettings({}).showTranslation).toBe(true);
  });

  it("keeps a valid direction", () => {
    expect(normalizeSettings({ direction: "pt-en" })).toEqual({
      direction: "pt-en",
      showTranslation: true,
      subtitleBottom: 12,
      highlightNewWords: true,
      highlightSpecialWords: false,
      autoPause: false,
      level: null,
    });
  });

  it("drops unknown keys", () => {
    expect(normalizeSettings({ direction: "pt-en", nope: 1 })).toEqual({
      direction: "pt-en",
      showTranslation: true,
      subtitleBottom: 12,
      highlightNewWords: true,
      highlightSpecialWords: false,
      autoPause: false,
      level: null,
    });
  });
});

describe("isLanguageDirection", () => {
  it("accepts only the two supported directions", () => {
    expect(isLanguageDirection("en-pt")).toBe(true);
    expect(isLanguageDirection("pt-en")).toBe(true);
    expect(isLanguageDirection("pt-pt")).toBe(false);
    expect(isLanguageDirection(undefined)).toBe(false);
  });
});

describe("getLangPair", () => {
  it("maps each direction to source and target codes", () => {
    expect(getLangPair("en-pt")).toEqual({ source: "en", target: "pt-BR" });
    expect(getLangPair("pt-en")).toEqual({ source: "pt-BR", target: "en" });
  });
});

describe("SettingsRepository", () => {
  it("returns the default when nothing is stored", async () => {
    expect(await SettingsRepository.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists a saved direction", async () => {
    await SettingsRepository.save({ direction: "pt-en" });

    expect(store.settings).toEqual({
      direction: "pt-en",
      showTranslation: true,
      subtitleBottom: 12,
      highlightNewWords: true,
      highlightSpecialWords: false,
      autoPause: false,
      level: null,
    });
    expect(await SettingsRepository.get()).toEqual({
      direction: "pt-en",
      showTranslation: true,
      subtitleBottom: 12,
      highlightNewWords: true,
      highlightSpecialWords: false,
      autoPause: false,
      level: null,
    });
  });

  it("ignores an unsupported direction instead of storing it", async () => {
    await expect(SettingsRepository.save({ direction: "de-en" as never })).rejects.toThrow();

    expect(await SettingsRepository.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps the direction when only the toggle is saved", async () => {
    await SettingsRepository.save({ direction: "pt-en" });
    await SettingsRepository.save({ showTranslation: false });

    expect(await SettingsRepository.get()).toEqual({
      direction: "pt-en",
      showTranslation: false,
      subtitleBottom: 12,
      highlightNewWords: true,
      highlightSpecialWords: false,
      autoPause: false,
      level: null,
    });
  });

  it("notifies subscribers when the popup changes the direction", async () => {
    const seen: string[] = [];
    SettingsRepository.onChange((s) => seen.push(s.direction));

    await SettingsRepository.save({ direction: "pt-en" });

    expect(seen[seen.length - 1]).toEqual("pt-en");
  });

  it("keeps the dragged position when the popup saves other settings", async () => {
    await SettingsRepository.save({ subtitleBottom: 40 });
    await SettingsRepository.save({ direction: "pt-en", showTranslation: false });

    expect((await SettingsRepository.get()).subtitleBottom).toBe(40);
  });

  it("stops notifying after unsubscribe", async () => {
    const seen: string[] = [];
    const off = SettingsRepository.onChange((s) => seen.push(s.direction));
    off();

    await SettingsRepository.save({ direction: "pt-en" });

    expect(seen).toEqual([]);
  });

  it("ignores changes to other storage keys", async () => {
    const seen: string[] = [];
    SettingsRepository.onChange((s) => seen.push(s.direction));

    await chrome.storage.local.set({ phrases: [] });

    expect(seen).toEqual([]);
  });
});

describe("serialized settings", () => {
  it("keeps disjoint patches from simultaneous clients", async () => {
    await Promise.all([
      SettingsRepository.save({ subtitleBottom: 45 }),
      SettingsRepository.save({ highlightSpecialWords: true }),
    ]);
    expect(await SettingsRepository.get()).toMatchObject({ subtitleBottom: 45, highlightSpecialWords: true });
  });

  it("toggles twice against committed state even before either reply arrives", async () => {
    await Promise.all([SettingsRepository.toggleAutoPause(), SettingsRepository.toggleAutoPause()]);
    expect((await SettingsRepository.get()).autoPause).toBe(false);
  });

  it("rejects failed persistence and keeps the confirmed settings", async () => {
    await SettingsRepository.get();
    worker.failNextWrite();
    await expect(SettingsRepository.save({ autoPause: true })).rejects.toThrow();
    expect((await SettingsRepository.get()).autoPause).toBe(false);
  });

  it("keeps a valid level and drops anything else", () => {
    expect(normalizeSettings({ level: "B1" }).level).toBe("B1");
    for (const level of ["b1", "D1", 3, ""]) expect(normalizeSettings({ level }).level).toBeNull();
  });

  it("ignores inherited preference fields", () => {
    expect(normalizeSettings(Object.create({ direction: "pt-en", autoPause: true }))).toEqual(DEFAULT_SETTINGS);
  });
});
