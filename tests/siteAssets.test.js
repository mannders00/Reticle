import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

for (const entry of ["web/index.html", "web/team/index.html", "src/index.html"]) {
  test(`${entry} references existing local assets`, () => {
    const html = readFileSync(entry, "utf8");
    const base = dirname(entry);
    const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((value) => !/^(?:https?:|mailto:|#|\/)/.test(value))
      .map((value) => value.split(/[?#]/, 1)[0]);

    for (const reference of references) {
      const path = resolve(base, reference);
      assert.ok(existsSync(path), `${entry} references missing asset ${reference}`);
    }
  });
}
