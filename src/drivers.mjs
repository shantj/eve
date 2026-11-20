import { join } from "node:path";
import { json, save, sha } from "./files.mjs";
import { modelPolicy } from "./model-policy.mjs";
import { assignment, validate } from "./roles.mjs";
import { renderArt } from "./art.mjs";

// The runtime owns identity, context, job routing and tools. The provider only returns content.
export const maestroURL = "http://127.0.0.1:23333/api/openai/v1";
export const isMaestro = (url) => {
  const u = new URL(url);
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
    u.pathname.replace(/\/+$/, "") === "/api/openai/v1"
  );
};
async function model(task) {
  const suffix = task.employeeId.toUpperCase();
  const base = (
    process.env["EVE_MODEL_URL_" + suffix] ||
    process.env.EVE_MODEL_URL ||
    maestroURL
  ).replace(/\/+$/, "");
  const url = new URL(base);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw Error("模型端点应为 HTTPS 或本机 HTTP");
  const { model: modelName, effort } = modelPolicy(task.employeeId);
  const key =
    process.env["EVE_API_KEY_" + suffix] ||
    (process.env["EVE_MODEL_URL_" + suffix]
      ? undefined
      : process.env.EVE_API_KEY);
  if (url.hostname === "api.openai.com" && !key)
    throw Error("请在「服务设置」连接支持所选模型的服务并配置凭据。");
  const maestro = isMaestro(base);
  const token = key || (base === maestroURL && process.env.MAESTRO_API_KEY);
  const schema = { name: task.job, schema: task.schema, strict: true };
  const objectMode = process.env.EVE_JSON_MODE === "object";
  const response = await fetch(
    base + (maestro ? "/responses" : "/chat/completions"),
    {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      signal: AbortSignal.timeout(240000),
      body: JSON.stringify(
        maestro
          ? {
              model: modelName,
              store: false,
              stream: false,
              ...(effort === "provider" ? {} : { reasoning: { effort } }),
              instructions:
                task.instructions +
                "\n只输出 JSON：" +
                JSON.stringify(task.schema),
              input: JSON.stringify(task.inputs),
              text: {
                format: objectMode
                  ? { type: "json_object" }
                  : { type: "json_schema", ...schema },
              },
            }
          : {
              model: modelName,
              ...(effort === "provider" ? {} : { reasoning_effort: effort }),
              messages: [
                {
                  role: "system",
                  content:
                    task.instructions +
                    "\n输出 JSON Schema：" +
                    JSON.stringify(task.schema),
                },
                { role: "user", content: JSON.stringify(task.inputs) },
              ],
              response_format:
                process.env.EVE_JSON_MODE === "object"
                  ? { type: "json_object" }
                  : {
                      type: "json_schema",
                      json_schema: schema,
                    },
            },
      ),
    },
  ).catch((e) => {
    throw Error(
      maestro
        ? "无法连接本机 Agent Maestro：请确认 VS Code 中的 API Server 正在运行。"
        : e.message,
    );
  });
  if (!response.ok)
    throw Error(
      "模型服务 HTTP " + response.status + "；检查端点、配额和模型配置后续跑",
    );
  const data = await response.json();
  return {
    output: JSON.parse(
      maestro
        ? (data.output || [])
            .flatMap((m) =>
              m.type === "message"
                ? m.content
                    .filter((x) => x.type === "output_text")
                    .map((x) => x.text)
                : [],
            )
            .join("")
        : data.choices?.[0]?.message?.content,
    ),
    model: data.model || modelName,
    requestedModel: modelName,
    effort,
    usage: data.usage,
  };
}
export async function deliver({ driver, dir, key, kind, inputs }) {
  const task = assignment(kind, inputs),
    folder = join(dir, "employees", task.employeeId, key),
    path = join(folder, "delivery.json"),
    fingerprint = sha(JSON.stringify(task));
  try {
    const old = await json(path);
    if (old.fingerprint !== fingerprint)
      throw Error("任务输入与已保存交付不一致：" + key);
    return validate(kind, old.output, inputs);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const start = new Date().toISOString();
  await save(join(folder, "assignment.json"), { ...task, startedAt: start });
  try {
    const r =
      driver === "demo"
        ? {
            output: await (
              await import("../examples/demo.mjs")
            ).fixture(kind, inputs),
            model: "fixed-fixture",
          }
        : await model(task);
    validate(kind, r.output, inputs);
    // Keep an invalid drawing out of the delivery cache so a retry can redraw it.
    if (kind === "design") renderArt(r.output.art);
    await save(path, {
      employee: task.employeeId,
      job: kind,
      startedAt: start,
      finishedAt: new Date().toISOString(),
      fingerprint,
      ...r,
    });
    return r.output;
  } catch (e) {
    await save(join(folder, "last-error.json"), {
      at: new Date().toISOString(),
      error: e.message,
    });
    throw e;
  }
}
