import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { command, extract } from "./ios.mjs";
import { save, sha } from "./files.mjs";
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "EVE Integration",
  GIT_AUTHOR_EMAIL: "integration@eve.invalid",
  GIT_COMMITTER_NAME: "EVE Integration",
  GIT_COMMITTER_EMAIL: "integration@eve.invalid",
};
const git = (cwd, args, author) =>
  command(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      env: author
        ? {
            ...env,
            GIT_AUTHOR_NAME: author,
            GIT_AUTHOR_EMAIL: author + "@eve.invalid",
          }
        : env,
    },
  );
export const ownership = {
  ui: {
    author: "ios",
    reviewer: "platform",
    file: "Product/ProductView.swift",
  },
  core: {
    author: "platform",
    reviewer: "ios",
    file: "Product/ProductModel.swift",
  },
};
export async function openPulls(dir, bytes) {
  await mkdir(dir, { recursive: true });
  const repo = await mkdtemp(join(dir, "repository-"));
  await extract(bytes, repo);
  const files = unzipSync(bytes);
  for (const { file } of Object.values(ownership)) await rm(join(repo, file));
  await git(repo, ["init", "-b", "integration"]);
  await git(repo, ["add", "."]);
  await git(repo, [
    "commit",
    "-m",
    "Validated company template and acceptance contract",
  ]);
  const base = (await git(repo, ["rev-parse", "HEAD"])).trim(),
    prs = {};
  for (const [id, owner] of Object.entries(ownership)) {
    await git(repo, ["switch", "-c", "employee/" + owner.author, base]);
    await save(join(repo, owner.file), files[owner.file]);
    await git(repo, ["add", "--", owner.file]);
    await git(
      repo,
      ["commit", "-m", id + ": deliver " + owner.file],
      owner.author,
    );
    const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const diff = await git(repo, ["diff", base, head]);
    await save(join(dir, id + ".patch"), diff);
    prs[id] = { ...owner, base, head, diff };
  }
  await git(repo, ["switch", "integration"]);
  return { repo, prs };
}
export function gate(prs, reviews, qa, approval) {
  for (const [id, owner] of Object.entries(ownership)) {
    const pr = prs[id],
      r = reviews[id];
    if (
      pr.author !== owner.author ||
      r.employee !== owner.reviewer ||
      pr.author === r.employee ||
      r.head !== pr.head ||
      r.verdict !== "pass"
    )
      throw Error("交叉评审未通过：" + id);
  }
  const heads = [prs.ui.head, prs.core.head];
  for (const [record, employee] of [
    [qa, "qa"],
    [approval, "cto"],
  ])
    if (
      record.employee !== employee ||
      record.verdict !== "pass" ||
      JSON.stringify(record.heads) !== JSON.stringify(heads)
    )
      throw Error("缺少当前两个 PR 的 QA/CTO 批准");
}
export async function integrate(s, bytes, approval) {
  gate(s.pull.prs, s.reviews, s.qa, approval);
  if (!s.evidence.passed || sha(bytes) !== s.evidence.sourceHash)
    throw Error("集成内容与验收版本不一致");
  const repo = s.pull.repo;
  for (const pr of Object.values(s.pull.prs))
    await git(repo, ["merge", "--no-ff", "--no-edit", pr.head]);
  const files = unzipSync(bytes),
    tracked = (await git(repo, ["ls-files", "-z"])).split("\0").filter(Boolean);
  if (tracked.length !== Object.keys(files).length)
    throw Error("集成文件清单与受测源码不一致");
  for (const f of tracked)
    if (!files[f] || sha(await readFile(join(repo, f))) !== sha(files[f]))
      throw Error("集成源码不匹配：" + f);
  return (await git(repo, ["rev-parse", "HEAD"])).trim();
}
