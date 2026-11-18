import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression: when the basic Latin subset also claims the combining macron (U+0304),
// Chrome draws Latvian "ā", "ī", "ē" as a letter plus a misplaced mark.
test("only the latin-ext font subset covers combining marks", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  assert.ok(faces.length >= 4);
  for (const face of faces) {
    const range = face.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "";
    if (/-latin-normal|-latin-[a-z]+-normal/.test(face) && !face.includes("latin-ext")) {
      assert.doesNotMatch(range, /U\+03[0-6][0-9A-F]/i, "basic Latin face must not claim combining marks");
    }
  }
  assert.doesNotMatch(css, /fonts\.googleapis|@fontsource-variable\/[a-z]+\/[a-z]+\.css/);
});
