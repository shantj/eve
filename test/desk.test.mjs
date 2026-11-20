import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
const dir = await mkdtemp(join(tmpdir(), "eve-desk-test-"));
process.env.EVE_HOME = join(dir, "runs");
const { deskServer } = await import("../src/desk.mjs");
const { loadSettings } = await import("../src/desk-settings.mjs");
after(() => rm(dir, { force: true, recursive: true }));
async function start(opts) {
  const app = deskServer(opts);
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + app.address().port;
  return {
    app,
    url,
    call: (path, value, extra = {}) =>
      fetch(
        url + "/api/" + path,
        value === undefined
          ? {}
          : {
              method: "POST",
              headers: {
                Origin: url,
                "Content-Type": "application/json",
                "X-Eve-Desk": "1",
                ...extra,
              },
              body: JSON.stringify(value),
            },
      ),
  };
}
const close = (app) => new Promise((r) => app.close(r));
test("standalone work persists after disconnect, cannot dispatch twice, and ordinary restart restores the board", async () => {
  let finish, entered;
  const pending = new Promise((r) => (finish = r)),
    active = new Promise((r) => (entered = r));
  const srv = await start({
    execute: async () => {
      entered();
      await pending;
    },
  });
  let next;
  try {
    assert.equal(
      (
        await srv.call(
          "decisions",
          { text: "no internet dependency" },
          { Origin: "https://example.com" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await srv.call("decisions", { text: "iPhone first" })).status,
      201,
    );
    const { id } = await (await srv.call("projects", { demo: true })).json();
    const path = "projects/" + id;
    assert.equal((await srv.call(path + "/run", {})).status, 202);
    await active;
    assert.equal((await srv.call(path + "/run", {})).status, 409);
    assert.equal((await srv.call("stop", {})).status, 409);
    const project = await (await srv.call(path)).json();
    assert.equal(project.busy, "run");
    assert.equal(project.driver, "demo");
    finish();
    for (let n = 0; n < 40 && (await (await srv.call(path)).json()).busy; n++)
      await wait(5);
    assert.equal(
      (await srv.call(path + "/upload", { approve: "bad", confirm: true }))
        .status,
      409,
    );
    await close(srv.app);
    next = await start();
    const board = await (await next.call("desk")).json();
    assert.equal(board.projects[0].id, id);
    assert.equal(board.projects[0].busy, "");
    assert.equal(board.decisions[0].text, "iPhone first");
    assert.equal(Object.keys(board.roster).length, 9);
    assert.deepEqual(board.working, []);
  } finally {
    finish();
    if (srv.app.listening) await close(srv.app);
    if (next) await close(next.app);
  }
});
test("connection settings persist only locally, mask the key, and do not forward it to a new endpoint", async () => {
  const srv = await start();
  try {
    const config = {
      url: "http://127.0.0.1:7400/v1",
      model: "test",
      effort: "medium",
      roles: {
        qa: { model: "gpt-6.2-sol", effort: "high" },
        cto: { model: "", effort: "high" },
      },
      key: "test-only-not-a-real-key",
    };
    const result = await srv.call("settings", config);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).hasKey, true);
    assert.equal(
      (await stat(join(dir, "desk-settings.json"))).mode & 0o777,
      0o600,
    );
    delete process.env.EVE_API_KEY;
    delete process.env.EVE_MODEL_QA;
    delete process.env.EVE_REASONING_EFFORT_QA;
    await loadSettings();
    assert.equal(process.env.EVE_API_KEY, config.key);
    const { modelPolicy } = await import("../src/model-policy.mjs");
    assert.deepEqual(modelPolicy("qa"), {
      model: "gpt-6.2-sol",
      effort: "high",
    });
    assert.deepEqual(modelPolicy("cto"), { model: "test", effort: "high" });
    assert.deepEqual(modelPolicy("ios"), { model: "test", effort: "medium" });
    assert.equal(
      (
        await srv.call("settings", {
          ...config,
          roles: { qa: { effort: "wrong" } },
        })
      ).status,
      400,
    );
    assert.deepEqual(modelPolicy("qa"), {
      model: "gpt-6.2-sol",
      effort: "high",
    });
    assert.ok(!(await (await srv.call("desk")).text()).includes(config.key));
    const update = await srv.call("settings", {
      ...config,
      roles: { qa: { model: "", effort: "" } },
      url: "http://localhost:8500/v1",
      key: "",
    });
    assert.equal((await update.json()).hasKey, false);
    assert.equal(process.env.EVE_API_KEY, undefined);
    assert.deepEqual(modelPolicy("qa"), { model: "test", effort: "medium" });
  } finally {
    await close(srv.app);
  }
});

test("restart reclaims a dead worker but cannot take a live worker lock", async () => {
  const { locked } = await import("../src/files.mjs");
  const work = await mkdtemp(join(dir, "lock-"));
  const path = join(work, ".lock");
  await writeFile(path, String(process.pid));
  await assert.rejects(
    locked(work, () => true),
    /已锁定/,
  );
  await writeFile(path, "2147483647");
  assert.equal(await locked(work, () => true), true);
});
