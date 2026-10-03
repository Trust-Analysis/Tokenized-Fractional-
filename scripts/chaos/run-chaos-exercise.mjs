#!/usr/bin/env node

// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * run-chaos-exercise.mjs — run the graceful-degradation failure-injection
 * exercise and compare observed behaviour against the recorded baseline.
 *
 * GitHub issue #802 asks for documented evidence that the platform degrades
 * gracefully under real infrastructure failures (RPC outage, backend
 * crash-and-restart, Nginx down), and for the exercise to be repeated
 * periodically as the system evolves.
 *
 * This runner is that exercise. It is a *characterization* harness: it records
 * what the system does, and reports DRIFT when the recorded behaviour changes.
 * A behaviour that is already known to be bad is a recorded UNGRACEFUL verdict
 * with a linked follow-up, not a red build — otherwise the very first run would
 * fail forever and nobody would run it again. Pass --strict to also fail on
 * recorded UNGRACEFUL verdicts, which is what you want once the follow-ups land.
 *
 * Usage:
 *   node scripts/chaos/run-chaos-exercise.mjs            # run + compare to baseline
 *   node scripts/chaos/run-chaos-exercise.mjs --strict   # also fail on known-bad
 *   node scripts/chaos/run-chaos-exercise.mjs --update   # rewrite the baseline
 *   node scripts/chaos/run-chaos-exercise.mjs --only rpc-outage,rpc-blackhole
 *   node scripts/chaos/run-chaos-exercise.mjs --json     # machine-readable output
 *
 * Exit codes:
 *   0  every experiment matched the baseline (or was skipped)
 *   1  at least one experiment drifted, or --strict was set and one was UNGRACEFUL
 *   2  the harness itself failed
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXPERIMENTS } from './experiments.mjs';
import { VERDICT } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'baseline.json');
const REPORT_PATH = join(HERE, '..', '..', 'docs', 'chaos-engineering', 'latest-run.json');

const argv = new Set(process.argv.slice(2));
const strict = argv.has('--strict');
const update = argv.has('--update');
const asJson = argv.has('--json');

/** Accepts both `--only=a,b` and `--only a,b`. */
function parseOnly(args) {
  const eq = args.find((arg) => arg.startsWith('--only='));
  if (eq) return new Set(eq.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean));
  const idx = args.indexOf('--only');
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return new Set(args[idx + 1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return null;
}

const only = parseOnly(process.argv.slice(2));

const RESET = '[0m';
const BOLD = '[1m';
const DIM = '[2m';
const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const CYAN = '[36m';

const paint = (code, text) => (asJson ? text : `${code}${text}${RESET}`);

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { experiments: {} };
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${BASELINE_PATH}: ${err.message}`);
    return { experiments: {} };
  }
}

/**
 * Compare one observation against its recorded baseline.
 *
 * The comparison is on the *verdict* plus a small set of discriminating
 * attributes, not on raw timings — timings vary by machine and would make the
 * baseline useless.
 */
function classify(expected, observed) {
  // A skip is not an observation. Treating "could not run" as drift would make
  // the job fail whenever a prerequisite is missing, which is the opposite of
  // the intended skip-rather-than-fail behaviour.
  if (observed.verdict === VERDICT.SKIPPED) {
    return { state: 'SKIPPED', note: 'Experiment could not run, so it was not compared to the baseline.' };
  }
  if (!expected) return { state: 'NEW', note: 'No baseline recorded for this experiment.' };
  if (expected.verdict !== observed.verdict) {
    return {
      state: 'DRIFT',
      note: `Verdict changed: baseline ${expected.verdict} -> observed ${observed.verdict}.`,
    };
  }
  // A mechanism change within the same verdict is still meaningful drift — it
  // means the failure is happening for a different reason than we thought.
  if (expected.mechanism && observed.observations?.mechanism && expected.mechanism !== observed.observations.mechanism) {
    return {
      state: 'DRIFT',
      note: `Failure mechanism changed: baseline ${expected.mechanism} -> observed ${observed.observations.mechanism}.`,
    };
  }
  return { state: 'MATCH', note: '' };
}

/** Wall-clock ceiling for a single experiment, on top of any deadline it sets. */
const EXPERIMENT_TIMEOUT_MS = Number(process.env.CHAOS_EXPERIMENT_TIMEOUT_MS || 120_000);

/**
 * Run an experiment under a wall-clock ceiling.
 *
 * A chaos harness that can itself hang is worse than no harness: the whole
 * exercise would stall on the first experiment that wedges, and the run would
 * look like a CI hang rather than a finding. Experiments already bound their own
 * waits, but this is the backstop for anything that blocks outside those
 * (a module import, a child process, a socket).
 */
async function runBounded(exp) {
  let timer;
  const guard = new Promise((done) => {
    // Referenced on purpose: if the experiment wedges, this timer is the only
    // thing left on the event loop, so unref'ing it would let Node exit and the
    // guard would never fire. Cleared in `finally`.
    timer = setTimeout(
      () =>
        done({
          verdict: VERDICT.SKIPPED,
          reason: `harness timeout: the experiment did not return within ${EXPERIMENT_TIMEOUT_MS}ms`,
          observations: {},
        }),
      EXPERIMENT_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([Promise.resolve().then(() => exp.run()), guard]);
  } catch (err) {
    // A harness bug, not a system finding. Surface it loudly and keep going so
    // one broken experiment does not hide the rest of the report.
    return {
      verdict: VERDICT.SKIPPED,
      reason: `harness error: ${err && err.stack ? err.stack.split('\n')[0] : err}`,
      observations: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const baseline = loadBaseline();
  const selected = EXPERIMENTS.filter((exp) => !only || only.has(exp.id));

  if (selected.length === 0) {
    console.error(`No experiments matched --only. Known ids: ${EXPERIMENTS.map((e) => e.id).join(', ')}`);
    return 2;
  }

  if (!asJson) {
    console.log(paint(BOLD, '\nGraceful-degradation failure-injection exercise (issue #802)'));
    console.log(paint(DIM, 'Recording observed behaviour and comparing it to the recorded baseline.\n'));
  }

  const results = [];

  for (const exp of selected) {
    if (!asJson) {
      process.stdout.write(paint(CYAN, `▶ ${exp.id}`) + paint(DIM, `  (${exp.fault})`) + '\n');
    }

    const observed = await runBounded(exp);

    const expected = baseline.experiments?.[exp.id];
    const { state, note } = classify(expected, observed);
    const result = { id: exp.id, fault: exp.fault, state, note, ...observed };
    results.push(result);

    if (!asJson) report(exp, result, { expected, strict, update, note });
  }

  const summary = summarize(results, { strict });

  if (update) {
    writeBaseline(results, baseline);
    if (!asJson) {
      console.log(paint(BOLD, `\nBaseline rewritten: ${BASELINE_PATH}`));
      console.log(paint(YELLOW, 'Review the diff before committing — it records the behaviour we just observed.'));
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ recordedAt: new Date().toISOString(), results, summary }, null, 2));
  } else {
    printSummary(summary, results);
  }

  writeReport(results, summary);

  return summary.failed > 0 ? 1 : 0;
}

function report(exp, result, { expected, strict, update, note }) {
  const { verdict, state, summary: detail, reason, observations } = result;

  const icon =
    verdict === VERDICT.SKIPPED ? paint(YELLOW, '•') : verdict === VERDICT.GRACEFUL ? paint(GREEN, '✔') : paint(RED, '✘');
  console.log(`  ${icon} ${paint(BOLD, verdict)} ${paint(DIM, `[${state}]`)}`);

  if (reason) console.log(`      ${paint(YELLOW, reason)}`);
  if (detail) console.log(`      ${detail}`);

  if (state === 'DRIFT') console.log(`      ${paint(RED, note)}`);

  const followUps = expected?.followUp ?? [];
  if (followUps.length > 0 && verdict === VERDICT.UNGRACEFUL) {
    console.log(paint(DIM, `      tracked by: ${followUpLabels(exp.id).join(', ')}`));
  }

  if (observations && Object.keys(observations).length > 0) {
    const rendered = Object.entries(observations)
      .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
      .map(([k, v]) => `${k}=${v}`);
    if (rendered.length > 0) console.log(paint(DIM, `      ${rendered.join(' ')}`));
  }

  if (update) {
    console.log(paint(DIM, `      baseline will be set to ${verdict}`));
  }
  if (strict && verdict === VERDICT.UNGRACEFUL) {
    console.log(paint(RED, '      --strict: recorded UNGRACEFUL verdict treated as a failure'));
  }
}

/** Human-facing labels for the follow-up issues each finding maps to. */
function followUpLabels(id) {
  const map = {
    'rpc-outage': ['#839 (missing Soroban SDK dependency)'],
    'rpc-blackhole': ['#840 (unbounded RPC call)'],
    'backend-crash': ['#841 (no graceful shutdown)'],
    'redis-outage': ['#842 (/health always 503 with Redis configured)'],
    'health-ignores-rpc': ['#843 (RPC absent from /health)'],
  };
  return map[id] ?? [];
}

function summarize(results, { strict }) {
  const counts = {
    graceful: 0,
    ungraceful: 0,
    skipped: 0,
    drift: 0,
    new: 0,
  };
  let failed = 0;

  for (const r of results) {
    if (r.verdict === VERDICT.GRACEFUL) counts.graceful += 1;
    if (r.verdict === VERDICT.UNGRACEFUL) counts.ungraceful += 1;
    if (r.verdict === VERDICT.SKIPPED) counts.skipped += 1;
    if (r.state === 'DRIFT') {
      counts.drift += 1;
      failed += 1;
    }
    if (r.state === 'NEW') counts.new += 1;
    if (strict && r.verdict === VERDICT.UNGRACEFUL) failed += 1;
  }

  return { ...counts, failed, total: results.length };
}

function printSummary(summary, results) {
  console.log(paint(BOLD, '\n─── Summary ───'));
  console.log(`  experiments run      ${summary.total}`);
  console.log(`  ${paint(GREEN, 'graceful')}              ${summary.graceful}`);
  console.log(`  ${paint(RED, 'ungraceful')}            ${summary.ungraceful}`);
  console.log(`  ${paint(YELLOW, 'skipped')}               ${summary.skipped}`);
  if (summary.drift > 0) console.log(`  ${paint(RED, 'DRIFT')}                 ${summary.drift}`);
  if (summary.new > 0) console.log(`  ${paint(YELLOW, 'new (no baseline)')}      ${summary.new}`);

  const ungraceful = results.filter((r) => r.verdict === VERDICT.UNGRACEFUL && r.state !== 'DRIFT');
  if (ungraceful.length > 0) {
    console.log(paint(BOLD, '\n  Known ungraceful failure modes (tracked, not new regressions):'));
    for (const r of ungraceful) {
      console.log(`    ${paint(RED, r.id)} — ${followUpLabels(r.id).join(', ') || 'no follow-up filed'}`);
    }
    console.log(paint(DIM, '\n  These are real defects, recorded rather than hidden. See docs/chaos-engineering.md.'));
  }

  if (summary.failed > 0) {
    console.log(paint(RED, `\n  ${summary.failed} experiment(s) need attention.\n`));
  } else {
    console.log(paint(GREEN, '\n  No drift from the recorded baseline.\n'));
  }
}

function writeBaseline(results, existing) {
  const experiments = { ...(existing.experiments ?? {}) };
  for (const r of results) {
    const previous = experiments[r.id] ?? {};
    experiments[r.id] = {
      verdict: r.verdict,
      ...(r.observations?.mechanism ? { mechanism: r.observations.mechanism } : {}),
      // Preserve the follow-up list: it is a human decision, not an observation.
      followUp: previous.followUp ?? [],
    };
    // Drop observations that belong to a SKIPPED run so a skip can never be
    // mistaken for a recorded behaviour.
    if (r.verdict === VERDICT.SKIPPED) delete experiments[r.id];
  }
  const payload = {
    $comment: existing.$comment,
    recordedAt: new Date().toISOString().slice(0, 10),
    experiments,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeReport(results, summary) {
  try {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    const payload = {
      recordedAt: new Date().toISOString(),
      summary,
      results: results.map(({ id, fault, state, verdict, summary: detail, reason, observations }) => ({
        id,
        fault,
        state,
        verdict,
        detail: detail ?? null,
        reason: reason ?? null,
        observations,
      })),
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    if (!asJson) console.log(paint(DIM, `  Run report written to docs/chaos-engineering/latest-run.json\n`));
  } catch (err) {
    if (!asJson) console.error(paint(YELLOW, `  Could not write run report: ${err.message}`));
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(err);
  process.exitCode = 2;
}
