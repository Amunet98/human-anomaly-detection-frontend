// Vets a candidate eval fixture before it is adopted, and stages it if it holds.
//
// Run with:
//   node scripts/add-fixture.mjs <image> --expect <class> [--name <file.jpg>]
//                                [--note "..."] [--write]
//
// Why this exists: MODEL_CARD.md records a fixture that was adopted and then
// silently stopped working - lodge-group-a/b were downscaled to 960px and
// passed against the very bug they were added to guard. The lesson generalised
// is that a fixture is a claim about behaviour, and a claim you have not
// checked is worse than no fixture, because the harness now reports green.
//
// So this refuses to stage anything it has not first run through the real
// pipeline and the same six perturbations the harness scores against - imported
// from lib/perturbations.mjs rather than restated, since a candidate vetted
// against a different six would be measuring nothing.
//
// It borrows the backend repo's onnxruntime-node and sharp, like eval-check.mjs
// and parity-check.mjs, and is deliberately not part of `npm run check`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PERTURBATIONS } from './lib/perturbations.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const BACKEND = path.resolve(FRONTEND, '../human-anomaly-detection-backend-main');
const FIXTURES = path.join(HERE, 'eval-fixtures');
const LABELS = path.join(FIXTURES, 'labels.json');

if (!fs.existsSync(path.join(BACKEND, 'node_modules'))) {
  console.error(`Backend repo not found (or deps not installed) at:\n  ${BACKEND}\n`);
  process.exit(2);
}

const require = createRequire(BACKEND + '/');
const sharp = require('sharp');
const { analyzeBuffer } = require(path.join(BACKEND, 'inference'));
const { CLASS_NAMES } = await import(`${FRONTEND}/src/lib/detect/constants.js`);

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const src = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);
const expect = flag('expect');
const write = argv.includes('--write');
const name = flag('name') || (src ? path.basename(src) : null);
const note = flag('note') || '';

if (!src || !expect) {
  console.error('usage: node scripts/add-fixture.mjs <image> --expect <class> [--name f.jpg] [--note "..."] [--write]');
  process.exit(2);
}
if (!CLASS_NAMES.includes(expect)) {
  console.error(`--expect must be one of ${CLASS_NAMES.join(', ')}`);
  process.exit(2);
}
if (!fs.existsSync(src)) {
  console.error(`no such image: ${src}`);
  process.exit(2);
}

// --- vet --------------------------------------------------------------------

let problems = 0;
let warnings = 0;
const bad = (m) => { problems++; console.log(`  BLOCK  ${m}`); };
const warn = (m) => { warnings++; console.log(`  WARN   ${m}`); };
const ok = (m) => console.log(`  OK     ${m}`);

const buf = fs.readFileSync(src);
const meta = await sharp(buf).metadata();

console.log(`\n=== ${path.basename(src)}  (${meta.width}x${meta.height}, expect ${expect}) ===\n`);

const { detections, top } = await analyzeBuffer(buf);
for (const [i, d] of detections.entries()) {
  console.log(
    `  #${i + 1} ${d.className.padEnd(5)} tier=${d.tier} conf=${d.confidence.toFixed(2)}  ${d.reason}`,
  );
}
console.log('');

if (!top) {
  bad('no person detected at all - nothing to assert');
} else if (top.className !== expect) {
  bad(`top-1 is \`${top.className}\`, not \`${expect}\``);
} else {
  ok(`top-1 is \`${expect}\` at ${top.confidence.toFixed(2)}`);
}

// squat is reachable only with the full leg chain, so a squat fixture that
// lands on tier B or C is not testing the squat gate - it is testing the sit
// fallback and would keep passing if the gate were deleted outright.
if (expect === 'squat' && top && top.tier !== 'A') {
  bad(`squat needs tier A (ankles visible); this is tier ${top.tier}, which cannot reach the squat gate`);
} else if (top) {
  ok(`tier ${top.tier}`);
}

// Multi-subject frames are legitimate but must say so, or the harness silently
// scores one person and calls the frame covered.
if (detections.length > 1) {
  warn(
    `${detections.length} people detected - top-1 alone will not pin the others. ` +
      `Add "expectedAll": [${JSON.stringify(detections.map((d) => d.className).sort()).slice(1, -1)}]`,
  );
}

// --- perturbations ----------------------------------------------------------

console.log('\n  perturbation survival:');
let survived = 0;
for (const [label, fn] of Object.entries(PERTURBATIONS)) {
  const img = fn(sharp(buf), meta);
  const out = await analyzeBuffer(await img.toBuffer());
  const got = out.top ? out.top.className : 'none';
  const pass = got === expect;
  if (pass) survived++;
  console.log(`    ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(14)} ${got}`);
}
const n = Object.keys(PERTURBATIONS).length;
console.log('');
if (survived === n) ok(`survives all ${n} perturbations`);
else if (survived >= n - 2) warn(`survives ${survived}/${n} - usable, but note which in the label`);
else warn(`survives only ${survived}/${n} - fine as a KNOWN GAP fixture, misleading as a normal one`);

// --- stage ------------------------------------------------------------------

console.log('');
if (problems) {
  console.log(`REJECTED - ${problems} blocking problem(s). Not staged.\n`);
  process.exit(1);
}
if (!write) {
  console.log(`Vetted clean${warnings ? ` (${warnings} warning(s))` : ''}. Re-run with --write to stage it.\n`);
  process.exit(0);
}

const dest = path.join(FIXTURES, name);
if (fs.existsSync(dest)) {
  console.error(`${name} already exists in eval-fixtures - pick another --name\n`);
  process.exit(1);
}
// Appended textually rather than by re-serialising the parsed array. labels.json
// is hand-formatted - short entries on one line, long notes wrapped, expectedAll
// arrays inline - and JSON.stringify(_, null, 2) reflows the entire file, which
// buries a one-entry addition in a whole-file diff and explodes every
// expectedAll across seven lines. The file is read by humans far more often than
// by this script.
const raw = fs.readFileSync(LABELS, 'utf8');
const close = raw.lastIndexOf(']');
if (close === -1) {
  console.error(`${LABELS} does not end in a JSON array - refusing to edit it blind\n`);
  process.exit(1);
}
const entry = {
  file: name,
  expected: expect,
  note: note || `added ${new Date().toISOString().slice(0, 10)}; survives ${survived}/${n} perturbations`,
};
const before = raw.slice(0, close).replace(/\s*$/, '');
const updated = `${before},\n\n  ${JSON.stringify(entry)}\n]\n`;

// Never leave the file unparseable, whatever the source formatting was.
try {
  JSON.parse(updated);
} catch (e) {
  console.error(`refusing to write - the result would not parse: ${e.message}\n`);
  process.exit(1);
}
fs.copyFileSync(src, dest);
fs.writeFileSync(LABELS, updated);

console.log(`Staged ${name} into eval-fixtures/ and labels.json.`);
console.log('Now run `npm run eval:robust` and update the figures in MODEL_CARD.md.\n');
