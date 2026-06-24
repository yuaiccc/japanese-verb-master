import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

test('sqlite-vec loads into better-sqlite3', () => {
  const db = new Database(':memory:');
  sqliteVec.load(db);
  const { vec_version } = db.prepare('SELECT vec_version() AS vec_version').get() as any;
  assert.match(vec_version, /^v\d/);
  db.close();
});
