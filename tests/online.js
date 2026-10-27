// Checks v137 against the real Supabase project: accounts, 2FA, leaderboard, profiles, race links, live duels.
// Makes two throwaway accounts (ci_xxxx) and deletes them at the end (their scores go with them).
const { chromium } = require('playwright');
const crypto = require('crypto');
function totp(secret, t) {   // the 6-digit code an authenticator app would show
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor((t || Date.now()) / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
(async () => {
  const out = { ok: {}, info: {}, errors: [] };
  const b = await chromium.launch();
  const page = async (n) => { const c = await b.newContext({ viewport: { width: 402, height: 874 } }); const p = await c.newPage(); p.on('pageerror', e => out.errors.push(n + ': ' + e.message)); await p.goto('http://localhost:8080/'); await p.waitForTimeout(3000); return p; };
  const tag = Math.random().toString(36).slice(2, 7), U1 = 'ci_' + tag, U2 = 'ci2_' + tag, PW = 'test-' + tag + '-pw!';
  let A, B;
  try {
    A = await page('A'); B = await page('B');
    // 1) create an account through the screen
    await A.evaluate(() => { accTab = 'new'; openSheet('account'); }); await A.waitForTimeout(600);
    let ins = await A.$$('.ac-in'); await ins[0].fill(U1); await ins[1].fill(PW);
    await A.click('.ac-btn.mk-save'); await A.waitForTimeout(4000);
    out.info.create = await A.evaluate(() => ({ kind: PK && PK.kind, signed: accSignedIn(), name: ACCT.profile && ACCT.profile.username, email: ACCT.user && ACCT.user.email, msg: (document.querySelector('.ac-msg') || {}).textContent }));
    out.ok.createAccount = out.info.create.signed && out.info.create.name === U1;
    // 2) same name again (other capitals) is refused
    out.info.taken = await B.evaluate(async (u) => { const r = await sb('profiles?select=id&handle=eq.' + u.toLowerCase()); return r.length; }, U1);
    out.ok.nameTaken = out.info.taken === 1;
    // 3) a real score while signed in -> on the board with the account name; stats go up
    out.info.play = await A.evaluate(async () => {
      const W = (ms) => new Promise(r => setTimeout(r, ms));
      if (PK) closePicker(); await W(400);
      autoplay = true; handlePlayTap(); await W(1100); startGame(); const k = setInterval(() => runUsedBot = false, 20); await W(6000); autoplay = false; await W(4000); clearInterval(k);
      await lbFlush(); await accFlushStats(); await W(1500);
      const rows = await lbFetch('normal', false); const me = rows.find(r => r.user_id === ACCT.user.id);
      const p = (await sb('profiles?select=*&id=eq.' + ACCT.user.id))[0];
      return { score, onBoard: me ? me.name + ' ' + me.score : null, games: p.games, pipes: p.pipes, bird: p.bird };
    });
    out.ok.leaderboard = !!out.info.play.onBoard;
    out.ok.stats = out.info.play.games >= 1;
    // 4) signed out: the server refuses a score
    out.info.anon = await B.evaluate(async () => { try { await sb('scores', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name: 'x', mode: 'normal', score: 5, bird: 'yellow', device: 'testtesttest' }) }); return 'accepted'; } catch (e) { return e.message; } });
    out.ok.anonRefused = out.info.anon !== 'accepted';
    // 5) race link carries the account name
    out.info.link = await A.evaluate(async () => { try { const url = await myBestLink('normal'); const row = await fetchRun(url.split('#r=')[1]); return { name: row.name, same: row.data.seed === loadGhost('normal').seed }; } catch (e) { return { err: e.message }; } });
    out.ok.raceLink = !!(out.info.link.same && out.info.link.name === out.info.create.name);
    // 5b) saved progress: a fresh phone signing in gets the best score, ghost run and favourites
    await A.evaluate(() => { favBirds.push('robin'); localStorage.setItem('fb_favBirds', JSON.stringify(favBirds)); }); await A.waitForTimeout(8000);
    out.info.saveRow = await A.evaluate(async () => { const r = await sb('saves?select=data&user_id=eq.' + ACCT.user.id); return r && r[0] ? Object.keys(r[0].data.keys) : null; });
    const C = await page('C');
    await C.evaluate(() => { accTab = 'in'; openSheet('account'); }); await C.waitForTimeout(600);
    { const i = await C.$$('.ac-in'); await i[0].fill(U1); await i[1].fill(PW); await C.click('.ac-btn.mk-save'); }
    await C.waitForTimeout(9000);
    out.info.restored = await C.evaluate(() => ({ best: bestScore(), ghost: !!loadGhost('normal'), fav: favBirds.includes('robin'), signed: accSignedIn() }));
    out.ok.savedProgress = !!(out.info.saveRow && out.info.restored.best === out.info.play.score && out.info.restored.ghost && out.info.restored.fav);
    await C.close();
    // 6) turn on 2FA through the screen (the test computes the app's code)
    await A.evaluate(() => accGo('twofa')); await A.waitForTimeout(4000);
    const secret = await A.evaluate(() => (document.querySelector('.ac-key') || {}).textContent || '');
    out.info.qr = await A.evaluate(() => { const i = document.querySelector('.ac-qr'); return i ? { loaded: i.complete && i.naturalWidth > 0, w: i.naturalWidth } : null; });
    await A.fill('.ac-code', totp(secret.replace(/\s/g, ''))); await A.click('.ac-btn.mk-save:not(.ac-link)'); await A.waitForTimeout(3000);
    out.info.tfa = await A.evaluate(() => (document.querySelector('.lb-ch-t') || {}).textContent);
    out.ok.twoFaOn = out.info.tfa === '2FA is on';
    out.ok.qrShows = !!(out.info.qr && out.info.qr.loaded);
    // 7) sign out, sign in by username -> asks for the code; a password-only session can't post
    await A.evaluate(async () => { await accSignOut(); accTab = 'in'; showPage('account'); }); await A.waitForTimeout(800);
    ins = await A.$$('.ac-in'); await ins[0].fill(U1.toUpperCase()); await ins[1].fill(PW); await A.click('.ac-btn.mk-save'); await A.waitForTimeout(4000);
    out.info.needCode = await A.evaluate(() => ({ need: ACCT.needCode, signed: accSignedIn() }));
    out.info.aal1Post = await A.evaluate(async () => { try { const s = (await authClient().auth.getSession()).data.session; const r = await fetch(SB_URL + '/rest/v1/scores', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', mode: 'hard', score: 3, bird: 'yellow', device: 'testtesttest', user_id: s.user.id }) }); return r.status; } catch (e) { return e.message; } });
    out.ok.codeAsked = out.info.needCode.need === true && !out.info.needCode.signed;
    out.ok.blockedBeforeCode = out.info.aal1Post !== 201;
    await A.waitForTimeout(31000);   // a fresh code
    await A.fill('.ac-code', totp(secret.replace(/\s/g, ''))); await A.click('.ac-btn.mk-save'); await A.waitForTimeout(4000);
    out.info.afterCode = await A.evaluate(() => ({ signed: accSignedIn(), kind: PK && PK.kind }));
    out.ok.codeSignIn = out.info.afterCode.signed;
    // 8) reload keeps you signed in
    await A.reload(); await A.waitForTimeout(5000);
    out.ok.staysSignedIn = await A.evaluate(() => accSignedIn());
    // 9) live duel between two accounts
    await B.evaluate(async (a) => { const r = await authClient().auth.signUp({ email: a.u.toLowerCase() + ACC_MAIL, password: a.pw, options: { data: { username: a.u, email_login: false } } }); await accSession('SIGNED_IN', r.data.session); }, { u: U2, pw: PW });
    await B.waitForTimeout(2000);
    const room = 'CI' + Math.floor(Math.random() * 9000 + 1000);
    await A.evaluate((r) => joinLive(r, true), room); await B.evaluate((r) => joinLive(r, false), room);
    await A.waitForTimeout(6000);
    out.info.live = { A: await A.evaluate(() => liveRoom && liveRoom.opp && liveRoom.opp.name), B: await B.evaluate(() => liveRoom && liveRoom.opp && liveRoom.opp.name) };
    out.ok.liveDuel = out.info.live.A === U2 && out.info.live.B === U1;
    // 11) friends: request, accept, online dot, live invite banner, a race sent to a friend, duel history, pictures
    const idA = await A.evaluate(() => ACCT.user.id), idB = await B.evaluate(() => ACCT.user.id);
    out.info.fr = {};
    out.info.fr.add = await A.evaluate(async (u) => { try { return await sb('rpc/friend_add', { method: 'POST', body: JSON.stringify({ name: u }) }); } catch (e) { return e.message; } }, U2);
    await B.evaluate(() => palsLoad()); await B.waitForTimeout(1500);
    out.info.fr.badge = await B.evaluate(() => palsBadge());
    out.info.fr.accept = await B.evaluate(async (u) => { try { return await sb('rpc/friend_add', { method: 'POST', body: JSON.stringify({ name: u }) }); } catch (e) { return e.message; } }, U1);
    await A.evaluate(() => palsLoad()); await A.waitForTimeout(4000);
    out.info.fr.friends = await A.evaluate((id) => palsIsFriend(id), idB);
    out.info.fr.online = await A.evaluate((id) => isOnline(id), idB);
    await A.evaluate((id) => rtSend(id, { t: 'live', room: 'ABCDE' }), idB); await B.waitForTimeout(2500);
    out.info.fr.invite = await B.evaluate(() => { const d = document.querySelector('.fr-inv'); return d ? d.textContent : null; });
    out.info.fr.race = await A.evaluate(async (id) => { try { const enc = JSON.parse(localStorage.getItem(ghostKey('normal'))); return await uploadRun(enc, 'normal', { to_user: id }); } catch (e) { return 'ERR ' + e.message; } }, idB);
    await B.evaluate(() => palsLoad()); await B.waitForTimeout(1500);
    out.info.fr.inbox = await B.evaluate(() => FR.inbox.map(g => g.name + ' ' + g.score));
    await B.evaluate(async (a) => { await recordMatch('race', a.gid, a.id, 0, 999, 'normal'); await recordMatch('live', 'live-CI-1-' + Date.now() % 1e6, a.id, 7, 4, 'normal'); }, { gid: out.info.fr.race, id: idA });
    out.info.fr.matches = await A.evaluate(async (id) => (await fetchMatches(id)).map(m => m.kind + ' ' + m.pa.username + ' ' + m.a_score + ':' + m.b_score + ' ' + m.pb.username), idA);
    out.info.fr.avatar = await A.evaluate(async () => { await sb('profiles?id=eq.' + ACCT.user.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ avatar: 'robin', avatar_bg: 'pink' }) }); const rows = await lbFetch('normal', false); const me = rows.find(r => r.user_id === ACCT.user.id); return me && me.profiles; });
    out.ok.friendRequest = out.info.fr.add === 'sent' && out.info.fr.badge === 1 && out.info.fr.accept === 'friends' && out.info.fr.friends;
    out.ok.onlineDot = out.info.fr.online;
    out.ok.liveInvite = !!(out.info.fr.invite && out.info.fr.invite.includes(U1));
    out.ok.raceToFriend = out.info.fr.inbox.length === 1;
    out.ok.duelHistory = out.info.fr.matches.length === 2 && out.info.fr.matches.some(m => /^race .* 0:5 /.test(m) || /^race .* 0:\d+ /.test(m));
    out.ok.pictureOnBoard = !!(out.info.fr.avatar && out.info.fr.avatar.avatar === 'robin');
    // 10) a profile anyone can open
    out.info.profile = await B.evaluate(async (id) => { accGo('profile', id); await new Promise(r => setTimeout(r, 3000)); return { name: document.querySelector('.ac-name').textContent, bests: document.querySelector('.ac-best').textContent, stats: document.querySelector('.ac-stats').textContent }; }, await A.evaluate(() => ACCT.user.id));
    out.ok.profilePage = out.info.profile.name === U1;
  } catch (e) { out.errors.push('test: ' + e.message.split('\n')[0]); }
  // clean up: delete both test accounts
  for (const P of [A, B]) if (P) { try { out.info['del' + (P === A ? 'A' : 'B')] = await P.evaluate(async () => { if (!accSignedIn()) return 'not signed in'; const id = ACCT.user.id; await sb('rpc/delete_my_account', { method: 'POST', body: '{}' }); const left = await sb('profiles?select=id&id=eq.' + id); return left.length ? 'still there' : 'deleted'; }); } catch (e) { out.info.delErr = e.message; } }
  out.ok.deleteAccount = out.info.delA === 'deleted';
  out.pass = Object.values(out.ok).every(Boolean) && !out.errors.length;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
