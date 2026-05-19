# Grounded Product Index 设计方案

## 背景

当前 `codex/product-index` 分支已经具备 `/understand-product` 的基础工程能力，包括 schema、CLI、持久化、dashboard 展示、chat 消费和测试骨架。但当前生成逻辑更接近：

```text
entry seed -> graph expansion -> product signals -> evidence per node -> topic
```

这个流程在大型客户端项目上会产生两个核心问题：

1. `evidence` 过早、过多生成，变成 topic 相关代码集合，而不是 fact 的最小证明。
2. `facts` 容易从代码结构解释中补出来，而不是产品事实。

新的设计目标是把 product-index 定位重新拉回：

```text
产品主题索引 + 产品事实索引 + 最小代码证据索引
```

并保证：

```text
Topic 来自 knowledge-graph 中的产品边界和业务信号。
Fact 来自 Topic Context Pack。
Evidence 只从 Fact 引用的 anchors 中提升。
```

## 分支策略

本轮工作不从 `main` 重新开始，也不直接继续修改 `codex/product-index`。采用新分支：

```text
codex/product-index-grounded
```

该分支基于 `codex/product-index` 创建。

原因：

- `main` 尚未包含 product-index 的完整工程骨架，从 `main` 开始会重复搬运 schema、CLI、dashboard、chat 和测试。
- 直接继续 `codex/product-index` 会让旧方案和新方案混在同一分支，难以对比和回滚。
- 从 `codex/product-index` 拉新分支可以复用基础设施，同时隔离生成策略重构。

## 总体设计

新流程分成两段：

```text
/understand
  -> 在 knowledge-graph 中沉淀 node-level businessSignals

/understand-product
  -> 消费 businessSignals
  -> 生成 grounded product-index
```

完整链路：

```text
file-analyzer 读源码
  -> graph nodes / edges
  -> node.businessSignals
  -> merge 保留、去重、裁剪 signals
  -> knowledge-graph.json

/understand-product
  -> ProductBoundaryCandidate Discovery
  -> Topic Normalization
  -> Topic Candidate File Recall
  -> Topic Context Pack Building
  -> Context Pruning + Fact-Evidence Co-Extraction
  -> Canonicalization / Validation
  -> product-index.json
```

## Knowledge Graph 中的 businessSignals

### 定位

`businessSignals` 不是产品事实，不是最终证据，也不是完整业务规则。它只是挂在 knowledge-graph node 上的轻量业务线索，用于帮助 `/understand-product` 找到产品边界、构建 topic 上下文，并通过所属 graph node 反查定位信息。

它只回答两个问题：

```text
这是什么产品线索？
它属于哪类？
```

### 生成位置

`businessSignals` 在 `/understand` 的 Phase 2 `file-analyzer` 阶段生成。

原因：

- `file-analyzer` 正在读取源码，是 LLM 最有上下文的位置。
- 它能看到文件、类、函数、UI、文案、接口、配置和调用关系。
- 后置 `/understand-product` 不需要重新对全项目源码做业务理解。

### Schema

推荐最小结构：

```ts
interface BusinessSignal {
  type: "entry" | "behavior" | "rule" | "display" | "data" | "integration";
  text: string;
}
```

示例：

```json
{
  "type": "display",
  "text": "首页退出确认弹窗"
}
```

`BusinessSignal` 不包含 `anchor` 字段。signal 挂在哪个 graph node 上，哪个 node 就是它的定位锚点：

- 挂在 file node 上：定位到该文件的 `filePath`。
- 挂在 class node 上：定位到该类的 `filePath`、`name` 和可用的 `lineRange`。
- 挂在 function/method node 上：定位到该函数的 `filePath`、`name` 和 `lineRange`。

这样可以避免 signal 与 graph node 重复存储 `filePath`、`lineRange`，也避免两处定位信息不一致。

类型含义：

- `entry`：产品入口、页面入口、路由入口。
- `behavior`：用户行为或业务动作。
- `rule`：规则、策略、开关、权益判断。
- `display`：展示、交互、弹窗、toast、文案。
- `data`：接口、缓存、配置、字段、数据同步。
- `integration`：外部系统、SDK、广播、deeplink、系统能力。

不单独保留 `lifecycle`、`copy`、`network`、`storage`、`analytics`：

- `lifecycle` 合入 `behavior`。
- `copy` 合入 `display`。
- `network`、`storage` 合入 `data`。
- `analytics` 视上下文合入 `data` 或 `behavior`。

### LLM 做什么

`file-analyzer` 中的 LLM 在每个 node 上最多输出少量业务线索：

```text
如果该 node 明显承载产品行为，输出一个短 businessSignal。
如果只是代码结构、框架模板、工具逻辑，不输出 signal。
```

约束：

- 每个 function/method 最多 1 条。
- 每个 class 最多 3 条。
- 每个 file 最多 8 条。
- `text` 必须是短语，不是完整段落。
- 不输出条件、完整规则、完整流程。
- 不输出“初始化 ViewBinding”“继承 BaseActivity”“注册 observer”这类代码结构描述。

file node 和 symbol node 的 signal 含义不同：

- file node 的 `businessSignals` 描述这个文件整体承载什么产品业务或能力。
- class/function/method node 的 `businessSignals` 描述具体符号承载的产品行为、规则、展示、数据或集成点。

示例：

```json
{
  "id": "file:app/a_home/src/main/java/com/gala/video/app/epg/androidtv/BootBroadcastReceiver.java",
  "type": "file",
  "businessSignals": [
    {
      "type": "entry",
      "text": "开机广播接收入口"
    }
  ]
}
```

```json
{
  "id": "function:app/a_home/src/main/java/com/gala/video/app/epg/androidtv/BootBroadcastReceiver.java:onReceive",
  "type": "function",
  "lineRange": [18, 21],
  "businessSignals": [
    {
      "type": "behavior",
      "text": "接收开机广播并启动后续处理"
    }
  ]
}
```

file 级 signal 主要用于主题发现和文件召回；symbol 级 signal 优先用于 Fact 和 Evidence。只有当某个 Fact 只能由文件整体职责支撑、且没有更细 symbol signal 时，才使用 file 级 evidence。

### 代码做什么

代码负责：

- 校验 `type`、`text`。
- 丢弃空文本、未知 type。
- 合并同一 node 上重复的 `type + text`。
- 在 batch merge 时保留 signals。
- 在 node 合并时合并 signals。
- 超过上限时裁剪。

`assemble-reviewer` 可以做轻量 QA，但不负责大规模新增 signal。

## /understand-product 生成流程

### Step 1: ProductBoundaryCandidate Discovery

代码读取 `knowledge-graph.json` 和可选 `domain-graph.json`，发现产品边界候选。

候选来源：

- Activity / Fragment / ActivityProxy。
- Router / route registration。
- Receiver / Service / Task。
- Page / Dialog / Controller。
- 带 `businessSignals.type = entry` 的节点。
- 带强业务 signal 的节点，例如 `display`、`rule`、`data`、`integration`。

输出 `ProductBoundaryCandidate`，不是最终 Topic。

候选包含：

- root node。
- filePath。
- businessSignals。
- 直接 graph neighbors 摘要。
- domain refs。
- route/action/schema/resource/api/config 线索。

LLM 不参与。

### Step 2: Topic Normalization

LLM 基于候选边界做 topic 归一化。

输入：

- candidate 名称和入口类型。
- root file。
- businessSignals。
- domain refs。
- 直接结构关系摘要。
- candidate 之间的重叠关系。

LLM 输出：

- keep。
- merge。
- split。
- drop。
- topic name。
- topic summary。

代码执行 LLM 决策：

- 生成稳定 topic id。
- 保存 topic 到 source candidates 的 trace。
- 对低置信 drop 不直接丢失，可写入 discarded trace。

这一步不生成 Fact，也不生成 Evidence。

### Step 3: Topic Candidate File Recall

代码围绕 Topic roots 做确定性候选文件召回。

召回来源：

- root 文件。
- knowledge-graph 邻近文件。
- 直接相关 businessSignals 文件。
- route/action/schema/manifest 指向文件。
- domainGraph 直接关联文件。
- resource/api/config/cache 直接关联文件。

代码只做硬过滤，不做复杂语义打分：

- test 文件。
- generated 文件。
- build 文件。
- R / BuildConfig。
- 明显第三方依赖。
- 明显通用 util/logger/base。
- 明显纯 DI/module/provider。

LLM 不参与。

### Step 4: Topic Context Pack Building

代码把候选文件压缩成 LLM 可读上下文，形成 `TopicContextPack`。

结构示例：

```json
{
  "topic": {
    "id": "topic:standard-home",
    "name": "标准模式首页"
  },
  "roots": [],
  "candidateFiles": [
    {
      "fileId": "file:xxx/HomeActivity.kt",
      "filePath": "xxx/HomeActivity.kt",
      "nodeSummaries": [],
      "businessSignals": [],
      "structuralReasons": [],
      "anchors": [
        {
          "anchorId": "anchor:HomeActivity.showExitDialog",
          "symbol": "showExitDialog",
          "lineRange": [120, 165],
          "snippetSummary": "展示首页退出确认弹窗"
        }
      ]
    }
  ],
  "overflowFiles": []
}
```

Context Pack 不包含完整源码。它包含：

- 短 node summaries。
- businessSignals。
- anchors。
- 少量关键片段摘要。
- 结构召回原因。

输入大小控制规则：

- 优先 root 文件。
- 优先有 businessSignals 的文件。
- 优先 route/action/api/config/resource 直接命中的文件。
- 普通邻近文件超过预算进入 `overflowFiles`，不进入 LLM 主输入。

这里控制的是 token 预算，不是业务角色预算。

### Step 5: Context Pruning + Fact-Evidence Co-Extraction

这是 `/understand-product` 的核心 LLM 步骤。

LLM 在同一次调用里完成：

1. 忽略低关联文件。
2. 从保留上下文中生成产品 Fact。
3. 为每个 Fact 选择最小 evidence refs。

输出示例：

```json
{
  "usedFiles": [
    {
      "fileId": "file:xxx/HomeActivity.kt",
      "reason": "承载标准首页退出交互"
    }
  ],
  "ignoredFiles": [
    {
      "fileId": "file:xxx/BaseActivity.kt",
      "reason": "通用基础类，不表达该产品主题行为"
    }
  ],
  "facts": [
    {
      "type": "display",
      "text": "用户在标准首页触发退出时，系统会展示退出确认弹窗。",
      "conditions": ["用户触发首页退出"],
      "evidenceRefs": ["anchor:HomeActivity.showExitDialog"],
      "confidence": "confirmed"
    }
  ]
}
```

强约束：

- LLM 不能新增文件。
- LLM 不能新增 anchor。
- Fact 必须引用 `evidenceRefs`。
- `evidenceRefs` 必须来自输入 anchors。
- `ignoredFiles` 不能进入最终 evidence。
- 不能输出“继承”“调用某方法”“初始化变量”等代码解释型 fact。

### Step 6: Canonicalization / Validation

代码负责最终落盘前的稳定化：

- 将 `evidenceRefs` 转成正式 `ProductEvidence`。
- 生成稳定 topic/fact/evidence id。
- 合并重复 Topic。
- 合并重复 Fact。
- 删除无 evidence 的 Fact。
- 删除无 Fact 的 Topic。
- 控制最终 evidence 数量接近 fact 数量。
- 校验 schema。
- 写 coverage 和 quality warnings。

LLM 不参与。

### Step 7: Quality Review

代码硬校验：

- 每个 Topic 必须有 factIds。
- 每个 Fact 必须有 evidenceIds。
- 每个 Evidence 必须能定位到 filePath。
- Evidence anchor 必须来自 Topic Context Pack。
- Topic name 不能是纯类名集合。
- Fact text 不能明显是代码解释。

可选 LLM QA：

- 检查 Topic 是否产品化。
- 检查 Fact 是否像业务事实。
- 检查是否混入代码解释。
- 只输出问题，不直接重写 index。

## Product Index 产物结构

核心结构：

```json
{
  "version": "1.0.0",
  "kind": "product-index",
  "project": {},
  "sources": {},
  "topics": [],
  "facts": [],
  "evidence": [],
  "coverage": {},
  "quality": {}
}
```

`topics`：

```json
{
  "id": "topic:standard-home",
  "name": "标准模式首页",
  "summary": "普通用户进入应用后的首页体验，包括首页初始化、内容加载和退出交互。",
  "status": "indexed",
  "sourceCandidateIds": ["candidate:HomeActivity"],
  "factIds": ["fact:home-exit-dialog"]
}
```

`facts`：

```json
{
  "id": "fact:home-exit-dialog",
  "topicIds": ["topic:standard-home"],
  "type": "display",
  "text": "用户在标准首页触发退出时，系统会展示退出确认弹窗。",
  "conditions": ["用户触发首页退出"],
  "evidenceIds": ["evidence:HomeActivity.showExitDialog"],
  "confidence": "confirmed"
}
```

`evidence`：

```json
{
  "id": "evidence:HomeActivity.showExitDialog",
  "role": "display",
  "filePath": "xxx/HomeActivity.kt",
  "anchor": {
    "symbol": "showExitDialog",
    "lineRange": [120, 165]
  },
  "summary": "实现标准首页退出确认弹窗展示逻辑。",
  "nodeIds": ["function:HomeActivity.showExitDialog"]
}
```

调试 trace 可以写到 sidecar：

```text
.understand-anything/product-index-trace.json
```

trace 包含：

- boundaryCandidates。
- discardedCandidates。
- topicContextPacks 摘要。
- ignoredFiles。
- overflowFiles。
- LLM warnings。

默认 `product-index.json` 不保存大量 trace，避免产物膨胀。

## 与当前实现的关系

当前 `buildProductSignals()` 基于 `node.name + filePath + summary + tags` 用关键词推断 signal。新方案中它降级为 fallback：

```text
如果 knowledge-graph node 没有 businessSignals，才启用 keyword fallback。
```

当前 `buildDeterministicProductIndex()` 的职责需要拆分：

- 保留 graph loading、路径清洗、schema validation、persistence。
- 新增 boundary discovery。
- 新增 topic context pack builder。
- 新增 LLM 输出 schema 和 validation。
- 删除“expanded node 直接变 evidence”的主路径。

## 测试策略

单元测试：

- `BusinessSignalSchema` 校验。
- merge 时 businessSignals 保留、去重、裁剪。
- boundary candidate discovery。
- topic candidate file recall。
- context pack 构建。
- LLM 输出 canonicalization。
- 无 evidence fact 删除。
- 无 fact topic 删除。
- evidence 只能来自 context pack anchors。

集成测试：

- 没有 `businessSignals` 时 fallback 可工作。
- 有 `businessSignals` 时优先消费 graph signals。
- 大量候选文件时 overflow 生效。
- product-index evidence 数量接近 fact 数量。
- chat 能从 product-index 中检索 Topic、Fact、Evidence。

回归验证：

- `pnpm --filter @understand-anything/core test`
- `pnpm --filter @understand-anything/skill test`
- `pnpm --filter @understand-anything/core build`
- `pnpm --filter @understand-anything/skill build`
- `pnpm --filter @understand-anything/dashboard build`

## 非目标

本设计不做以下事情：

- 不让 `/understand-product` 重新全量扫描源码并生成业务理解。
- 不在 knowledge-graph 中生成完整产品事实。
- 不把所有 businessSignals 提升为 evidence。
- 不把 Topic 当成入口类名集合。
- 不让 LLM 自由新增文件、anchor 或无证据 fact。
- 不用复杂业务关联度权重调参控制文件选择。

## 成功标准

生成结果应满足：

- Topic 是产品主题，不是代码类名集合。
- Fact 是产品事实，不是代码解释。
- 每个 Fact 至少有 1 条 Evidence。
- Evidence 数量与 Fact 数量同量级。
- Evidence 能定位到文件和 anchor。
- 对没有页面的业务，例如播放记录后台同步、投屏、广播调起，也能通过 `behavior/data/integration` signals 形成 Topic 和 Fact。
- 产物可被 `/understand-chat` 用于回答业务流程、业务规则、展示交互、数据来源和外部集成问题。
