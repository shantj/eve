#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { root, runDir, json } from "../src/files.mjs";
import { create, run, readRun, memo } from "../src/company.mjs";
import { archive, prepare, ship, sync } from "../src/publish.mjs";
import { roster } from "../src/roles.mjs";
import { direction } from "../examples/demo.mjs";
const help =
  'EVE 数字公司\n  team | board | memo "CEO 决定"\n  new "方向" [--bundle-id <id> --version 1.0 --build 1]\n  run <id> | work <id> | status <id> | demo\n  sign <id> --team <Apple Team ID>\n  prepare <id> --profile <商店资料.json>\n  upload <id> --approve <发布摘要> | submit <id> --approve <发布摘要> | sync <id>';
function status(s) {
  console.log(
    [s.id, s.phase, "v" + s.attempt, s.driver, s.direction].join(" | "),
  );
  if (s.reason) console.log(s.reason);
  if (s.digest)
    console.log("CEO 报告：" + join(runDir(s.id), "release", "CEO.md"));
  if (s.releaseHash)
    console.log(
      "待批准发布摘要：" +
        s.releaseHash +
        "\n清单：" +
        join(s.submission, "manifest.json"),
    );
  if (s.storeStatus) console.log(s.storeStatus);
}
async function main() {
  const {
    positionals: [cmd, ...args],
    values: v,
  } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      ["bundle-id", "version", "build", "team", "profile", "approve"].map(
        (k) => [k, { type: "string" }],
      ),
    ),
  });
  const id = args[0];
  switch (cmd) {
    case undefined:
    case "help":
      return console.log(help);
    case "team":
      for (const [k, r] of Object.entries(roster))
        console.log(k + " | " + r.name + " | " + r.owns);
      return;
    case "board": {
      let list = [];
      try {
        list = await readdir(root, { withFileTypes: true });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      for (const d of list.filter((x) => x.isDirectory()))
        status(await readRun(d.name));
      return;
    }
    case "work": {
      const s = await readRun(id);
      status(s);
      for (const [employee, r] of Object.entries(roster)) {
        const dir = join(runDir(id), "employees", employee);
        let tasks = [];
        try {
          tasks = await readdir(dir);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        for (const task of tasks) {
          let delivery;
          try {
            delivery = await json(join(dir, task, "delivery.json"));
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
          let state = "已派单";
          if (!delivery) {
            try {
              await json(join(dir, task, "last-error.json"));
              state = "需重试";
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
            }
          }
          console.log(
            r.name +
              " | " +
              task +
              " | " +
              (delivery ? "已交付 · " + delivery.model : state),
          );
        }
      }
      return;
    }
    case "memo":
      return console.log(await memo(args.join(" ")));
    case "new": {
      const s = await create(
        args.join(" "),
        "model",
        Object.fromEntries(
          [
            ["bundleId", v["bundle-id"]],
            ["version", v.version],
            ["buildNumber", v.build],
          ].filter(([, x]) => x),
        ),
      );
      status(s);
      console.log("续跑：npm start -- run " + s.id);
      return;
    }
    case "demo":
    case "run": {
      const s = await run(
        cmd === "demo" ? (await create(direction, "demo")).id : id,
      );
      status(s);
      if (s.phase === "blocked") process.exitCode = 2;
      return;
    }
    case "status":
      return status(await readRun(id));
    case "sign":
      return status(await archive(id, v.team));
    case "prepare":
      return status(await prepare(id, v.profile));
    case "upload":
    case "submit":
      return status(await ship(id, cmd, v.approve));
    case "sync":
      return status(await sync(id));
    default:
      throw Error(help);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
