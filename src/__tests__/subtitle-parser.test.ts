import { describe, expect, it } from "vitest";
import { activeCues, decodeSubtitleFile, MAX_SUBTITLE_BYTES, parseSubtitles } from "../core/subtitles.ts";

const srt = "\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nOlá, João!\r\nSegunda linha.\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nAté amanhã.\r\n";

describe("subtitle imports", () => {
  it("preserves accented UTF-8, BOM, CRLF and multiline SRT", () => {
    const parsed = parseSubtitles(srt);
    expect(parsed).toEqual([
      { start: 1.25, end: 3.5, text: "Olá, João!\nSegunda linha." },
      { start: 4, end: 6, text: "Até amanhã." },
    ]);
    const bytes = new TextEncoder().encode(srt);
    expect(decodeSubtitleFile(bytes.buffer)).toEqual(parsed);
  });

  it("reads WebVTT identifiers, settings, notes and formatting without executing HTML", () => {
    const result = parseSubtitles("WEBVTT - exemplo\nLanguage: pt-BR\n\nNOTE legenda\nignored\n\nSTYLE\n::cue { color:red; }\n\nREGION\nid:main\n\nidentifier\n00:01.000 --> 00:03.200 align:start position:10%\n<v João><b>Ação &amp; coração.</b></v>\n<img src=x onerror=alert(1)>");
    expect(result).toEqual([{ start: 1, end: 3.2, text: "Ação & coração.\n<img src=x onerror=alert(1)>" }]);
  });

  it.each([
    "", "this is not subtitles", "WEBVTT\n\nNOTE nothing here", "1\n00:00:60,000 --> 00:01:01,000\nNo",
    "1\n00:61:00,000 --> 01:02:00,000\nNo", "1\n00:00:04,000 --> 00:00:02,000\nNo",
    "1\n00:00:02,000 --> 00:00:02,000\nNo", "1\n00:00:01,000 --> 00:00:02,000",
    "1\n00:00:01,000 --> 00:00:02,000\nGood\n\n2\ncorrupt time\nMissing",
  ])("rejects malformed input instead of dropping a missing cue: %s", (text) => {
    expect(() => parseSubtitles(text)).toThrow();
  });

  it("rejects oversized files before decoding and invalid UTF-8", () => {
    expect(() => decodeSubtitleFile(new ArrayBuffer(MAX_SUBTITLE_BYTES + 1))).toThrow(/2 MB/);
    expect(() => decodeSubtitleFile(new Uint8Array([0xc3, 0x28]).buffer)).toThrow(/UTF-8/);
  });

  it("sorts unsorted input and retains simultaneous cues", () => {
    const cues = parseSubtitles("2\n00:00:03,000 --> 00:00:05,000\nSecond\n\n1\n00:00:01,000 --> 00:00:04,000\nFirst");
    expect(activeCues(cues, 3).map(cue => cue.text)).toEqual(["First", "Second"]);
  });
});

describe("subtitle clock", () => {
  const cue = [{ start: 10, end: 12, text: "Hello" }];
  it("has inclusive start, exclusive end and no fallback to expired cues", () => {
    expect(activeCues(cue, 9.99)).toEqual([]);
    expect(activeCues(cue, 10)).toEqual(cue);
    expect(activeCues(cue, 12)).toEqual([]);
    expect(activeCues(cue, NaN)).toEqual([]);
  });
  it("positive offset delays; negative offset advances by exactly half a second", () => {
    expect(activeCues(cue, 10, 0.5)).toEqual([]);
    expect(activeCues(cue, 10.5, 0.5)).toEqual(cue);
    expect(activeCues(cue, 9.5, -0.5)).toEqual(cue);
    expect(activeCues(cue, 11.5, -0.5)).toEqual([]);
  });
});
