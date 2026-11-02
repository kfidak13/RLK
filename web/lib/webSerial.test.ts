import { describe, expect, it } from "vitest";
import { createLineSplitter } from "./webSerial";

describe("createLineSplitter", () => {
  it("joins lines split across chunks", () => {
    const split = createLineSplitter();
    expect(split("rea")).toEqual([]);
    expect(split("dy\r\nok")).toEqual(["ready"]);
    expect(split("\r\n")).toEqual(["ok"]);
  });

  it("returns several lines from one chunk", () =>
    expect(createLineSplitter()("ok\r\nd 300\r\n")).toEqual(["ok", "d 300"]));

  it("handles a chunk boundary between \\r and \\n", () => {
    const split = createLineSplitter();
    expect(split("ok\r")).toEqual([]);
    expect(split("\n")).toEqual(["ok"]);
  });

  it("skips blank lines", () => expect(createLineSplitter()("\r\n\nok\n")).toEqual(["ok"]));
});
