import { describe, it, expect } from "vitest";
import { parseSeasonEpisode } from "../core/dom-utils.ts";

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
