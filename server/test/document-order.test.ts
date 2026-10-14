import assert from "node:assert/strict";
import test from "node:test";
import { compareDocumentTitles } from "@typesync/shared";

test("alphabetical titles follow PostgreSQL UTF-8 C order across supplementary characters", () => {
  const titles = ["😀", "\uE000", "éclair", "e\u0301clair", "apple", "aa", "a", "Apple", "Same", "Same"];
  assert.deepEqual(titles.sort(compareDocumentTitles), [
    "Apple", "Same", "Same", "a", "aa", "apple", "e\u0301clair", "éclair", "\uE000", "😀",
  ]);
});
