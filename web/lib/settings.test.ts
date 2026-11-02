import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

const stored = (value: string | null) => ({ getItem: () => value });

describe("settings", () => {
  it("returns defaults when nothing is stored", () =>
    expect(loadSettings(stored(null))).toEqual(DEFAULT_SETTINGS));

  it("returns defaults when the stored value is corrupt", () =>
    expect(loadSettings(stored("{oops"))).toEqual(DEFAULT_SETTINGS));

  it("returns defaults when storage throws", () =>
    expect(
      loadSettings({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(DEFAULT_SETTINGS));

  it("fills fields missing from older stored settings", () => {
    const s = loadSettings(stored(JSON.stringify({ calibration: { tiltDegPerStep: 0.5 } })));
    expect(s.calibration.tiltDegPerStep).toBe(0.5);
    expect(s.calibration.curveA).toBe(27.728);
    expect(s.limits).toEqual({ min: -20, max: 20 });
    expect(s.tiltDriver).toBe(0);
  });

  it("ignores a stored value of the wrong shape", () => {
    const s = loadSettings(stored(JSON.stringify({ limits: "wide", tiltDriver: 7 })));
    expect(s.limits).toEqual({ min: -20, max: 20 });
    expect(s.tiltDriver).toBe(0);
  });

  it("round-trips through storage", () => {
    let saved = "";
    const settings = { ...DEFAULT_SETTINGS, tiltDriver: 1 as const };
    saveSettings({ setItem: (_, v) => (saved = v) }, settings);
    expect(loadSettings(stored(saved))).toEqual(settings);
  });

  it("saving survives storage that throws", () =>
    expect(() =>
      saveSettings(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        DEFAULT_SETTINGS,
      ),
    ).not.toThrow());
});
