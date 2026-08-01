import assert from "node:assert/strict";
import test from "node:test";

import { kindsByCategory } from "../src/canvas/nodes/kinds.js";

test("generic shapes appear before infrastructure-specific palette groups", () => {
  const groups = kindsByCategory();
  assert.equal(groups[0].id, "misc");
  assert.deepEqual(groups[0].kinds.map(({ id }) => id), ["generic", "note", "box"]);
});
