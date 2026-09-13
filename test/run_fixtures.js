// regression harness for resume_parser.js — runs it against fixture resumes
// and fails if the output drifts from the recorded golden.
//
// usage:
//   node test/run_fixtures.js            check fixtures against their goldens
//   node test/run_fixtures.js --update    re-record the goldens for the current output

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const fixturesDir = path.join(__dirname, "fixtures");
const parserSource = fs.readFileSync(path.join(root, "resume_parser.js"), "utf8");

function loadParser() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(parserSource, sandbox, { filename: "resume_parser.js" });
  return sandbox;
}

function runFixture(text) {
  const sandbox = loadParser();
  const structured = sandbox.FCV_buildStructuredProfile(text);
  const flat = sandbox.FCV_deriveFlatProfile(structured);
  const confidence = sandbox.FCV_deriveFieldConfidence(structured);
  return { structured, flat, confidence };
}

function diffFlat(expected, actual) {
  const lines = [];
  const keys = new Set([...Object.keys(expected.flat || {}), ...Object.keys(actual.flat || {})]);
  for (const key of keys) {
    const before = JSON.stringify(expected.flat?.[key]);
    const after = JSON.stringify(actual.flat?.[key]);
    if (before !== after) lines.push(`    flat.${key}: ${before} -> ${after}`);
  }
  return lines;
}

function main() {
  const updateMode = process.argv.includes("--update");
  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith(".txt"));

  if (!files.length) {
    console.log("No fixtures found in test/fixtures.");
    return;
  }

  let anyFail = false;

  for (const file of files) {
    const name = file.replace(/\.txt$/, "");
    const text = fs.readFileSync(path.join(fixturesDir, file), "utf8");
    const expectedPath = path.join(fixturesDir, `${name}.expected.json`);
    const actual = runFixture(text);

    if (updateMode || !fs.existsSync(expectedPath)) {
      fs.writeFileSync(expectedPath, JSON.stringify(actual, null, 2) + "\n");
      console.log(`[ RECORDED ] ${name}`);
      continue;
    }

    const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
    const same = JSON.stringify(actual) === JSON.stringify(expected);

    if (same) {
      console.log(`[ PASS ] ${name}`);
    } else {
      anyFail = true;
      console.log(`[ FAIL ] ${name} — output no longer matches the recorded golden:`);
      const diff = diffFlat(expected, actual);
      if (diff.length) console.log(diff.join("\n"));
      else console.log("    (difference is inside structured/confidence, not the flat profile — compare the json files directly)");
    }
  }

  if (anyFail) {
    console.log("\nsome fixtures changed. if this is an intentional improvement, run with --update and review the new goldens before committing them.");
  }

  process.exitCode = anyFail ? 1 : 0;
}

main();
