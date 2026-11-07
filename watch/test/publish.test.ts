import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { COPIES } from "../../src/orivon-copies.ts";
import { tempDir } from "../../test/support.ts";
import { loadConfig } from "../config.ts";
import { publish } from "../publish.ts";

const app = path.join(import.meta.dirname, "..", "..");

test("publishing Attila refuses to start without an Orivon checkout to compare the copied readers with", async () => {
  const config = loadConfig({ APP_DIR: app, STATE_DIR: tempDir(), PUBLISH_DIR: path.join(tempDir(), "attila") });
  assert.equal(config.orivonRepo, undefined);
  await assert.rejects(publish(config, [], "abc1234", "2026-11-07"), /ORIVON_REPO is not set/);
  assert.equal(loadConfig({ ORIVON_REPO: "/orivon" }).orivonRepo, "/orivon");
  assert.equal(loadConfig({ ORIVON_REPO: "" }).orivonRepo, undefined);
});

test("publishing Attila refuses to start when a copied reader differs from Orivon's, and builds nothing", async () => {
  const orivon = tempDir();
  const state = tempDir();
  mkdirSync(path.join(orivon, "src", "trust"), { recursive: true });
  for (const name of COPIES) cpSync(path.join(app, "src", name), path.join(orivon, "src", "trust", name));
  writeFileSync(path.join(orivon, "src", "trust", "confusables.LICENSE.txt"), "another notice\n");
  const config = loadConfig({ APP_DIR: app, ORIVON_REPO: orivon, STATE_DIR: state, PUBLISH_DIR: path.join(tempDir(), "attila") });
  await assert.rejects(publish(config, [], "abc1234", "2026-11-07"), /copy them again: confusables\.LICENSE\.txt/);
});
