import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { emptyState } from "../src/lib/chess/coordinator.server";
import { SqlStateStore, type SqlLike } from "../src/lib/chess/sql-store";

function sqlite() {
  const db = new DatabaseSync(":memory:");
  const writes: string[] = [];
  const sql: SqlLike = {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      if (/^\s*SELECT/i.test(query)) return { toArray: () => statement.all(...bindings) as Record<string, unknown>[] };
      if (/^\s*(INSERT|DELETE)/i.test(query)) writes.push(query.split(" ")[0] + ":" + String(bindings[0]));
      statement.run(...bindings);
      return { toArray: () => [] };
    },
  };
  return { db, sql, writes };
}

test("entries are stored one per row and only changed rows are rewritten", async () => {
  const { sql, writes } = sqlite();
  const store = new SqlStateStore(sql);
  const state = emptyState();
  state.entries = { "card:1": { at: 1, value: { a: 1 } }, "meta:1": { at: 1, value: "m" } };
  await store.write(state);
  writes.length = 0;
  state.entries["card:1"] = { at: 2, value: { a: 2 } };
  delete state.entries["meta:1"];
  await store.write(state);
  assert.deepEqual(writes.filter((w) => !w.startsWith("INSERT:{")), ["INSERT:card:1", "DELETE:meta:1"]);
  const back = await new SqlStateStore(sql).read();
  assert.deepEqual(back?.entries, { "card:1": { at: 2, value: { a: 2 } } });
});

test("the old single-row layout is migrated once and then dropped", async () => {
  const { db, sql } = sqlite();
  const old = emptyState(); old.failures = 2; old.entries = { search: { at: 5, value: [1] } };
  db.exec("CREATE TABLE cache_state (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  db.prepare("INSERT INTO cache_state(id, body) VALUES (1, ?)").run(JSON.stringify(old));
  const migrated = await new SqlStateStore(sql).read();
  assert.equal(migrated?.failures, 2);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'cache_state'").all().length, 0);
  assert.deepEqual((await new SqlStateStore(sql).read())?.entries, old.entries);
});

test("two overlapping reads during the migration both succeed", async () => {
  const { db, sql } = sqlite();
  const old = emptyState(); old.entries = { search: { at: 5, value: [1] } };
  db.exec("CREATE TABLE cache_state (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  db.prepare("INSERT INTO cache_state(id, body) VALUES (1, ?)").run(JSON.stringify(old));
  const store = new SqlStateStore(sql);
  const [a, b] = await Promise.all([store.read(), store.read()]);
  assert.deepEqual(a?.entries, old.entries); assert.deepEqual(b?.entries, old.entries);
});
