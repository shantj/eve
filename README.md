# EVE · 数字人公司

你提出方向，九个员工协作交付。先看 [组织与决策权](company/组织与决策权.md)：谁开发、遇事找谁、谁 review、谁 approve、谁能发布。岗位的运行时定义在 [roster.json](company/roster.json)。

这是独立的 Node.js harness。它拥有组织、任务调度、状态机、员工任务箱和交付记录、项目档案、模型适配、Git 集成、测试与发布工具。模型服务只接收某位员工的一项任务并返回结构化结果。运行时不调用 Codex CLI，也不需要聊天窗口或常驻的九个模型进程。

## 用浏览器管理公司（推荐）

在 macOS 的 Finder 中双击仓库里的 **启动 EVE.command**。它在后台启动仅监听本机的服务，并在默认浏览器打开 [CEO 工作台](http://127.0.0.1:4317)。下次双击会复用已启动的服务。首次使用需要 Node.js 20+，若缺少项目依赖，启动器将运行 npm ci。也可以在仓库目录执行 `npm run desk` 前台运行。

1. 先体验：点「项目档案」→「创建演示项目」→「派给团队」。如果已有交付，直接进入项目看员工工单、技术讨论、两份 PR 和测试截图。演示无需模型密钥；真实模拟器验收需要 Xcode。
2. 正式立项：确认 VS Code 中的 Agent Maestro API Server 已启动（有认证时在「服务设置」填写其 LLM Key），然后「新建项目」写方向，保存后点「派给团队」。需要上架时请在立项表单填写注册的 Bundle ID。默认模型连接仅保存到本机 .eve/desk-settings.json（所有者读写），不向页面返回密钥；CLI 继续使用环境变量。
3. 点「公司成员」看哪些岗位正在处理工单；项目详情展示可续跑的阶段、错误原因和各员工的实际交付。公司共同遵循的原则可在「决策记录」登记。
4. 在「交付与发布」查看 CEO 报告、源码及截图。正式项目可在此签名、填写资料、审阅清单、明确批准上传和送审。签名身份、Apple 凭据与 fastlane 等本机条件仍按下文配置。

**已有 PRD？** 在「新建项目 → 项目附件」选择 Word（.docx）、文字版 PDF、Markdown 或 UTF-8 的 TXT。可以只传 PRD，也可以补充 CEO 方向。最多 5 份，每份不超过 5 MB、合计 10 MB，提取的正文合计最多 6 万字符。不解析文档内图片，扫描件请先做 OCR。原件可在「项目进度 → 项目附件」下载；执行时，文档正文随本项目工单交给岗位所配置的模型。资料不会成为公司决策或进入其他项目。Mac 使用 Swift/PDFKit 提取 PDF；非 macOS 工作台需安装 pdftotext。

**服务在线 ≠ 九个模型一直运行。** 服务接收任务、记录状态和调度员工；每个员工按任务请求模型，不会在待命时持续推理。关闭浏览器、Codex 或双击启动器的窗口，不会停止独立服务。Mac 休眠期间不能继续执行；重启 Mac 后需要再次双击启动器，在未完成项目内点「继续执行」。默认不安装开机自启；只有启用提审邮箱监听后，才会后台核对待审项目。可在「服务设置」中停止空闲服务。前台方式运行时，关闭其终端也会停止服务。

## 第一次运行

需要 Node.js 20+、Git；运行 iOS 验收还需要 macOS、Xcode 16.3+ 和可用的 iPhone 模拟器。首版交付支持 SwiftUI、iOS 17+、离线本机 UserDefaults，不含服务端、支付和第三方 SDK。

~~~bash
npm ci
npm start -- team
npm run demo
npm test
~~~

演示业务是「专注轮次」：记录一次、撤销、重开保留。**演示的岗位回答是固定样本**；请求编排、Git 分支和提交、集成门槛、原生编译、XCUITest、截图和交付报告都是真实执行。`npm test` 另用本地 HTTP 模型替身验证并发、断点续跑、技术讨论、拒收和权限分离，不需要 Apple 账号。可将 `EVE_SIMULATOR_UDID` 设为 `xcrun simctl list devices available` 中的 iPhone UDID；准备商店截图优先选择 Pro Max。

设计样例：[林间手记的完整设计交付](examples/field-notes-design/design.json)、[App 图标](examples/field-notes-design/icon.png)、[应用内插画](examples/field-notes-design/illustration.png)。这份观鸟手记设计来自本机 Maestro 的真实设计师工单。

## 用自己的模型经营公司

公司默认使用 GPT-6.2 Astra，推理强度 high。在「服务设置 → 按岗位设置模型与推理强度」中，两个字段独立继承。仅对支持推理参数的服务发送 low、medium 或 high；选「由服务决定」则不发送 reasoning_effort。实际可用模型取决于配置的服务与账号权限。新配置用于后续模型请求，不会重写已完成的工单。

EVE 默认直连本机 Agent Maestro 的 Responses 接口（与这台 Mac 的 Codex 同一路由），不启动 Codex。VS Code 扩展须保持运行；Maestro 是本机网关，模型推理不一定在本机。支持自定义 Maestro 端口（保留 /api/openai/v1 路径），也可显式切换至兼容 Chat Completions 的服务。远端使用 HTTPS，本机服务可使用 HTTP。每个岗位是独立的模型请求；默认不向模型提供 shell、签名密钥或发布凭据。公司在本地执行工具。

~~~bash
# 默认地址，无需设置：
# EVE_MODEL_URL=http://127.0.0.1:23333/api/openai/v1
# 默认地址若启用了鉴权，可使用 MAESTRO_API_KEY 或在工作台填写 Maestro 的 LLM Key。
# 公司默认值（可省略）
export EVE_MODEL='gpt-6.2-astra'
export EVE_REASONING_EFFORT='high'
# EVE_API_KEY 由本机环境或密钥管理器注入。本机无需认证的端点可留空。
# 示例：只让独立 QA 使用另一模型；不设置时继承公司默认。
# export EVE_MODEL_QA='gpt-6.2-sol'
# export EVE_REASONING_EFFORT_QA='high'
# 也可按员工设置 EVE_MODEL_URL_QA / EVE_API_KEY_QA 等。
# 仅支持 JSON object 而不支持 strict JSON Schema 的服务：EVE_JSON_MODE=object
npm start -- memo '本阶段优先做无账号、可离线使用的产品。'
npm start -- new '给独立开发者做一个专注轮次记录器' --bundle-id com.yourstudio.focus --version 1.0 --build 1
npm start -- run <项目编号>
npm start -- work <项目编号>
npm start -- board
~~~

`memo` 是 CEO 的长期决定，新立项会保存当时的决策快照。新建项目不需要 GitHub 地址。源码保存在本机；到「交付与发布 → 本机文件」查看项目目录和 Git 仓库路径，验收通过后可下载源码。未指定 Bundle ID 时使用本地试验标识；正式产品在立项时传入已注册的标识。一个项目的一次迭代只交付一个版本。研究岗位交付待验证的假设和实验，不会凭空产生真实用户反馈。

## 工作如何交接

1. COO 从方向写章程。产品和研究并行，之后设计师和 CTO 分别设计交互、技术接口。QA 将每条需求映射为可执行的模拟器断言。
2. 客户端和平台两名工程师独立实现；发行经理同时准备文案。工程师可以报告 `blocked`，向同事求助，由 CTO 留下技术决定再续做。
3. 两条本地 Git 分支各产生一个可检查 diff 的变更请求。harness 用两份代码构成的候选版本跑 XCUITest，保留 `.xcresult` 和每条验收的截图。这里的 PR 在本地工作，不会向 GitHub 创建远程 PR 或冒充两个 GitHub 账号。
4. 代码交叉评审，QA 独立验收，CTO 批准具体提交。运行时验证评审者与作者不同、评审的提交未变、两项变更都有测试证据，再执行 Git merge。任何拒收都会返工；连续三版失败转交 CEO。网络、凭据或模拟器环境错误保留当前阶段，修好后执行同一 `run`。已成功的并行任务按输入摘要复用。
5. 生成受测源码包、集成提交、商店文案和 CEO 报告。`ready` 指本地工程交付完成，未发送给 Apple。

评审人一交付，harness 就以其身份在对应的本地 PR 发布评论，并向该提交的作者投递通知。作者接到独立工单，从 PR 原始记录读取该批评论和 diff，写下处理决定；返工时只取自己收到的评论。QA 和 CTO 可指明客户端、平台或两者。每条通知按项目、轮次、提交及评审岗位去重，已读回执可在「设计与评审」查询。

## 从交付到 App Store

准备一个自己的 App Store Connect 应用记录与已注册 Bundle ID；本机需要可用的分发证书、匹配的描述文件和 Apple 团队。首版、隐私声明/营养标签、年龄分级、分类、定价/地区、出口合规以及协议等账户事实由负责人在 App Store Connect 核实。每个新项目由产品设计师为该产品画 App 图标与应用内插画。配色、路径与版式一起交给客户端工程师，PNG 随受测源码进入资产目录。「项目 → 设计与评审」可看预览与设计说明。旧项目的快照保持原样。

进入工作台左侧「提审账号」，填写提审账号邮箱、Team ID、Issuer ID、Key ID 和本机 .p8 路径。提审使用 API Key，账号邮箱可预填审核联系人。要监听通知，配置实际接收 Apple 邮件的 IMAP TLS 主机、端口、登录名和邮箱专用密码，保存后可先测试连接，再勾选启用。配置保存在本机 .eve/release-account.json（0600），页面不回显密码。未启用时只会在点击测试时访问邮箱。

启用后，每分钟只读查询 INBOX；初次或邮箱 UID 变更时回看近一天，之后从保存的 UID 续查。来自 Apple 的邮件触发对本公司所有待审正式项目的状态核对，不依赖邮件标题猜项目；同一批邮件只触发一轮核对，每半小时也进行补查。每个项目仍须通过 API 匹配 Bundle ID、版本和构建；拒绝时显示 Apple 状态并转交 CEO，详细拒审理由去 App Store Connect 查看。该服务不替你改 Apple 通知订阅，不回信、不自动重提。

~~~bash
# 本地签名并导出可上传的 IPA；不会上传 Apple。
npm start -- sign <项目编号> --team <Apple-Team-ID>
# 用 examples/store-profile.json 做副本，填入真实联系方式、HTTPS 链接和发布方式。
npm start -- prepare <项目编号> --profile /absolute/path/to/store-profile.json
# 审阅输出的 manifest.json、IPA、商店材料及截图。以下两个命令使用同一个已批准清单。
# 将 ASC_KEY_ID、ASC_ISSUER_ID、ASC_KEY_FILE（.p8 路径）注入本机环境。
npm start -- upload <项目编号> --approve <完整发布摘要>
bundle install
npm start -- submit <项目编号> --approve <完整发布摘要>
npm start -- sync <项目编号>
~~~

`prepare` 从模拟器证据目录取截图，也可以在 profile 中指定 `screenshots`（1–10 张真实、已审核的大屏 iPhone 竖屏 PNG 的绝对路径）。更新版本需填写 `whatsNew`。首版商店资料为简体中文，App 记录需支持该语言。`submit` 使用 fastlane deliver 上传本版本元数据并替换对应截图，选择精确的版本号与构建号送审。`releaseAfterApproval: true` 表示通过 Apple 审核后自动发布；为 `false` 时负责人在 App Store Connect 手动发布。

`uploaded` 表示上传工具成功，`submitted` 表示送审成功；只有 `sync` 拿到匹配 App、版本和构建的 Apple 在售状态才会记为 `listed`。外部操作没有回执时保留 `uploading` 或 `submitting`，不会盲目重复操作；先 `sync` 核对 Apple 的处理结果。审核拒绝需要根据反馈提交新构建。此仓库不包含发布账号或密钥。

## 档案与排查

默认项目档案在 `.eve/runs/<项目编号>/`（可用 `EVE_HOME` 改变 runs 目录）。`state.json` 记录当前阶段、返工历史、来源和签核；`employees/<员工>/<工单>/` 记录输入、模型、耗时起止、用量（服务返回时）和输出；`engineering/vN/` 有独立 Git 仓库、两份 patch 和候选快照；`evidence/vN/` 有报告、截图和 Xcode 工程；`release/CEO.md` 是 CEO 审阅入口，`source.zip` 与通过测试的源码是同一份字节。

执行中断后可续跑。进程异常退出后，续跑会核实旧 PID 已结束并收回锁；仍存活的进程不会被抢占。模型响应不满足 schema 或验收缺少需求时会保留错误，不会把无效输出算成完成。模型调用失败后可重新配置再续跑。岗位权限适用于单个受信工作区，不提供多租户安全隔离。
