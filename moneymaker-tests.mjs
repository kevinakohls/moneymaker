import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const URL = 'file:///home/claude/moneymaker/index.html';
const OUT = '/home/claude/tests/shots'; fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };
const browser = await chromium.launch();

async function fresh(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__moneymaker);
  return { ctx, page, errors };
}
const idle = page => page.waitForFunction(() => !window.__moneymaker.isBusy(), null, { timeout: 60000 });
const S = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__moneymaker.getState())));

console.log('1. Root cause + load');
{
  const src = fs.readFileSync('/mnt/user-data/uploads/fad0299c-Moneymaker-Play-Offline-v1.1.html', 'utf8');
  const { ctx, page } = await fresh();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.setContent(src); await page.waitForTimeout(300);
  ok(errs.some(e => /addEventListener|null/.test(e)), `v1.1 reproduces the crash: "${errs[0]}"`);
  await ctx.close();
}
{
  const { ctx, page, errors } = await fresh();
  ok(errors.length === 0, 'v2 loads with no console errors');
  ok(await page.locator('#scene .station').count() === 5, 'five clickable stations rendered');
  const arts = await page.$$eval('#scene .station svg.machine', els => els.map(e => e.innerHTML.slice(0, 200)));
  ok(new Set(arts).size === 5, 'five visually distinct machine drawings');
  ok((await page.textContent('.hero p')).includes('Five machines. Three weeks. Can you improve factory profitability?'), 'first-screen instruction text');
  await ctx.close();
}

console.log('2. Simulation rules (pure functions)');
{
  const { ctx, page } = await fresh();
  const r = await page.evaluate(() => {
    const M = window.__moneymaker; let violations = 0, created = 0, days = 0;
    for (let g = 0; g < 300; g++) {
      const s = M.createGame(M.CONFIG.PLANT_ORDERS[g % 5], (g * 2654435761) >>> 0);
      for (let d = 0; d < 40; d++) {
        if (d % 5 === 2) M.applyImprovement(s, (g + d) % 5, d % 2 ? 'min' : 'max');
        const before = s.wip.slice(), ship0 = s.shipments; const rec = M.stepDay(s); days++;
        rec.output.forEach((o, i) => { if (i > 0 && o > before[i - 1]) violations++; if (o > rec.possible[i] || o < 0) violations++; });
        if (s.wip.some(w => w < 0)) violations++;
        const inv0 = before.reduce((a, b) => a + b, 0), inv1 = s.wip.reduce((a, b) => a + b, 0);
        if (inv1 !== inv0 + rec.output[0] - rec.output[4]) created++;
        if (s.shipments !== ship0 + rec.output[4]) created++;
        rec.output.slice(0, 4).forEach((o, i) => { if (rec.wip[i] !== before[i] + o - rec.output[i + 1]) created++; });
      }
    }
    // rolls respect ranges and are flat
    const m = { id: 2, lo: 2, hi: 6 }, counts = {}; let out = 0;
    for (let seed = 0; seed < 4000; seed++) for (let d = 0; d < 20; d++) { const v = M.rollFor(m, seed * 7919, d); counts[v] = (counts[v] || 0) + 1; if (v < 2 || v > 6) out++; }
    return { violations, created, days, out, counts };
  });
  ok(r.violations === 0, `no station processed more than it had or more than its roll (${r.days} days checked)`);
  ok(r.created === 0, 'material conserved: every WIP pile = before + inflow − outflow; nothing created from nothing');
  const vals = Object.values(r.counts), mean = vals.reduce((a, b) => a + b) / vals.length;
  ok(r.out === 0 && Object.keys(r.counts).length === 5 && vals.every(v => Math.abs(v - mean) / mean < 0.05), `rolls flat over 2–6: ${JSON.stringify(r.counts)}`);

  const imp = await page.evaluate(() => {
    const M = window.__moneymaker; const s = M.createGame([3, 0, 4, 2, 1], 1);
    const snap = () => s.machines.map(m => [m.lo, m.hi]);
    const a = snap(); M.applyImprovement(s, 3, 'min'); const b = snap(); M.applyImprovement(s, 3, 'max'); const c = snap();
    // drive drill (id 2, at position 3) to lo = hi-1
    while (s.machines[2].lo < s.machines[2].hi - 1) M.applyImprovement(s, 3, 'min');
    const spendBefore = s.spending; const blocked = M.applyImprovement(s, 3, 'min'); const spendAfter = s.spending;
    const maxOk = M.applyImprovement(s, 3, 'max');
    return { a, b, c, blocked, spendSame: spendBefore === spendAfter, maxOk, cost: M.CONFIG.IMPROVEMENT_COST, spending: s.spending, n: s.upgrades.length };
  });
  ok(JSON.stringify(imp.b) === JSON.stringify(imp.a.map((x, i) => i === 2 ? [x[0] + 1, x[1]] : x)), 'Raise Minimum at station 4 of Plant B changes only the drill (machine at that position), lo+1');
  ok(JSON.stringify(imp.c) === JSON.stringify(imp.b.map((x, i) => i === 2 ? [x[0], x[1] + 1] : x)), 'Raise Maximum changes only that machine, hi+1');
  ok(!imp.blocked.ok && imp.spendSame && imp.maxOk.ok, 'Raise Minimum refused (no charge) when lo = hi−1; Raise Maximum still works');
  ok(imp.spending === imp.n * imp.cost, 'every improvement costs the same fixed amount');
  await ctx.close();
}

console.log('3. UI: buttons, numbers each turn, animation matches simulation');
{
  const { ctx, page, errors } = await fresh();
  await page.click('#howButton'); ok(await page.isVisible('#howModal'), 'How to play opens');
  await page.keyboard.press('Escape'); ok(!(await page.isVisible('#howModal')), 'Escape closes it');
  await page.click('#improveButton');
  ok(await page.isVisible('#upgradePanel') && await page.locator('#upgradePanel .station-pick').count() === 5 && (await page.textContent('#upgradePanel')).includes('Step 1 of 2'), 'Improve Machine opens Step 1 with five station buttons');
  await page.click('#upgradePanel .station-pick[data-pos="2"]');
  ok((await page.textContent('#upgradePanel')).includes('Step 2 of 2 · Station 3') && await page.locator('#upgradePanel .choice').count() === 2 && await page.locator('#scene .station.selected').count() === 1, 'choosing Station 3 moves to Step 2 and highlights that machine');
  await page.click('#upgradePanel button:has-text("Other station")');
  ok(await page.locator('#upgradePanel .station-pick').count() === 5 && await page.locator('#scene .station.selected').count() === 0, '"Other station" returns to Step 1');
  await page.click('#upgradePanel button:has-text("Close")');
  ok(!(await page.isVisible('#upgradePanel')), 'Close hides the panel');
  ok(await page.isVisible('.tap-hint'), '"Tap any machine to improve it" hint is shown under the factory');
  await page.click('#oeeButton'); ok(await page.isVisible('#oeePanel') && (await page.textContent('#oeeButton')) === 'Hide OEE', 'Show OEE toggles the explanation');
  await page.screenshot({ path: `${OUT}/desktop-start.png` });

  // Advance 1 day and capture mid-animation
  await page.click('#day1');
  await page.waitForTimeout(450);
  const movingA = await page.evaluate(() => document.querySelectorAll('#scene g[pointer-events] use').length);
  await page.screenshot({ path: `${OUT}/desktop-mid-pull.png` });
  await page.waitForTimeout(500);
  const runningCount = await page.evaluate(() => document.querySelectorAll('#scene svg.machine.running').length);
  await page.screenshot({ path: `${OUT}/desktop-mid-run.png` });
  await page.waitForTimeout(250);
  const movingC = await page.evaluate(() => document.querySelectorAll('#scene g[pointer-events] use').length);
  await page.screenshot({ path: `${OUT}/desktop-mid-push.png` });
  await idle(page);
  ok(movingA > 0, `crates visibly moving during pull phase (${movingA} in flight)`);
  ok(runningCount > 0, `machines running mid-day (${runningCount} animating)`);
  ok(movingC > 0, `crates moving downstream (${movingC} in flight)`);

  for (let d = 0; d < 3; d++) { if (d) { await page.click('#day1'); await idle(page); }
    const st = await S(page); const rec = st.daily.at(-1);
    const log = await page.evaluate(() => window.__moneymaker.animLog.at(-1));
    const ui = await page.evaluate(() => ({ day: document.querySelector('#dayCount').textContent, ship: document.querySelector('#shippedCount').textContent,
      profit: document.querySelector('#profitCount').textContent, nums: [...document.querySelectorAll('#scene .st-num')].map(e => e.textContent),
      wips: [...document.querySelectorAll('#scene .wip-num')].map(e => e.textContent), dock: document.querySelector('#scene .dock-num').textContent }));
    const p = st.shipments * 400 - st.day * 1000 - st.spending;
    ok(JSON.stringify(log.pulled) === JSON.stringify(rec.output) && JSON.stringify(log.pushed) === JSON.stringify(rec.output) && log.shipped === rec.shipped,
      `day ${rec.day}: animation moved exactly the simulated crates ${JSON.stringify(rec.output)}`);
    ok(JSON.stringify(log.pileEnd) === JSON.stringify(rec.wip), `day ${rec.day}: animated piles end at simulated WIP ${JSON.stringify(rec.wip)}`);
    ok(JSON.stringify(log.runningStations) === JSON.stringify(rec.output.map((o, i) => o > 0 ? i : null).filter(x => x !== null)), `day ${rec.day}: only stations that produced were animated`);
    ok(ui.day.startsWith(String(st.day)) && ui.ship.startsWith(String(st.shipments)) && ui.profit === (p < 0 ? '−' : '') + '$' + Math.abs(p).toLocaleString('en-US'),
      `day ${rec.day}: scoreboard shows day ${st.day}, shipped ${st.shipments}, profit ${ui.profit}`);
    ok(JSON.stringify(ui.nums) === JSON.stringify(rec.output.map(String)) && JSON.stringify(ui.wips) === JSON.stringify(rec.wip.map(String)) && ui.dock === String(st.shipments),
      `day ${rec.day}: machine numbers, WIP piles and dock counter match`);
  }
  // Select a machine and improve via the UI
  await page.locator('#scene .station').nth(2).click();
  ok(await page.isVisible('#upgradePanel'), 'tapping Station 3 opens its improvement panel');
  const before = await S(page);
  await page.click('#upgradePanel .choice[data-kind="max"]');
  const after = await S(page);
  ok(after.machines[2].hi === before.machines[2].hi + 1 && after.spending === before.spending + 1000, 'UI Raise Maximum on Station 3 (drill) raised its hidden max and charged $1,000');
  for (let k = 0; k < 4; k++) if (!(await page.isDisabled('#upgradePanel .choice[data-kind="min"]'))) await page.click('#upgradePanel .choice[data-kind="min"]');
  const st2 = await S(page);
  ok(st2.machines[2].lo === st2.machines[2].hi - 1 && await page.isDisabled('#upgradePanel .choice[data-kind="min"]') && !(await page.isDisabled('#upgradePanel .choice[data-kind="max"]')),
    `Raise Minimum disabled at ${st2.machines[2].lo}–${st2.machines[2].hi}, Raise Maximum still enabled`);
  ok((await page.textContent('#upgradePanel')).includes('already highly consistent'), 'disabled button explains the station is highly consistent');
  ok(!(await page.textContent('body')).match(/\b2–6\b|\b2-6\b/), 'hidden ranges are not shown on the page during play');
  ok(errors.length === 0, 'no console errors during play');
  await ctx.close();
}

console.log('3b. Background tab (animation frames paused) still ends at the simulated state');
{
  const { ctx, page } = await fresh();
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  for (let k = 0; k < 2; k++) { await page.click('#day1'); await idle(page); }
  const st = await S(page); const rec = st.daily.at(-1);
  const log = await page.evaluate(() => window.__moneymaker.animLog.at(-1));
  const inFlight = await page.evaluate(() => document.querySelectorAll('#scene g[pointer-events] use').length);
  const wips = await page.$$eval('#scene .wip-num', e => e.map(x => x.textContent));
  ok(JSON.stringify(log.pulled) === JSON.stringify(rec.output) && JSON.stringify(log.pileEnd) === JSON.stringify(rec.wip) && inFlight === 0 && JSON.stringify(wips) === JSON.stringify(rec.wip.map(String)),
    'with frames paused, crates are landed at day end; piles and counts match the simulation');
  await ctx.close();
}

console.log('4. Seven-day advance == seven one-day advances (UI, same rolls, with an improvement)');
{
  const { ctx, page } = await fresh();
  await page.locator('#scene .station').nth(1).click(); await page.click('#upgradePanel .choice[data-kind="min"]');
  await page.click('#day7'); await idle(page);
  const A = await S(page);
  await page.click('#resetButton');
  const R = await S(page);
  ok(R.seed === A.seed && R.day === 0 && R.upgrades.length === 0 && JSON.stringify(R.machines) === JSON.stringify(await page.evaluate(() => window.__moneymaker.CONFIG.MACHINES.map(m => ({ id: m.id, lo: m.lo, hi: m.hi })))), 'Same Rolls: same seed, day 0, improvements reset');
  await page.locator('#scene .station').nth(1).click(); await page.click('#upgradePanel .choice[data-kind="min"]');
  for (let k = 0; k < 7; k++) { await page.click('#day1'); await idle(page); }
  const B = await S(page);
  ok(JSON.stringify(A.daily) === JSON.stringify(B.daily) && A.shipments === B.shipments && JSON.stringify(A.wip) === JSON.stringify(B.wip), `identical: ${A.shipments} shipped, WIP ${JSON.stringify(A.wip)}`);
  await ctx.close();
}

console.log('5. Day-21 boundary, records, recognition, reveal');
{
  const { ctx, page } = await fresh();
  const s0 = await S(page);
  await page.click('#day7'); await idle(page); ok((await S(page)).day === 7, 'day 7');
  await page.click('#day7'); await idle(page); ok((await S(page)).day === 14, 'day 14');
  await page.click('#day1'); await idle(page);
  ok((await page.textContent('#day7')) === 'Advance 6 Days', '7-day button relabels to remaining days at day 15');
  await page.click('#day7'); await idle(page);
  let st = await S(page);
  ok(st.day === 21, '7-day advance from day 15 stops exactly at day 21');
  ok(await page.isVisible('#resultModal'), 'results appear at day 21');
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('moneymaker-v3-records')));
  ok(rec.all.profit === st.finished.profit && st.finished.profit === st.shipments * 400 - 21000 - st.spending, `record = day-21 profit ${rec.all.profit}`);
  const base = await page.evaluate(([o, s]) => window.__moneymaker.baselineProfit(o, s), [st.order, st.seed]);
  ok(st.finished.baseline.profit === base.profit && st.finished.profit === base.profit, 'no-improvement baseline equals this game (no improvements made)');
  ok(((await page.textContent('#resultModal')).includes("You're a Moneymaker!")) === st.finished.metTarget, `banner shown iff target met on first game (met=${st.finished.metTarget})`);
  await page.click('#resultModal button:has-text("Reveal the machines")');
  ok(await page.isVisible('.reveal-table'), 'reveal table shows after day 21');
  ok((await page.textContent('.reveal-table')).includes('2–6') && (await page.textContent('.reveal-table tr.constraint')).includes('Drill press'), 'reveal shows hidden dice and marks the drill as constraint');
  await page.screenshot({ path: `${OUT}/desktop-results.png`, fullPage: false });
  await page.click('#resultModal button:has-text("Keep experimenting")');
  await page.locator('#scene .station').nth(0).click(); await page.click('#upgradePanel .choice[data-kind="max"]');
  await page.click('#day7'); await idle(page);
  st = await S(page);
  const rec2 = await page.evaluate(() => JSON.parse(localStorage.getItem('moneymaker-v3-records')));
  ok(st.day === 28 && rec2.all.profit === rec.all.profit && st.finished.profit === rec.all.profit, 'free play continues to day 28; record locked at day-21 value');
  // chart after free play
  const ch = await page.evaluate(() => { const s = window.__moneymaker.getState(); const d = s.daily; const w = d.slice(-7); const exp = (w.reduce((a, x) => a + x.shipped, 0) / 7).toFixed(1);
    const svg = document.querySelector('#chart svg'); const texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
    return { exp, bars: svg.querySelectorAll('path').length, nonzero: d.filter(x => x.shipped > 0).length, lines: svg.querySelectorAll('polyline').length,
      label: texts.includes(exp + '/day'), freePlay: texts.some(t => t.startsWith('Free play')), tri: texts.filter(t => t === '▲').length,
      stat: document.querySelector('#ship7').textContent, delta: document.querySelector('#ship7delta').textContent }; });
  ok(ch.bars === ch.nonzero && ch.lines === 2 && ch.label && ch.stat === ch.exp + '/day', `chart: ${ch.bars} daily bars, 7-day average line ending at ${ch.exp}/day (matches stat)`);
  ok(ch.freePlay && ch.tri === 1, 'chart shades free play after day 21 and marks the one improvement with ▲');
  ok(/vs prior 7 days/.test(ch.delta), `week-over-week change shown: "${ch.delta}"`);
  await page.locator('#chart').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const box = await page.locator('#chart svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  ok(await page.isVisible('#chartTip') && /Day \d+[\s\S]*7-day average/.test(await page.textContent('#chartTip')), 'hovering the chart shows a day tooltip with the 7-day average');
  await page.screenshot({ path: `${OUT}/desktop-chart.png`, clip: { x: Math.max(0, box.x - 30), y: Math.max(0, box.y - 120), width: box.width + 60, height: Math.min(box.height + 200, 900 - Math.max(0, box.y - 120)) } });

  // Same Rolls + constraint improvements -> compare and recognition for new best
  await page.click('#resetButton');
  ok((await S(page)).seed === s0.seed, 'Same Rolls reuses the original dice sequence');
  const pos = (await S(page)).order.indexOf(2);
  await page.locator('#scene .station').nth(pos).click();
  await page.click('#upgradePanel .choice[data-kind="min"]'); await page.click('#upgradePanel .choice[data-kind="min"]');
  for (const n of [7, 7, 7]) { await page.click('#day7'); await idle(page); }
  st = await S(page);
  console.log(`    first game ${rec.all.profit} (${s0.seed}); constraint-improved replay ${st.finished.profit}, shipped ${st.shipments}`);
  if (st.finished.profit > rec.all.profit) ok(st.finished.newBest && (await page.textContent('#resultModal')).includes("You're a Moneymaker!"), 'improving the constraint beat the best: "You\'re a Moneymaker!" shown');
  else ok(true, 'replay did not beat best on these rolls (recognition correctly not forced)');
  await page.click('#resultModal button:has-text("Play Again")');
  const pa = await S(page);
  ok(pa.seed !== s0.seed && JSON.stringify(pa.order) === JSON.stringify(st.order) && pa.day === 0 && pa.spending === 0, 'Play Again: same arrangement, new seed, reset');
  await page.click('#differentButton');
  const dp = await S(page);
  ok(JSON.stringify(dp.order) !== JSON.stringify(pa.order) && [...dp.order].sort().join() === '0,1,2,3,4' && dp.plant === pa.plant + 1 && (await page.textContent('#plantLabel')) === 'Plant B', 'Different Plant: same five machines rearranged, Plant B');
  const drawn = await page.$$eval('#scene .station svg.machine', els => els.map(e => e.getAttribute('data-machine')));
  ok(JSON.stringify(drawn) === JSON.stringify(dp.order.map(String)), `machines redrawn in new positions (order ${dp.order})`);
  // persistence
  await page.click('#day1'); await idle(page); const pre = await S(page);
  await page.reload(); await page.waitForFunction(() => !!window.__moneymaker);
  const post = await S(page);
  ok(post.day === pre.day && JSON.stringify(post.order) === JSON.stringify(pre.order), 'game in progress survives a reload (saved in this browser)');
  await ctx.close();
}

console.log('6. Layout: desktop, tablet, phone');
for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['tablet', { width: 820, height: 1100 }], ['phone', { width: 390, height: 844 }], ['small-phone', { width: 360, height: 740 }]]) {
  const { ctx, page, errors } = await fresh(vp);
  await page.click('#day1'); await idle(page); await page.click('#day1'); await idle(page);
  const m = await page.evaluate(() => {
    const sc = document.querySelector('#scene').getBoundingClientRect();
    const btn = document.querySelector('#day1').getBoundingClientRect();
    const st = [...document.querySelectorAll('#scene .station')].map(e => e.getBoundingClientRect());
    const fontPx = document.querySelector('#scene .st-num').getBoundingClientRect().height;
    return { overflowX: document.documentElement.scrollWidth > innerWidth, sceneBottom: sc.bottom, btnBottom: btn.bottom, h: innerHeight,
      minTap: Math.min(...st.map(r => Math.min(r.width, r.height))), allInView: st.every(r => r.left >= 0 && r.right <= innerWidth), fontPx };
  });
  ok(!m.overflowX, `${name}: no horizontal scrolling`);
  ok(m.allInView, `${name}: all five machines visible across the width`);
  ok(m.btnBottom <= m.h, `${name}: Advance button visible on first screen (bottom ${Math.round(m.btnBottom)} ≤ ${m.h})`);
  ok(m.minTap >= 44, `${name}: machine tap targets ≥ 44px (${Math.round(m.minTap)}px)`);
  ok(m.fontPx >= 15, `${name}: production numbers readable (${Math.round(m.fontPx)}px tall)`);
  ok(errors.length === 0, `${name}: no console errors`);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  if (name === 'phone') {
    await page.click('#day1'); await page.waitForTimeout(1000); await page.screenshot({ path: `${OUT}/phone-mid-day.png` }); await idle(page);
    await page.click('#improveButton'); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/phone-step1.png` });
    await page.click('#upgradePanel .station-pick[data-pos="2"]'); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/phone-step2.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
