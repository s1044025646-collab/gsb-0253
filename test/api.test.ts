import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server';
import { Store } from '../src/store';
import { emptyBoard } from '../src/engine';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';

let server: Server;
let base: string;

before(async () => {
  const store = new Store(':memory:');
  server = createServer(store);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('API 全流程：创建/合法列/执行/步骤/回放/导出', async () => {
  const created = await post('/api/games', {
    initialBoard: emptyBoard(6, 6),
    sequence: ['I', 'O'],
  });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const legal = await fetch(`${base}/api/games/${id}/legal-columns?rotation=0`);
  assert.deepEqual((await legal.json()).columns, [0, 1, 2]);

  const step1 = await post(`/api/games/${id}/steps`, { rotation: 0, column: 0, expectedStep: 1 });
  assert.equal(step1.status, 201);
  assert.equal(step1.json.piece, 'I');
  assert.equal(step1.json.dropDistance, 5);

  const dup = await post(`/api/games/${id}/steps`, { rotation: 0, column: 0, expectedStep: 1 });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'STALE_STEP');

  const bad = await post(`/api/games/${id}/steps`, { rotation: 9, column: 0, expectedStep: 2 });
  assert.equal(bad.json.error.code, 'INVALID_ROTATION');

  await post(`/api/games/${id}/steps`, { rotation: 0, column: 2, expectedStep: 2 });
  const steps = await (await fetch(`${base}/api/games/${id}/steps`)).json();
  assert.equal(steps.length, 2);
  const stepDetail = await (await fetch(`${base}/api/games/${id}/steps/1`)).json();
  assert.equal(stepDetail.piece, 'I');

  const replay = await post(`/api/games/${id}/replay`, {});
  assert.equal(replay.json.stepsChecked, 2);

  const exp = await (await fetch(`${base}/api/games/${id}/export`)).json();
  assert.equal(exp.steps.length, 2);
  assert.deepEqual(exp.replay.board, replay.json.board);

  const invalid = await post('/api/games', { initialBoard: [[0, 1], [1]], sequence: ['I'] });
  assert.equal(invalid.json.error.code, 'INVALID_BOARD');

  const notFound = await fetch(`${base}/api/games/999`);
  assert.equal(notFound.status, 404);
});
