import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { zipSync, strToU8 } from "fflate";
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
                ...(value instanceof FormData
                  ? {}
                  : { "Content-Type": "application/json" }),
                "X-Eve-Desk": "1",
                ...extra,
              },
              body: value instanceof FormData ? value : JSON.stringify(value),
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

test("PRD-only project keeps original downloads and passes extracted text to employees of that project after restart", async () => {
  const { run, create } = await import("../src/company.mjs");
  const { fixture } = await import("../examples/demo.mjs");
  const doc = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>首次启动</w:t></w:r><w:r><w:t>必须离线。</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  const form = new FormData();
  form.append("attachments", new Blob([doc]), "需求说明.docx");
  form.append("attachments", new Blob(["# 验收\n可撤销记录"]), "补充.md");
  let srv = await start();
  try {
    assert.equal(
      (await srv.call("projects", form, { Origin: "https://example.com" }))
        .status,
      403,
    );
    const result = await srv.call("projects", form);
    assert.equal(result.status, 201);
    const { id } = await result.json();
    await close(srv.app);
    srv = await start();
    const p = await (await srv.call("projects/" + id)).json();
    assert.deepEqual(
      p.attachments.map((x) => x.name),
      ["需求说明.docx", "补充.md"],
    );
    assert.match(p.direction, /需求说明/);
    const path = "/attachments/" + p.attachments[0].id;
    const download = await srv.call("projects/" + id + path);
    assert.match(
      download.headers.get("content-disposition"),
      /attachment; filename\*/,
    );
    assert.deepEqual(
      Buffer.from(await download.arrayBuffer()),
      Buffer.from(doc),
    );
    const other = await create("另一项目");
    assert.equal((await srv.call("projects/" + other.id + path)).status, 404);
    const received = [];
    const agent = async ({ kind, inputs }) => {
      received.push([kind, inputs.projectAttachments]);
      if (kind === "design") throw Error("test checkpoint");
      return fixture(kind);
    };
    await assert.rejects(run(id, { agent, log: () => {} }), /test checkpoint/);
    for (const kind of ["charter", "product", "design"])
      assert.deepEqual(received.find((x) => x[0] === kind)[1], [
        { name: "需求说明.docx", text: "首次启动必须离线。" },
        { name: "补充.md", text: "# 验收\n可撤销记录" },
      ]);
    received.length = 0;
    await assert.rejects(
      run(other.id, { agent, log: () => {} }),
      /test checkpoint/,
    );
    assert.ok(received.every(([, docs]) => docs === undefined));
  } finally {
    await close(srv.app);
  }
});
test("invalid, oversized or unreadable attachments fail the whole project creation", async () => {
  const srv = await start();
  try {
    const before = (await (await srv.call("desk")).json()).projects.length;
    for (const [name, data] of [
      ["old.doc", "document"],
      ["broken.docx", "broken"],
      ["blank.txt", "   "],
      ["long.md", "x".repeat(60_001)],
      ["big.txt", new Uint8Array(5 * 1024 * 1024 + 1)],
    ]) {
      const form = new FormData();
      form.set("direction", "project");
      form.append("attachments", new Blob(["Valid text"]), "ok.md");
      form.append("attachments", new Blob([data]), name);
      assert.equal((await srv.call("projects", form)).status, 400, name);
    }
    assert.equal(
      (await (await srv.call("desk")).json()).projects.length,
      before,
    );
  } finally {
    await close(srv.app);
  }
});

test("PDF attachments supply selectable text and reject documents without text", async () => {
  const { prepareAttachments } = await import("../src/attachments.mjs");
  function pdf(text) {
    const stream = "BT /F1 14 Tf 50 700 Td (" + text + ") Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      [
        "<< /Length " + stream.length + " >>",
        "stream",
        stream,
        "endstream",
      ].join("\n"),
    ];
    let data = "%PDF-1.4\n";
    const offsets = [];
    for (const [i, obj] of objects.entries()) {
      offsets.push(data.length);
      data += [i + 1 + " 0 obj", obj, "endobj", ""].join("\n");
    }
    const start = data.length;
    data += [
      "xref",
      "0 6",
      "0000000000 65535 f ",
      ...offsets.map((n) => String(n).padStart(10, "0") + " 00000 n "),
      "trailer",
      "<< /Size 6 /Root 1 0 R >>",
      "startxref",
      String(start),
      "%%EOF",
      "",
    ].join("\n");
    return new File([data], "spec.pdf");
  }
  const [file] = await prepareAttachments([
    pdf("Offline acceptance milestone"),
  ]);
  assert.equal(file.text, "Offline acceptance milestone");
  await assert.rejects(prepareAttachments([pdf("")]), /OCR/);
});
