import { type Calibration, DEFAULT_CALIBRATION } from "./convert";
import { DEFAULT_GRID, type Grid, type TiltLimits } from "./sweep";

export type Settings = {
  calibration: Calibration;
  limits: TiltLimits;
  tiltDriver: 0 | 1;
  grid: Grid;
};

export const DEFAULT_SETTINGS: Settings = {
  calibration: DEFAULT_CALIBRATION,
  limits: { min: -20, max: 20 },
  tiltDriver: 0,
  grid: DEFAULT_GRID,
};

const KEY = "rlk-settings";

// Takes each default field's stored value if it's a number; null only where the default is null.
function mergeNumbers<T extends object>(defaults: T, stored: unknown): T {
  if (typeof stored !== "object" || stored === null) return defaults;
  const merged = { ...defaults } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = (stored as Record<string, unknown>)[key];
    if (Number.isFinite(value) || (fallback === null && value === null))
      merged[key] = value;
  }
  return merged as T;
}

export function loadSettings(storage: Pick<Storage, "getItem">): Settings {
  try {
    const stored = JSON.parse(storage.getItem(KEY) ?? "{}");
    return {
      calibration: mergeNumbers(DEFAULT_CALIBRATION, stored.calibration),
      limits: mergeNumbers(DEFAULT_SETTINGS.limits, stored.limits),
      tiltDriver: stored.tiltDriver === 1 ? 1 : 0,
      grid: mergeNumbers(DEFAULT_GRID, stored.grid),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(storage: Pick<Storage, "setItem">, s: Settings): void {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Blocked or full storage only costs remembering settings between visits.
  }
}

export function browserStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
}
