import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { walkSourceFiles } from "./walk.js";

test("walk skips vendor tree and scans lib", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rulecloud-walk-"));
  mkdirSync(path.join(root, "vendor", "bundle", "ruby"), { recursive: true });
  writeFileSync(path.join(root, "vendor", "bundle", "ruby", "foo.rb"), "puts 1\n");
  mkdirSync(path.join(root, "lib"), { recursive: true });
  writeFileSync(path.join(root, "lib", "main.dart"), "void main() {}\n");

  const relFiles = walkSourceFiles(root).map((abs) =>
    path.relative(root, abs).replace(/\\/g, "/"),
  );

  assert.equal(
    relFiles.some((f) => f.includes("vendor")),
    false,
    `vendor should be skipped, got: ${relFiles.join(", ")}`,
  );
  assert.ok(relFiles.includes("lib/main.dart"));
});

test("walk respects .gitignore", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rulecloud-walk-"));
  writeFileSync(path.join(root, ".gitignore"), "generated/**\n");
  mkdirSync(path.join(root, "generated", "out"), { recursive: true });
  writeFileSync(path.join(root, "generated", "out", "x.js"), "x");
  writeFileSync(path.join(root, "app.js"), "x");

  const relFiles = walkSourceFiles(root).map((abs) =>
    path.relative(root, abs).replace(/\\/g, "/"),
  );

  assert.equal(relFiles.includes("app.js"), true);
  assert.equal(relFiles.some((f) => f.startsWith("generated/")), false);
});