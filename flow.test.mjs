import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {randomBytes, randomInt} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import QRCode from 'qrcode';

test('independent voters, live projector, moderation and persistent rounds', {timeout: 20000}, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'summit-flow-'));
  const port = String(randomInt(25000, 55000));
  const base = 'http://127.0.0.1:' + port;
  const password = randomBytes(24).toString('hex');
  let child;
  let stream;
  async function start() {
    child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, PORT: port, HOST: '127.0.0.1',
      DATA_DIR: dataDir, PUBLIC_ORIGIN: base, ADMIN_PASSWORD: password}, stdio: ['ignore','pipe','inherit']});
    const line = await Promise.race([
      once(child.stdout, 'data').then(([chunk]) => chunk.toString()),
      once(child, 'exit').then(([code]) => { throw new Error('Server exited ' + code); }),
    ]);
    assert.match(line, /Summit listening/);
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  async function send(path, headers = {}, payload) {
    const response = await fetch(base + path, {headers: {...headers, ...(payload && {'Content-Type':'application/json', Origin:base})},
      ...(payload && {method:'POST', body:JSON.stringify(payload)})});
    return {status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json()};
  }
  const auth = {Authorization: 'Bearer ' + password};
  const participant = cookie => send('/api/participant', cookie ? {Cookie: cookie} : {});
  const admin = (action, round, details = {}) => send('/api/admin', auth, {action, round, ...details});
  const vote = (session, score, feedback = '', round = session.data.round) =>
    send('/api/vote', {Cookie: session.cookie}, {round, scores: Array(10).fill(score), feedback});
  let eventBuffer = '';
  async function event() {
    while (!eventBuffer.includes('\n\n')) {
      const part = await stream.read();
      assert.equal(part.done, false);
      eventBuffer += Buffer.from(part.value).toString();
    }
    const end = eventBuffer.indexOf('\n\n');
    const line = eventBuffer.slice(0, end);
    eventBuffer = eventBuffer.slice(end + 2);
    return JSON.parse(line.slice(6));
  }
  try {
    await start();
    for (const route of ['/vote','/projector','/admin','/app.js','/style.css']) {
      assert.equal((await fetch(base + route)).status, 200);
    }
    assert.equal((await send('/api/admin')).status, 401);
    assert.equal((await send('/api/admin', {}, {action:'open'})).status, 401);
    const [a, b] = await Promise.all([participant(), participant()]);
    assert.notEqual(a.cookie, b.cookie);
    const round = a.data.round;
    assert.equal(round, b.data.round);
    stream = (await fetch(base + '/api/events')).body.getReader();
    const initial = await event();
    assert.equal(initial.voteUrl, base + '/vote');
    const qr = await fetch(base + '/qr.png');
    assert.equal(qr.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await qr.arrayBuffer()), await QRCode.toBuffer(initial.voteUrl, {width:440, margin:4, errorCorrectionLevel:'M'}));
    assert.equal((await vote(a, 5)).data.error, 'closed');
    assert.equal((await admin('open', round)).status, 200);
    assert.equal((await event()).open, true);
    assert.equal((await vote(a, 6)).status, 400);
    const concurrent = await Promise.all([vote(a, 5, 'Great teamwork!'), vote(a, 5, 'Great teamwork!'), vote(b, 3, 'Keep private')]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 201, 409]);
    assert.equal((await event()).count, 1);
    const hidden = await event();
    assert.equal(hidden.count, 2);
    assert.deepEqual(hidden.averages, []);
    assert.equal(hidden.overall, null);
    assert.deepEqual(hidden.feedback, []);
    assert.equal((await participant(a.cookie)).data.submitted, true);
    assert.equal((await admin('reveal', round, {stage:0})).status, 409);
    const closed = await admin('close', round);
    assert.equal((await event()).open, false);
    const entry = closed.data.moderation.find(row => row.feedback === 'Great teamwork!');
    await admin('moderate', round, {id:entry.id, approved:true});
    assert.deepEqual((await event()).feedback, []);
    for (let stage = 0; stage < 11; stage++) {
      assert.equal((await admin('reveal', round, {stage})).status, 200);
      const view = await event();
      assert.deepEqual(view.averages, Array(Math.min(stage + 1, 10)).fill(4));
      assert.equal(view.overall, stage === 10 ? 4 : null);
      assert.deepEqual(view.feedback, stage === 10 ? ['Great teamwork!'] : []);
      assert.equal((await admin('reveal', round, {stage})).status, 409);
    }
    await stream.cancel();
    stream = null;
    await stop();
    await start();
    const saved = await send('/api/admin', auth);
    assert.equal(saved.data.count, 2);
    assert.equal(saved.data.overall, 4);
    const reset = await admin('reset', round);
    assert.equal(reset.data.count, 0);
    assert.deepEqual(reset.data.moderation, []);
    assert.equal(reset.data.open, false);
    assert.notEqual(reset.data.round, round);
    assert.equal((await vote(a, 4)).data.error, 'round_changed');
    assert.equal((await participant(a.cookie)).data.submitted, false);
    await admin('open', reset.data.round);
    assert.equal((await vote(a, 4, '', reset.data.round)).status, 201);
  } finally {
    await stream?.cancel();
    await stop();
    await rm(dataDir, {recursive: true, force: true});
  }
});
