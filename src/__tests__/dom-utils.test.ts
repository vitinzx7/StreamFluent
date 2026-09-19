/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  parseSeasonEpisode,
  hideNativeSubtitles,
  restoreNativeSubtitles,
  findSubtitleRoot,
} from "../core/dom-utils.ts";

describe("parseSeasonEpisode", () => {
  it("parses compact format S02E04", () => {
    const result = parseSeasonEpisode("The Crown: Season 2, Episode 4");
    expect(result).toEqual({ season: 2, episode: 4 });
  });

  it("parses S2E4 without leading zeros", () => {
    const result = parseSeasonEpisode("Show S2E4 Title");
    expect(result).toEqual({ season: 2, episode: 4 });
  });

  it("parses 'Season 2 Episode 4'", () => {
    const result = parseSeasonEpisode("Season 2 Episode 4");
    expect(result).toEqual({ season: 2, episode: 4 });
  });

  it("returns null for both when no pattern found", () => {
    const result = parseSeasonEpisode("Just a Movie Title");
    expect(result).toEqual({ season: null, episode: null });
  });

  it("handles case insensitivity", () => {
    const result = parseSeasonEpisode("season 5 episode 12");
    expect(result).toEqual({ season: 5, episode: 12 });
  });

  it("parses S01E01", () => {
    const result = parseSeasonEpisode("S01E01");
    expect(result).toEqual({ season: 1, episode: 1 });
  });
});

describe("hideNativeSubtitles / restoreNativeSubtitles", () => {
  afterEach(() => {
    restoreNativeSubtitles();
    document.body.innerHTML = "";
  });

  it("marks the container instead of touching its inline style", () => {
    const container = document.createElement("div");
    container.style.display = "block";
    hideNativeSubtitles(container);

    expect(container.hasAttribute("data-streamfluent-native-hidden")).toBe(true);
    // The players rewrite inline styles on every cue, so we must not rely on them.
    expect(container.style.display).toBe("block");
  });

  it("injects a single stylesheet that overrides inline styles", () => {
    hideNativeSubtitles(document.createElement("div"));
    hideNativeSubtitles(document.createElement("div"));

    const styles = document.querySelectorAll("#streamfluent-native-hidden");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain("opacity: 0 !important");
    // display:none would collapse the box the player measures to place cues.
    expect(styles[0].textContent).not.toContain("display: none");
  });

  it("restores every hidden container and removes the stylesheet", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    hideNativeSubtitles(a);
    hideNativeSubtitles(b);

    restoreNativeSubtitles();

    expect(a.hasAttribute("data-streamfluent-native-hidden")).toBe(false);
    expect(b.hasAttribute("data-streamfluent-native-hidden")).toBe(false);
    expect(document.getElementById("streamfluent-native-hidden")).toBeNull();
  });

  it("does nothing when nothing was hidden", () => {
    expect(() => restoreNativeSubtitles()).not.toThrow();
  });
});

describe("findSubtitleRoot", () => {
  const selectors = ["[class*='timedtext']"];

  it("climbs to the outermost ancestor still matching a selector", () => {
    document.body.innerHTML = `
      <div class="netflix-player">
        <div class="player-timedtext">
          <div class="player-timedtext-text-container">
            <span>hello</span>
          </div>
        </div>
      </div>
    `;
    const inner = document.querySelector<HTMLElement>(".player-timedtext-text-container")!;

    expect(findSubtitleRoot(inner, selectors)).toBe(document.querySelector(".player-timedtext"));
  });

  it("returns the container itself when no ancestor matches", () => {
    document.body.innerHTML = `
      <div class="netflix-player"><div class="player-timedtext"></div></div>
    `;
    const only = document.querySelector<HTMLElement>(".player-timedtext")!;

    expect(findSubtitleRoot(only, selectors)).toBe(only);
  });

  it("stops at the first non-matching ancestor", () => {
    document.body.innerHTML = `
      <div class="player-timedtext outer">
        <div class="wrapper">
          <div class="player-timedtext inner"></div>
        </div>
      </div>
    `;
    const inner = document.querySelector<HTMLElement>(".player-timedtext.inner")!;

    expect(findSubtitleRoot(inner, selectors)).toBe(inner);
  });
});
