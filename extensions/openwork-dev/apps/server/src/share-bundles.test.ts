import { describe, expect, test } from "bun:test";

import { normalizeSharedBundleFetchUrl } from "./share-bundles.js";

describe("normalizeSharedBundleFetchUrl", () => {
  test("rewrites human share pages to the canonical data endpoint", () => {
    const normalized = normalizeSharedBundleFetchUrl(
      new URL("https://share.openwork.software/b/01ARZ3NDEKTSV4RRFFQ69G5FAV?format=json"),
    );

    expect(normalized.toString()).toBe("https://share.openwork.software/b/01ARZ3NDEKTSV4RRFFQ69G5FAV/data");
  });

  test("keeps existing data endpoints and strips redundant format", () => {
    const normalized = normalizeSharedBundleFetchUrl(
      new URL("https://share.openwork.software/b/01ARZ3NDEKTSV4RRFFQ69G5FAV/data?format=json&download=1"),
    );

    expect(normalized.toString()).toBe(
      "https://share.openwork.software/b/01ARZ3NDEKTSV4RRFFQ69G5FAV/data?download=1",
    );
  });
});
