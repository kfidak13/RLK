import { describe, expect, it } from "vitest";
import { checkGrid, DEFAULT_GRID, estimateSeconds, sweepPositions } from "./sweep";

const limits = { min: -20, max: 20 };

describe("sweepPositions", () => {
  it("default grid is 651 points", () =>
    expect(sweepPositions(DEFAULT_GRID)).toHaveLength(651));

  it("starts at the low corner and reverses each row", () => {
    const p = sweepPositions(DEFAULT_GRID);
    expect(p[0]).toEqual({ pan: -15, tilt: -10 });
    expect(p[30]).toEqual({ pan: 15, tilt: -10 });
    expect(p[31]).toEqual({ pan: 15, tilt: -9 });
  });

  it("tilt never moves down", () => {
    const p = sweepPositions(DEFAULT_GRID);
    for (let i = 1; i < p.length; i++)
      expect(p[i].tilt).toBeGreaterThanOrEqual(p[i - 1].tilt);
  });

  it("step sizes never overshoot the range", () => {
    const p = sweepPositions({ ...DEFAULT_GRID, tiltMin: -10, tiltMax: 10, tiltStep: 3 });
    expect(Math.max(...p.map((q) => q.tilt))).toBe(8);
  });

  it("moves only one axis between neighbouring points", () => {
    const p = sweepPositions({ ...DEFAULT_GRID, panStep: 2 });
    for (let i = 1; i < p.length; i++) {
      const moved = [p[i].pan !== p[i - 1].pan, p[i].tilt !== p[i - 1].tilt];
      expect(moved.filter(Boolean)).toHaveLength(1);
    }
  });

  it("uneven pan steps stay on the same columns in both directions", () => {
    const p = sweepPositions({
      panMin: 0,
      panMax: 10,
      panStep: 3,
      tiltMin: 0,
      tiltMax: 1,
      tiltStep: 1,
    });
    expect(p.map((q) => q.pan)).toEqual([0, 3, 6, 9, 9, 6, 3, 0]);
  });
});

describe("checkGrid", () => {
  it("refuses a grid past the tilt limit and names it", () => {
    expect(checkGrid(DEFAULT_GRID, 15, limits)).toContain("20");
    expect(checkGrid(DEFAULT_GRID, -15, limits)).toContain("-20");
  });

  it("accepts a grid that exactly reaches the limit", () =>
    expect(checkGrid(DEFAULT_GRID, 10, limits)).toBeNull());

  it.each([
    { panStep: 0 },
    { tiltStep: -1 },
    { panStep: 1.5 },
    { panMin: 20 },
    { tiltMax: NaN },
    { tiltMin: 0.5 },
    { panMin: -101, panMax: 100 },
    { tiltMin: -100000, tiltMax: 100000, panStep: 1 },
  ])("refuses invalid grid %o", (bad) =>
    expect(checkGrid({ ...DEFAULT_GRID, ...bad }, 0, limits)).toEqual(expect.any(String)));
});

describe("checkGrid limits", () => {
  it.each([
    { min: NaN, max: 20 },
    { min: -20, max: NaN },
    { min: 5, max: 20 },
    { min: -20, max: -5 },
    { min: -1.5, max: 20 },
  ])("refuses unusable limits %o", (bad) =>
    expect(checkGrid(DEFAULT_GRID, 0, bad)).toEqual(expect.any(String)));
});

describe("estimateSeconds", () => {
  it("estimates the default at about 6 minutes", () => {
    const s = estimateSeconds(DEFAULT_GRID);
    expect(s).toBeGreaterThan(300);
    expect(s).toBeLessThan(380);
  });
});
