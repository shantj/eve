const $ = (s) => document.querySelector(s),
  view = $("#view"),
  modal = $("#modal");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  home: "M3 11 12 3l9 8v9h-6v-6H9v6H3z",
  folder: "M3 6h7l2 2h9v12H3z",
  team: "M15 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M14 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M17 5a3 3 0 0 1 0 6 M17 14a4 4 0 0 1 4 4v2",
  book: "M5 4h13v16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M8 8h7 M8 12h5",
  settings:
    "M4 7h8m4 0h4M4 17h3m5 0h8M16 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M12 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  plus: "M12 5v14 M5 12h14",
  arrow: "M4 12h15m-5-5 5 5-5 5",
  stack: "m3 8 9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  flag: "M5 21V4h12l-2 4 2 4H5",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 7v5l3 2",
  check: "m4 12 5 5 11-11",
  run: "m7 4 13 8-13 8z",
  box: "M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 5 8-5 M12 12v9",
};
const icon = (k) =>
  `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[k] || paths.folder}"/></svg>`;
for (const el of document.querySelectorAll("[data-ico]"))
  el.insertAdjacentHTML("afterbegin", icon(el.dataset.ico));
const labels = {
  home: "工作总览",
  projects: "项目档案",
  team: "公司成员",
  decisions: "决策记录",
  settings: "服务设置",
  apple: "提审账号",
};
const stages = {
  charter: "项目立项",
  discovery: "产品研究",
  design: "设计与架构",
  contract: "验收约定",
  build: "工程开发",
  consult: "技术讨论",
  pulls: "创建 PR",
  test: "模拟器测试",
  review: "交叉评审",
  approve: "CTO 签核",
  ready: "已交付",
  blocked: "等待 CEO",
  signed: "已签名",
  prepared: "待批准上传",
  uploaded: "已上传",
  submitted: "已送审",
  listed: "已上架",
  uploading: "上传待核对",
  submitting: "送审待核对",
};
const jobs = {
  charter: "制定项目章程",
  product: "定义产品需求",
  research: "研究用户假设",
  design: "设计交互",
  architecture: "确定技术接口",
  acceptance: "编写验收契约",
  ui: "开发客户端",
  core: "实现平台逻辑",
  listing: "准备商店资料",
  adviseUI: "答复客户端问题",
  adviseCore: "答复平台问题",
  decision: "裁决技术分歧",
  reviewUI: "评审客户端 PR",
  reviewCore: "评审平台 PR",
  verify: "独立验收",
  approve: "批准集成",
  readUI: "客户端作者读取 PR 评论",
  readCore: "平台作者读取 PR 评论",
};
const abbr = {
  ops: "运",
  product: "产",
  growth: "研",
  design: "设",
  cto: "技",
  ios: "端",
  platform: "台",
  qa: "测",
  release: "发",
};
const end = new Set([
  "ready",
  "blocked",
  "signed",
  "prepared",
  "uploaded",
  "submitted",
  "listed",
  "uploading",
  "submitting",
]);
const stage = (s) => stages[s] || s,
  role = (k) => D?.roster[k]?.name || k,
  fmt = (v) =>
    v
      ? new Date(v).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "—";
let D,
  P,
  tab = "overview",
  ticket = 0,
  noticeTimer,
  returnFocus = null;
const route = () => {
  const [key = "home", id = "", section = "overview"] = (
    location.hash.slice(1) || "home"
  ).split("/");
  return { key, id, section };
};
const api = async (path, data) => {
  const r = await fetch(
    "/api/" + path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Eve-Desk": "1" },
          body: JSON.stringify(data),
        },
  );
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "请求失败");
  return result;
};
const badge = (s, c = "") => `<span class="badge ${c}">${esc(s)}</span>`;
const stateBadge = (p) =>
  badge(
    p.busy ? "执行中" : p.error ? "需处理" : stage(p.phase),
    p.error || p.phase === "blocked"
      ? "warn"
      : ["ready", "listed"].includes(p.phase)
        ? "good"
        : "",
  );
const btn = (a, t, primary = false, i = "") =>
  `<button type="button" class="btn ${primary ? "primary" : ""}" data-act="${a}">${i ? icon(i) : ""}${esc(t)}</button>`;
const link = (url, title) =>
  `<a class="btn" target="_blank" rel="noopener" href="${url}">${esc(title)}</a>`;
const person = (k, i) =>
  `<span class="initial c${i % 3}">${abbr[k] || "职"}</span>`;
const head = (title, desc, action = "") =>
  `<div class="pagehead"><div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${action}</div>`;
const panel = (title, body, more = "") =>
  `<section class="panel"><div class="panelhead"><h2>${esc(title)}</h2>${more}</div>${body}</section>`;
const note = (t) => `<div class="note">${esc(t)}</div>`;
function tell(t) {
  clearTimeout(noticeTimer);
  const n = $("#notice");
  n.textContent = t;
  n.hidden = false;
  noticeTimer = setTimeout(() => (n.hidden = true), 4200);
}
function dialog(title, content) {
  returnFocus = document.activeElement;
  $("#dialog-body").innerHTML =
    `<div class="rowhead"><h2>${esc(title)}</h2><button class="x" data-act="close" aria-label="关闭">×</button></div><div class="section">${content}</div><div class="err secondaryline" role="alert" id="form-error"></div>`;
  if (!modal.open) modal.showModal();
  const f = modal.querySelector("textarea,input:not([type=checkbox])");
  if (f) f.focus();
}
modal.addEventListener("close", () => {
  if (returnFocus?.isConnected) returnFocus.focus();
});
function failure(e) {
  const t = e.message || String(e);
  if (modal.open) $("#form-error").textContent = t;
  else tell(t);
}
function projectRow(p) {
  return `<a class="listrow" href="#project/${p.id}"><span class="icoBox">${icon("folder")}</span><div class="grow"><strong>${esc(p.title)}</strong><small>${p.driver === "demo" ? "固定演示" : "正式项目"} · 第 ${p.attempt} 轮</small></div>${stateBadge(p)}</a>`;
}
function home() {
  const p = D.projects[0],
    active = D.projects.filter((x) => x.busy).length,
    team = Object.keys(D.roster).length;
  const stats = [
    ["team", team, "数字员工", ""],
    ["run", active, "正在执行的项目", "mint"],
    [
      "box",
      D.projects.filter((x) =>
        [
          "ready",
          "signed",
          "prepared",
          "uploaded",
          "submitted",
          "listed",
        ].includes(x.phase),
      ).length,
      "已交付项目",
      "peach",
    ],
  ];
  return (
    head(
      "CEO 工作台",
      "从一个产品方向开始，查看团队如何把它变成交付。",
      btn("new", "新建项目", true, "plus"),
    ) +
    `<section class="hero"><div class="copy"><span class="k">${icon("stack")}${p ? "最近的项目" : "公司已就绪"}</span><h2>${p ? esc(p.title) : "把第一个方向交给团队"}</h2><p>${p ? esc((p.driver === "demo" ? "演示项目" : "正式项目") + " · " + stage(p.phase) + " · 第 " + p.attempt + " 轮") : "填写要解决的问题，COO 会先梳理范围。"}</p>${p ? `<a class="linkbtn" href="#project/${p.id}">进入项目 ${icon("arrow")}</a>` : btn("demo", "体验示例项目")}</div><img class="art" src="/office.svg" alt=""></section><div class="stats">${stats.map(([i, n, t, c]) => `<div class="stat"><div class="icoBox ${c}">${icon(i)}</div><div><strong>${n}</strong><p>${t}</p></div></div>`).join("")}</div><div class="columns">${panel("项目档案", D.projects.slice(0, 4).map(projectRow).join("") || '<p class="empty">尚未立项，可以先体验演示。</p>', '<a class="linkbtn" href="#projects">查看全部</a>')}${panel("团队值班", `<div class="pad stack"><h3>${active ? "团队正在执行项目" : "团队待命中"}</h3><p class="sub">员工按任务工作。服务运行时，关闭浏览器也能继续执行。</p><a class="linkbtn" href="#team">查看 9 个岗位 ${icon("arrow")}</a></div>`)}</div>`
  );
}
function projects() {
  return (
    head(
      "项目档案",
      "打开一个项目，可以查看员工工单、签核记录和测试截图。",
      btn("new", "新建项目", true, "plus"),
    ) +
    panel(
      "全部项目",
      D.projects.map(projectRow).join("") ||
        '<p class="empty">还没有项目。</p>',
      btn("demo", "创建演示项目"),
    )
  );
}
function team() {
  return (
    head(
      "公司成员",
      "身份和交付记录长期保留。接到任务才调用模型，任务结束即回到待命。",
    ) +
    `<div class="slist">${Object.entries(D.roster)
      .map(
        ([k, r], i) =>
          `<article class="person">${person(k, i)}<div><h3>${esc(r.name)}</h3><div class="meta">${D.working.some((w) => w.owner === k) ? badge("正在处理工单", "good") : badge("待命")}</div><p class="sub">${esc(r.owns)}</p></div></article>`,
      )
      .join("")}</div>`
  );
}
function decisions() {
  return (
    head(
      "决策记录",
      "写下公司长期遵守的原则。新项目立项时会保存当时的决策快照。",
      btn("memo", "记录决定", true, "plus"),
    ) +
    panel(
      "CEO 决定",
      D.decisions.length
        ? D.decisions
            .map(
              (d) =>
                `<article class="person"><span class="initial c2">董</span><div class="grow"><div>${esc(d.text)}</div><small>CEO · ${fmt(d.date)}</small></div></article>`,
            )
            .join("")
        : '<p class="empty">还没有公司决定。可记录目标用户、预算边界或产品原则。</p>',
    )
  );
}
const field = (key, label, value = "", type = "text", required = true) =>
  `<label>${label}<input name="${key}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;
function effortSelect(name, current, inherit = false) {
  const options = [
    ...(inherit ? [["", "继承公司默认"]] : []),
    ["low", "low（低）"],
    ["medium", "medium（中）"],
    ["high", "high（高）"],
    ["provider", "由服务决定（不发送参数）"],
  ];
  return `<label>推理强度<select name="${name}">${options.map(([v, label]) => `<option value="${v}" ${current === v ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
}
function employeeSettings(c) {
  const rows = Object.entries(D.roster).map(([id, r]) => {
    const custom = c.roles?.[id] || {};
    return `<fieldset class="employee-policy"><legend>${esc(r.name)}</legend><div class="pair"><label>模型<input name="model_${id}" list="model-ids" value="${esc(custom.model || "")}" placeholder="继承公司默认"></label>${effortSelect("effort_" + id, custom.effort || "", true)}</div></fieldset>`;
  });
  return `<details><summary>按岗位设置模型与推理强度</summary><p class="hint secondaryline">两项可以分别继承。例如，仅给 QA 填写不同模型，它仍会使用公司的默认推理强度。请使用当前服务支持的模型 ID。</p>${rows.join("")}</details>`;
}
function settingsPage() {
  const c = D.settings;
  return (
    head(
      "服务设置",
      "当前连接：" +
        c.provider +
        "。本机 Maestro 需要 VS Code 的 Agent Maestro API Server 在线。演示不调用模型。",
    ) +
    `<div class="formbox">${panel("模型连接", `<form class="pad" data-form="settings">${field("url", "服务地址", c.url, "url")}<div class="pair"><label>公司默认模型<input name="model" required list="model-ids" value="${esc(c.model)}"></label>${effortSelect("effort", c.effort)}</div><datalist id="model-ids"><option value="gpt-6.2-astra"></option><option value="gpt-6.2-sol"></option></datalist><label>API Key<input name="key" type="password" autocomplete="new-password" placeholder="${c.hasKey ? "已配置；留空保留当前密钥" : "本机无认证的服务可留空"}"></label><p class="hint">保存在本机，不会回显。更换服务地址时请重新填写密钥。</p><label>响应格式<select name="mode"><option value="schema">严格 JSON Schema</option><option value="object" ${c.mode === "object" ? "selected" : ""}>JSON Object（兼容模式）</option></select></label>${employeeSettings(c)}<div class="actions"><button class="btn primary">保存连接</button>${badge(c.hasKey ? "已保存密钥" : "未填写 API Key", c.hasKey ? "good" : "")}</div></form>`)}${panel("服务如何运行", '<div class="pad stack"><p>这是仅监听本机的服务。浏览器只是入口；关闭页面不会停工。Mac 关机、休眠或服务停止时，员工不能执行任务。</p><p class="hint">重启服务后，打开未完成的项目，点击「继续执行」。公司档案保存在本机磁盘。</p><button class="btn" data-act="stop">停止本机服务</button></div>')}</div>`
  );
}
function mailboxState() {
  const m = D.reviewMailbox,
    c = D.releaseAccount;
  return (
    '<div class="rowhead">' +
    badge(c.enabled ? "每分钟检查" : "监听未开启", c.enabled ? "good" : "") +
    "<small>最近检查：" +
    fmt(m.checkedAt) +
    "</small></div><p>最近收到 Apple 邮件：" +
    fmt(m.lastSignal) +
    "　最近核对待审项目：" +
    fmt(m.lastSweep) +
    "</p>" +
    (m.error ? note(m.error) : "")
  );
}
function accountPage() {
  const c = D.releaseAccount;
  return (
    head(
      "提审账号",
      "发行经理通过 App Store Connect API 提审，使用收件箱发现审核更新。",
    ) +
    '<div class="formbox"><form class="panel pad" data-form="account"><h2>App Store Connect</h2><p class="hint">填写你在 Apple 使用的账号邮箱。实际授权使用团队 API 密钥，无需在这里填写 Apple ID 密码。</p>' +
    field("email", "提审账号邮箱", c.email, "email", false) +
    '<div class="pair">' +
    field("team", "Apple Team ID", c.team, "text", false) +
    field("keyId", "API Key ID", c.keyId, "text", false) +
    "</div>" +
    field("issuer", "Issuer ID", c.issuer, "text", false) +
    field("keyFile", "本机私钥路径（.p8）", c.keyFile, "text", false) +
    '<h2>审核通知收件箱</h2><p class="hint">使用实际接收 Apple 通知的邮箱。仅支持 TLS IMAP 和密码或邮箱专用密码；只读打开 INBOX，不改动邮件。更换主机、端口或用户后需重填密码。</p><div class="pair">' +
    field("host", "IMAP 主机", c.host, "text", false) +
    field("port", "TLS 端口", c.port, "number") +
    "</div>" +
    field("user", "邮箱登录名", c.user, "text", false) +
    '<label>邮箱专用密码<input type="password" name="password" autocomplete="new-password" placeholder="' +
    (c.hasPassword ? "已保存；留空保留" : "仅保存在本机") +
    '"></label>' +
    (c.hasPassword
      ? '<label class="check"><input type="checkbox" name="clearPassword">清除已保存的邮箱密码</label>'
      : "") +
    '<label class="check"><input name="enabled" type="checkbox" ' +
    (c.enabled ? "checked" : "") +
    '>在工作台服务运行时监听审核邮件</label><div class="actions"><button class="btn primary">保存提审账号</button></div></form>' +
    panel(
      "监听状态",
      '<div class="pad stack"><div id="mail-status">' +
        mailboxState() +
        '</div><p class="hint">Apple 来信触发版本核对；项目只在 Apple 确认对应构建的状态后更新。邮件不会触发上传或重新送审。</p><div class="actions">' +
        btn("mailtest", "测试已保存的邮箱连接") +
        btn("mailcheck", "立即检查") +
        "</div></div>",
    ) +
    "</div>"
  );
}
function newDialog() {
  dialog(
    "新建项目",
    `<form data-form="new"><label>CEO 方向<textarea name="direction" required maxlength="4000" placeholder="为谁做什么？第一版怎样才算成功？"></textarea></label><details><summary>iOS 发布标识（选填）</summary><div class="stack secondaryline">${field("bundleId", "Bundle ID", "", "text", false)}<div class="pair">${field("version", "版本", "1.0")}${field("buildNumber", "构建号", "1")}</div></div></details><p class="hint">项目保存在本机，不需要 GitHub 地址，也不会自动推送。正式上架请填写已注册的 Bundle ID。</p><div class="actions"><button class="btn primary">创建项目</button><button type="button" class="btn" data-act="close">取消</button></div></form>`,
  );
}
function project() {
  const p = P,
    id = p.id,
    base = "/api/projects/" + id;
  let action = "";
  if (!end.has(p.phase) && !p.busy)
    action = btn(
      "run",
      p.history.length || p.error ? "继续执行" : "派给团队",
      true,
      "run",
    );
  if (p.busy) action = badge("后台执行中", "good");
  const tabs = [
    ["overview", "项目进度"],
    ["work", "员工工单"],
    ["collab", "设计与评审"],
    ["delivery", "交付与发布"],
  ];
  let body = "";
  if (tab === "overview") {
    const progress = p.history
      .slice()
      .reverse()
      .map(
        (h) =>
          `<div class="listrow"><span class="icoBox mint">${icon("check")}</span><div class="grow"><strong>${esc(stage(h.from))} → ${esc(stage(h.next))}</strong>${h.note ? `<p class="sub">${esc(h.note)}</p>` : ""}<small>第 ${h.attempt} 轮 · ${fmt(h.at)}</small></div></div>`,
      )
      .join("");
    body = `<div class="columns">${panel("交接进度", progress || '<div class="empty">方向已保存，派给团队后会显示第一份工单。</div>')}${panel("项目简报", `<div class="pad stack"><p>${esc(p.direction)}</p><p class="hint path">${esc(p.identity.bundleId)}<br>iOS ${esc(p.identity.version)}（${esc(p.identity.buildNumber)}）</p>${p.driver === "demo" ? note("演示使用固定岗位响应；代码集成和模拟器测试实际执行。") : ""}</div>`)}</div>`;
  }
  if (tab === "work") {
    body = panel(
      "员工工单",
      p.tasks
        .map(
          (t, i) =>
            `<button class="listrow task" data-task="${esc(t.owner + "/" + t.key)}">${person(t.owner, i)}<span class="grow"><strong>${esc(jobs[t.kind] || t.kind)}</strong><small>${esc(role(t.owner))} · ${fmt(t.started)}</small></span>${badge(t.state === "done" ? "已交付" : t.state === "error" ? "需重试" : p.busy ? "处理中" : "未完成", t.state === "done" ? "good" : "")}</button>`,
        )
        .join("") || '<p class="empty">团队接单后会显示独立工单。</p>',
    );
  }
  if (tab === "collab") {
    const design = p.design
      ? '<div class="pad"><div class="brandproof"><img src="' +
        base +
        '/design/icon" alt="项目 App 图标"><img src="' +
        base +
        '/design/illustration" alt="应用内插画"></div><p>' +
        esc(p.design.concept) +
        '</p><p class="hint">' +
        esc(p.design.layout) +
        "</p></div>"
      : '<p class="empty">此档案尚无独立设计资产。新项目由产品设计师交付。</p>';
    const reviews = p.comments
      .slice()
      .reverse()
      .map(
        (c) =>
          '<article class="reviewpost"><div class="rowhead"><strong>' +
          esc(c.pr === "ui" ? "客户端 PR" : "平台 PR") +
          " · 第 " +
          esc(c.round) +
          " 轮</strong>" +
          badge(
            c.receipt ? "作者已读" : "已通知作者",
            c.receipt ? "good" : "",
          ) +
          "</div><small>" +
          esc(role(c.from)) +
          " → " +
          esc(role(c.to)) +
          " · " +
          fmt(c.sentAt) +
          " · " +
          esc(c.head.slice(0, 8)) +
          "</small><p>" +
          esc(c.assessment) +
          "</p>" +
          c.findings.map((f) => "<p>• " + esc(f) + "</p>").join("") +
          (c.receipt
            ? '<p class="note">作者回执：' +
              esc(c.receipt.action) +
              " · " +
              fmt(c.receipt.readAt) +
              "</p>"
            : "") +
          "</article>",
      )
      .join("");
    body =
      panel("设计师交付", design) +
      panel(
        "PR 评论与作者回执",
        reviews ||
          '<p class="empty">有评审意见后，这里会显示通知对象、提交版本和作者回执。</p>',
      );
  }
  if (tab === "delivery") {
    const checks = p.checks
      .map(
        (c, i) =>
          `<a target="_blank" rel="noopener" href="${base}/shots/${i}"><img loading="lazy" src="${base}/shots/${i}" alt="${esc(c.requirement)}">${esc(c.id + " · " + c.requirement)}</a>`,
      )
      .join("");
    body =
      panel(
        "验收与签核",
        `<div class="pad stack">${p.hasReport ? `<div class="actions">${link(base + "/report", "查看 CEO 报告")}${link(base + "/source", "下载受测源码")}${link(base + "/diff/ui", "客户端 PR")}${link(base + "/diff/core", "平台 PR")}</div><p>QA：${esc(p.qa)}</p><p>CTO：${esc(p.approval)}</p>` : '<p class="sub">集成并签核后，报告、两份 PR 和受测源码将在这里出现。</p>'}${checks ? `<p class="hint">${esc(p.device)} · 点击截图查看原图</p><div class="shots">${checks}</div>` : ""}</div>`,
      ) +
      panel(
        "本机文件",
        `<div class="pad stack"><p>项目档案</p><p class="hint path">${esc(p.projectDir)}</p>${p.repository ? `<p>本地 Git 仓库</p><p class="hint path">${esc(p.repository)}</p>` : ""}<p class="hint">工作台不会把代码自动推送到 GitHub。</p></div>`,
      ) +
      panel(
        "App Store 发布",
        `<div class="pad stack">${release(p, base)}</div>`,
      );
  }
  return `<a class="back" href="#projects">‹ 返回项目档案</a>${head(p.title, "第 " + p.attempt + " 轮 · " + (p.driver === "demo" ? "演示项目" : "正式项目"), action)}<div class="meta">${stateBadge(p)} <span class="tiny">${esc(p.id)}</span></div>${p.error || p.reason ? `<div class="err">${esc(p.error || p.reason)}</div>` : ""}<div class="tabs">${tabs.map(([k, t]) => `<button class="${tab === k ? "sel" : ""}" data-tab="${k}" aria-pressed="${tab === k}">${t}${k === "work" ? " (" + p.tasks.length + ")" : ""}</button>`).join("")}</div>${body}`;
}
function release(p, base) {
  if (p.driver === "demo")
    return note(
      "演示项目保留在本机，不会向 Apple 上传。正式项目需使用你自己的 Bundle ID 和签名。",
    );
  if (p.busy) return note("操作进行中，状态将自动刷新。");
  let a = "";
  if (p.phase === "ready") a = btn("sign", "签名并导出 IPA");
  if (["signed", "prepared"].includes(p.phase))
    a += btn("prepare", "填写商店资料");
  if (["prepared", "uploaded"].includes(p.phase))
    a +=
      link(base + "/manifest", "核对发布清单") +
      btn(
        p.phase === "prepared" ? "upload" : "submit",
        p.phase === "prepared" ? "批准上传至 Apple" : "批准提交 Apple 审核",
        true,
      );
  if (
    ["uploading", "uploaded", "submitting", "submitted", "listed"].includes(
      p.phase,
    )
  )
    a += btn("sync", "同步 Apple 状态");
  return `<p>${esc(p.listing?.summary || "验收完成后可准备签名和商店资料。")}</p>${p.storeStatus ? `<p class="hint">Apple：${esc(p.storeStatus.versionState)} · ${fmt(p.storeStatus.checkedAt)}</p>` : ""}<div class="actions">${a}</div>`;
}
function releaseDialog(a) {
  const p = P;
  let content = "";
  if (a === "sign")
    content =
      field("team", "Apple Team ID", D.releaseAccount.team) +
      '<p class="hint">使用这台 Mac 的分发签名，只生成本地 IPA。</p>';
  if (a === "prepare")
    content =
      field("supportURL", "支持网站", "", "url") +
      field("privacyURL", "隐私政策网址", "", "url") +
      `<div class="pair">${field("firstName", "审核联系人名")}${field("lastName", "审核联系人姓")}</div>` +
      field("email", "联系邮箱", D.releaseAccount.email, "email") +
      field("phone", "联系电话") +
      field("whatsNew", "版本更新说明", "", "text", false) +
      '<label class="check"><input type="checkbox" name="releaseAfterApproval">Apple 审核通过后自动发布</label>';
  if (["upload", "submit"].includes(a))
    content = `<p>${esc(p.title)} · ${esc(p.identity.bundleId)} · ${esc(p.identity.version)} (${esc(p.identity.buildNumber)})</p><p class="hint path">当前清单 SHA-256：${esc(p.releaseHash)}</p>${link("/api/projects/" + p.id + "/manifest", "打开当前发布清单")}<label class="check"><input type="checkbox" name="confirm" required>我已核对清单，批准此次${a === "upload" ? "上传" : "提交审核"}。</label>`;
  const title = {
    sign: "签名并导出 IPA",
    prepare: "准备商店资料",
    upload: "上传至 Apple",
    submit: "提交 Apple 审核",
  }[a];
  dialog(
    title,
    `<form data-form="release" data-action="${a}" data-hash="${esc(p.releaseHash)}">${content}<button class="btn primary">${title}</button></form>`,
  );
}
function render() {
  const r = route();
  const selected = r.key === "project" ? "projects" : r.key;
  for (const a of document.querySelectorAll("#rail a[href]")) {
    const on =
      a.getAttribute("href") === "#" + selected && !a.matches(".brand");
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  $("#crumb").textContent =
    "工作区  /  " +
    (r.key === "project"
      ? "项目档案  /  项目详情"
      : labels[r.key] || "工作总览");
  view.innerHTML =
    r.key === "project" && P
      ? project()
      : (
          {
            home,
            projects,
            team,
            decisions,
            apple: accountPage,
            settings: settingsPage,
          }[r.key] || home
        )();
}
async function refresh(full = true) {
  const t = ++ticket,
    r = route();
  try {
    const [d, p] = await Promise.all([
      api("desk"),
      r.key === "project" ? api("projects/" + r.id) : Promise.resolve(null),
    ]);
    if (t !== ticket) return;
    tab = ["overview", "collab", "work", "delivery"].includes(r.section)
      ? r.section
      : "overview";
    const changed = JSON.stringify([d, p]) !== JSON.stringify([D, P]);
    D = d;
    P = p;
    $("#health").className = "health";
    $("#health").innerHTML = "<i></i>本机服务运行中";
    if (
      full ||
      (changed && !["settings", "apple"].includes(r.key) && !modal.open)
    )
      render();
    else if (r.key === "apple" && $("#mail-status"))
      $("#mail-status").innerHTML = mailboxState();
  } catch (e) {
    if (t !== ticket) return;
    $("#health").className = "health off";
    $("#health").textContent = "连接异常";
    if (full)
      view.innerHTML = note(
        e.message + "。请确认本机服务已启动，或返回工作总览。",
      );
  }
}
async function go(id) {
  if (modal.open) modal.close();
  if (location.hash === "#project/" + id) await refresh();
  else location.hash = "project/" + id;
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("button");
  if (!el) return;
  const { act, tab: next, task } = el.dataset;
  if (next) {
    location.hash = "project/" + P.id + "/" + next;
    return;
  }
  if (!act && !task) return;
  try {
    if (act === "close") return modal.close();
    if (act === "mailtest" || act === "mailcheck") {
      el.disabled = true;
      const r = await api(
        "review-mail/" + (act === "mailtest" ? "test" : "check"),
        {},
      );
      await refresh();
      return tell(
        act === "mailtest"
          ? "已通过 TLS 只读打开收件箱。"
          : r.enabled === false
            ? "监听尚未开启。"
            : "检查完成。",
      );
    }
    if (act === "stop")
      return dialog(
        "停止本机服务",
        '<form data-form="stop"><p>公司档案会保留。下次双击启动器即可重新打开；正在执行项目时不能停止服务。</p><button class="btn">确认停止服务</button></form>',
      );
    if (act === "new") return newDialog();
    if (act === "memo")
      return dialog(
        "记录公司决定",
        '<form data-form="memo"><label>决定内容<textarea name="text" required maxlength="4000" placeholder="以后立项时都要遵循什么原则？"></textarea></label><button class="btn primary">保存决定</button></form>',
      );
    if (task) {
      const t = P.tasks.find((t) => t.owner + "/" + t.key === task);
      const details = await api("projects/" + P.id + "/tasks/" + task);
      return dialog(
        jobs[t.kind] || t.kind,
        `<p class="hint">${esc(role(t.owner))} · ${esc(t.model || "尚未交付")}${t.effort ? " · 推理：" + esc(t.effort === "provider" ? "由服务决定" : t.effort) : ""}</p>${t.error ? note(t.error) : ""}<h3>岗位交付</h3><pre>${esc(details.output ? JSON.stringify(details.output, null, 2) : "等待员工交付")}</pre><details><summary>查看任务输入</summary><pre>${esc(JSON.stringify(details.input, null, 2))}</pre></details>`,
      );
    }
    if (act === "demo") {
      el.disabled = true;
      const x = await api("projects", { demo: true });
      return go(x.id);
    }
    if (["sign", "prepare", "upload", "submit"].includes(act))
      return releaseDialog(act);
    if (act === "run" || act === "sync") {
      el.disabled = true;
      await api("projects/" + P.id + "/" + act, {});
      tell(
        act === "run" ? "已派给团队，可关闭浏览器。" : "正在同步 Apple 状态。",
      );
      await refresh();
    }
  } catch (e) {
    el.disabled = false;
    failure(e);
  }
});
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (!f.matches("form[data-form]")) return;
  e.preventDefault();
  const fields = Object.fromEntries(new FormData(f)),
    submit = f.querySelector('button:not([type="button"])');
  submit.disabled = true;
  try {
    const type = f.dataset.form;
    if (type === "account") {
      await api("release-account", {
        ...fields,
        enabled: fields.enabled === "on",
        clearPassword: fields.clearPassword === "on",
      });
      await refresh();
      tell("提审账号已保存。");
    }
    if (type === "stop") {
      await api("stop", {});
      modal.close();
      document.querySelector("#health").className = "health off";
      document.querySelector("#health").textContent = "服务已停止";
      view.innerHTML = note(
        "本机服务已停止。请双击「启动 EVE.command」重新打开工作台。",
      );
      return;
    }
    if (type === "new") {
      const x = await api("projects", fields);
      await go(x.id);
      tell("项目已保存。");
    }
    if (type === "memo") {
      await api("decisions", fields);
      modal.close();
      await refresh();
      tell("公司决定已保存。");
    }
    if (type === "settings") {
      fields.roles = Object.fromEntries(
        Object.keys(D.roster).map((id) => {
          const model = fields["model_" + id],
            effort = fields["effort_" + id];
          delete fields["model_" + id];
          delete fields["effort_" + id];
          return [id, { model, effort }];
        }),
      );
      await api("settings", fields);
      await refresh();
      tell("模型连接已保存。");
    }
    if (type === "release") {
      await api("projects/" + P.id + "/" + f.dataset.action, {
        ...fields,
        confirm: fields.confirm === "on",
        releaseAfterApproval: fields.releaseAfterApproval === "on",
        approve: f.dataset.hash,
      });
      modal.close();
      await refresh();
      tell("操作已提交。");
    }
  } catch (e) {
    failure(e);
  } finally {
    submit.disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  if (modal.open) modal.close();
  window.scrollTo(0, 0);
  refresh();
});
window.addEventListener("focus", () => refresh(false));
setInterval(() => {
  if (!document.hidden && !modal.open) refresh(false);
}, 3000);
refresh();
