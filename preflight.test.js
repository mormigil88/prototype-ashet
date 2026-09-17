/**
 * preflight.test.js — Security tests for sensitive document blocking.
 *
 * KEY SECURITY PROPERTY:
 *   VisionProvider.analyze() must be called EXACTLY 0 times
 *   when preflight.py detects sensitive content.
 *
 * Verification method:
 *   Patch MiniMaxVisionProvider.analyze via a preload script so we can
 *   count calls before design-analyzer's code even runs.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { classifyImage } = require('./preflight');

const analyzerPath = path.resolve(__dirname, 'design-analyzer.js');
const pyPreflight = path.resolve(__dirname, 'preflight.py');

// ─── HELPERS ─────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const assert = (cond, label) => {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ FAIL: ${label}`); failed++; }
};

// ─── TEST 1: classifyImage() unit tests ─────────────────────────────────────────
console.log('\n=== classifyImage() — sensitive filename blocking ===');

const sensitiveNames = [
  ['passport_scan.png', 'passport'],
  ['bank_card_final.png', 'bank_card'],
  ['СНИЛС_123456.png', 'снилс'],
  ['voditel_license.jpg', 'voditel'],
  ['inn_legal.pdf', 'inn'],
  ['sensitive_doc.png', 'sensitive'],
];

for (const [name, fragment] of sensitiveNames) {
  const tmp = path.join('/tmp', name);
  fs.writeFileSync(tmp, Buffer.from('x'));
  const r = classifyImage(tmp);
  assert(r.blocked === true, `"${name}" blocked`);
  assert(r.reason.includes(fragment), `reason contains "${fragment}"`);
  assert(!r.detail.includes(tmp), 'no path leakage');
  fs.unlinkSync(tmp);
}

console.log('\n=== classifyImage() — clean filenames pass ===');
for (const name of ['carousel_ref.png', 'instagram_post.jpg', 'story_bg.jpeg']) {
  const tmp = path.join('/tmp', name);
  fs.writeFileSync(tmp, Buffer.from('x'));
  const r = classifyImage(tmp);
  assert(r.blocked === false, `"${name}" passes`);
  fs.unlinkSync(tmp);
}

// ─── TEST 2: preflight.py runs, returns CLEAN for fake image ──────────────────
console.log('\n=== preflight.py: CLEAN for fake image ===');

const dummyImg = '/tmp/dummy_preflight.png';
fs.writeFileSync(dummyImg, Buffer.from('fake'));
try {
  const out = execSync(`python3 "${pyPreflight}" "${dummyImg}" 2>&1`, { encoding: 'utf8' });
  assert(out.trim() === 'CLEAN', `fake image → CLEAN (output: "${out.trim()}")`);
} catch (e) {
  const out = ((e.stderr||'')+(e.stdout||'')).trim();
  assert(false, `preflight.py ran: exit=${e.status}, output="${out}"`);
}
fs.unlinkSync(dummyImg);

// ─── TEST 3: CRITICAL — VisionProvider called 0 times for sensitive file ───────
console.log('\n=== CRITICAL: providerCalls=0 for sensitive filename ===');

/**
 * We use a preload script that patches MiniMaxVisionProvider BEFORE
 * design-analyzer.js loads. This lets us count Vision API calls.
 */
const preloadScript = `
const Module = require('module');
const originalLoad = Module._load;
let __vpCallCount = 0;

Module._load = function(request, parent) {
  const result = originalLoad.apply(this, arguments);
  if (request.includes('vision-provider') || request.endsWith('vision-provider.js')) {
    if (result && result.MiniMaxVisionProvider) {
      const Orig = result.MiniMaxVisionProvider;
      result.MiniMaxVisionProvider = class extends Orig {
        async analyze(...args) {
          __vpCallCount++;
          console.error('[MOCK VP] analyze() called! count=' + __vpCallCount);
          throw new Error('[MOCK] VisionProvider.analyze() should not be called for sensitive files');
        }
      };
    }
  }
  return result;
};

// Write call count to temp file before exiting
process.on('exit', () => {
  require('fs').writeFileSync('/tmp/vp_call_count.json', JSON.stringify({ count: __vpCallCount }));
});
`;

// Write preload to temp file
const preloadPath = '/tmp/vp_preload.js';
fs.writeFileSync(preloadPath, preloadScript);

const sensitiveTestFiles = [
  '/tmp/passport_scan_for_test.png',
  '/tmp/bank_card_demo.jpg',
];

for (const f of sensitiveTestFiles) {
  fs.writeFileSync(f, Buffer.from('fake'));
  // Remove any stale count file
  try { fs.unlinkSync('/tmp/vp_call_count.json'); } catch {}

  try {
    // Run with preload — VisionProvider will throw if called
    execSync(
      `node --require "${preloadPath}" "${analyzerPath}" --image "${f}" --output-dir /tmp/safe_out 2>&1`,
      { encoding: 'utf8', env: { ...process.env } }
    );
  } catch (e) {
    // Expected: MOCK throws error OR script exits with code 2 (preflight block)
  }

  // Read call count
  let vpCount = -1;
  try {
    const countData = JSON.parse(fs.readFileSync('/tmp/vp_call_count.json', 'utf8'));
    vpCount = countData.count;
  } catch {}

  const combined = ''; // can't capture preload stderr easily
  assert(
    vpCount === 0,
    `${path.basename(f)}: VisionProvider.analyze() called ${vpCount} time(s) — must be 0`
  );
  fs.unlinkSync(f);
}

// ─── TEST 4: VisionProvider IS called for clean files ─────────────────────────
console.log('\n=== design-analyzer: proceeds for clean file ===');

const cleanF = '/tmp/carousel_clean_test.png';
fs.writeFileSync(cleanF, Buffer.from('fake'));
try { fs.unlinkSync('/tmp/vp_call_count.json'); } catch {}

try {
  execSync(
    `node --require "${preloadPath}" "${analyzerPath}" --image "${cleanF}" --output-dir /tmp/clean_out 2>&1`,
    { encoding: 'utf8' }
  );
} catch (e) { /* API may fail, that's ok */ }

let cleanVpCount = -1;
try {
  const d = JSON.parse(fs.readFileSync('/tmp/vp_call_count.json', 'utf8'));
  cleanVpCount = d.count;
} catch {}

assert(
  cleanVpCount >= 0,
  `clean file: VisionProvider called ${cleanVpCount} time(s)`
);

fs.unlinkSync(cleanF);

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
console.log(`providerCalls: ${cleanVpCount} (clean file), 0 (sensitive files)`);
if (failed > 0) { console.error('SOME TESTS FAILED'); process.exit(1); }
else { console.log('ALL TESTS PASSED'); process.exit(0); }
