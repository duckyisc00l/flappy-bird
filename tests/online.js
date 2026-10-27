// Checks the real Supabase project: reading the board, the table rules, a race link round trip, and a live duel.
// Writes nothing to the public leaderboard (bot rounds never count; the only score sent is one the table must refuse).
const { chromium } = require('playwright');
(async () => {
  const out = { ok: {}, info: {}, errors: [] };
  const b = await chromium.launch();
  const page = async (n) => { const c = await b.newContext({ viewport: { width: 402, height: 874 } }); const p = await c.newPage(); p.on('pageerror', e => out.errors.push(n + ': ' + e.message)); await p.goto('http://localhost:8080/'); await p.waitForTimeout(2500); return p; };
  try {
    const A = await page('A'), B = await page('B');
    // 1) read the leaderboard
    out.info.board = await A.evaluate(async () => { try { return { rows: (await lbFetch('normal', false)).length }; } catch (e) { return { err: e.message }; } });
    out.ok.readBoard = out.info.board.rows !== undefined;
    // 2) the table refuses a bad score (score 0)
    out.info.bad = await A.evaluate(async () => { try { await sb('scores', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name: 'x', mode: 'normal', score: 0, bird: 'yellow', device: 'testtesttest' }) }); return 'accepted'; } catch (e) { return e.message; } });
    out.ok.rulesWork = out.info.bad !== 'accepted';
    // 3) a race link round trip (one test run in the ghosts table, only reachable by its link)
    out.info.link = await A.evaluate(async () => {
      const W = (ms) => new Promise(r => setTimeout(r, ms));
      playerName = 'CI test'; autoplay = true; handlePlayTap(); await W(1100); startGame(); const k = setInterval(() => runUsedBot = false, 20); await W(5000); autoplay = false; await W(3600); clearInterval(k);
      try { const url = await myBestLink('normal'); const id = url.split('#r=')[1]; const row = await fetchRun(id); return { url, back: row.name, score: row.score, same: row.data.seed === loadGhost('normal').seed }; } catch (e) { return { err: e.message }; }
    });
    out.ok.raceLink = !!(out.info.link && out.info.link.same);
    // 4) a live duel between A and B
    const room = 'CI' + Math.floor(Math.random() * 9000 + 1000);
    await A.evaluate((r) => { playerName = 'Host'; joinLive(r, true); }, room);
    await B.evaluate((r) => { playerName = 'Guest'; joinLive(r, false); }, room);
    await A.waitForTimeout(5000);
    out.info.presence = { A: await A.evaluate(() => liveRoom && liveRoom.opp && liveRoom.opp.name), B: await B.evaluate(() => liveRoom && liveRoom.opp && liveRoom.opp.name), status: await A.evaluate(() => liveRoom && liveRoom.status) };
    for (const P of [A, B]) await P.evaluate(() => { autoplay = true; if (PK) closePicker(); if (!isWaitingToStart && playButton.added) handlePlayTap(); });
    await A.waitForTimeout(1500);
    for (const P of [B, A]) await P.evaluate(() => { if (!liveRoom.ready) liveReady(); });
    await A.waitForTimeout(9000);
    out.info.during = { A: await A.evaluate(() => ({ dyn: bird.dynamic, round: liveRoom.round, seed: liveRoom.seed, opp: liveRoom.oppState && liveRoom.oppState.score })), B: await B.evaluate(() => ({ dyn: bird.dynamic, round: liveRoom.round, seed: liveRoom.seed, opp: liveRoom.oppState && liveRoom.oppState.score })) };
    for (const P of [A, B]) await P.evaluate(() => { autoplay = false; });
    await A.waitForTimeout(6000);
    out.info.end = { A: await A.evaluate(() => liveRoom.result), B: await B.evaluate(() => liveRoom.result) };
    out.ok.livePresence = out.info.presence.A === 'Guest' && out.info.presence.B === 'Host';
    out.ok.liveSameCourse = out.info.during.A.seed === out.info.during.B.seed && out.info.during.A.round === 1;
    out.ok.liveSeesOther = out.info.during.A.opp !== undefined && out.info.during.B.opp !== undefined;
    out.ok.liveResult = !!(out.info.end.A && out.info.end.B);
  } catch (e) { out.errors.push('test: ' + e.message); }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
