# `/understand-product` 产品知识索引设计

## 背景

当前项目已经有两类核心产物：

- `knowledge-graph.json`：代码结构事实层，描述文件、类、函数、资源、schema、调用、依赖和架构层。
- `domain-graph.json`：业务流程抽象层，描述 domain、flow、step。

这两类产物能回答“代码在哪里”“流程大概怎么走”，但对客户端产品问题仍然不够稳定。例如：

- 投屏为什么不可用？
- 播放记录后台同步在哪里实现？
- 播放页码流标签什么时候展示？
- 某个按钮置灰、弹窗、文案、埋点、字段映射的代码证据在哪里？

目标不是一次性完整抽取所有业务逻辑，而是建立一份可检索、可验证、可增量深化的产品知识索引，让 Agent 能快速定位产品主题、候选事实和代码证据。

## 目标

1. 新增 `/understand-product`，生成 `.understand-anything/product-index.json`。
2. `product-index.json` 定位为产品知识索引，不是完整产品知识库，也不是低层 evidence dump。
3. 第一版面向 Android 客户端优化，但核心 schema 和流程保持跨平台。
4. 支持页面型问题和无页面业务问题，例如 Activity/Fragment 页面、ActivityProxy/Router 入口、后台同步、投屏、Push、下载、埋点、SDK 回调。
5. 尽量少用 LLM：确定性流程负责建索引和找证据，LLM 只做局部命名、去重、摘要和 fact 归纳。
6. 大型项目中避免重复分析和 evidence 爆炸。

## 非目标

1. 不改变 `/understand` 默认流程。
2. 不把产品知识塞进 `knowledge-graph.json` 或 `domain-graph.json`。
3. 不承诺一次性抽取完整业务规则。
4. 不依赖 ViewModel、Presenter、StateFlow、LiveData 等现代架构命名。
5. 不让 LLM 全项目扫描、全局找 evidence 或直接凭空生成产品知识。

## 核心关系

```text
knowledge-graph.json
  代码结构事实层：文件、类、函数、资源、schema、调用、依赖

domain-graph.json
  业务流程抽象层：domain / flow / step

product-index.json
  产品知识索引层：topic / fact / evidence / coverage
```

生成关系：

```text
/understand
  -> knowledge-graph.json

/understand-domain
  -> domain-graph.json，可选

/understand-product
  -> product-index.json
  -> product-signals.jsonl，可选 sidecar
```

回答时，`/understand-chat` 优先查 `product-index.json`，再用 evidence 反查 `knowledge-graph.json`，必要时补充 `domain-graph.json` 的流程背景。

## 产物结构

主产物：

```json
{
  "version": "1.0.0",
  "kind": "product-index",
  "project": {
    "name": "VideoAndroid",
    "platforms": ["android"],
    "languages": ["kotlin", "java"],
    "frameworks": ["android"],
    "analyzedAt": "2026-05-18T00:00:00.000Z",
    "gitCommitHash": "abc123"
  },
  "sources": {
    "knowledgeGraph": {
      "path": ".understand-anything/knowledge-graph.json",
      "gitCommitHash": "abc123",
      "required": true
    },
    "domainGraph": {
      "path": ".understand-anything/domain-graph.json",
      "available": true,
      "required": false
    },
    "signals": {
      "path": ".understand-anything/product-signals.jsonl",
      "available": true,
      "count": 12840,
      "indexedNodes": 6230,
      "truncated": false
    }
  },
  "topics": [],
  "facts": [],
  "evidence": [],
  "coverage": {
    "platformProfiles": ["android"],
    "entryPoints": 120,
    "indexedTopics": 86,
    "confirmedEvidence": 420,
    "generatedFacts": 64,
    "warnings": []
  }
}
```

职责划分：

- `topics`：产品问题入口，例如播放页、投屏、播放记录同步、码流标签。
- `facts`：已有证据支持的候选产品知识，例如规则、展示条件、字段映射、生命周期触发。
- `evidence`：可跳转、可校验的代码证据。
- `coverage`：覆盖范围、截断情况、降级和风险提示。
- `product-signals.jsonl`：可选 sidecar，保存确定性生成的低层召回信号，避免主文件过大。

## Topic

Topic 是产品问题入口，不要求完整覆盖所有业务。

```json
{
  "id": "topic:player-page",
  "kind": "surface",
  "name": "播放页",
  "aliases": ["PlayerActivity", "PlayerFragment", "player"],
  "summary": "承载视频播放、播放控制、码流展示和投屏入口。",
  "status": "indexed",
  "entryEvidenceIds": ["ev:player-activity"],
  "evidenceIds": [
    "ev:player-activity",
    "ev:quality-label-builder",
    "ev:cast-button"
  ],
  "domainRefs": ["domain:playback"]
}
```

`kind` 保持少量稳定：

- `capability`：产品能力或业务能力，例如投屏、播放记录同步、下载、会员权益。
- `surface`：页面、弹窗、组件区域。
- `element`：按钮、标签、入口、角标、提示。
- `data`：字段、枚举、资源、配置、埋点、SDK。

`status` 表示成熟度：

- `seeded`：只有入口或命名线索。
- `indexed`：有可用 evidence，能定位代码。
- `summarized`：有摘要和初步 facts。
- `verified`：有较完整证据链。

## Fact

Fact 是产品知识索引中的可检索事实，只对高置信局部生成。

```json
{
  "id": "fact:casting-disabled-by-cast-allowed",
  "topicIds": ["topic:casting"],
  "type": "rule",
  "text": "当播放信息中的 castAllowed 为 false 时，投屏能力会被禁用或不展示入口。",
  "conditions": ["castAllowed=false"],
  "evidenceIds": [
    "ev:cast-allowed-field",
    "ev:cast-availability-check"
  ],
  "confidence": "confirmed",
  "maturity": "summarized"
}
```

`type` 保持少量稳定：

- `behavior`：做了什么、如何运作。
- `rule`：条件、限制、校验、权益、实验、灰度。
- `display`：展示、隐藏、置灰、文案选择。
- `mapping`：字段、枚举、资源、状态到产品含义的映射。
- `lifecycle`：触发时机、后台任务、callback、系统事件。

Fact 生成约束：

- 没有 evidence 不生成 fact。
- `confirmed` fact 必须至少引用一个 `confirmed` evidence。
- 跨模块推断默认 `inferred`。
- 证据不足时只保留 topic 和 evidence，不硬写 fact。

## Evidence

Evidence 是可校验、可跳转的代码证据。

```json
{
  "id": "ev:cast-allowed-field",
  "role": "data",
  "filePath": "app/player/model/PlaybackInfo.kt",
  "symbol": "castAllowed",
  "lineRange": [31, 31],
  "nodeId": "class:app/player/model/PlaybackInfo.kt:PlaybackInfo",
  "signalTypes": ["data", "rule"],
  "tokens": ["cast", "allowed", "投屏", "可用"],
  "reason": "播放信息模型包含服务端下发的投屏可用性字段。",
  "confidence": "confirmed"
}
```

Evidence 可以被多个 topic 或 fact 复用。去重键建议使用：

```text
nodeId + filePath + symbol + lineRange + role
```

## Signal Sidecar

`nodeSignalIndex` 不使用 LLM。它是确定性、可缓存、可增量的产品信号倒排索引。

它不直接进入主索引全部内容，而是写入 sidecar：

```text
.understand-anything/product-signals.jsonl
```

每行一条 signal：

```json
{"id":"sig:1","nodeId":"function:player/CastManager.kt:checkCast","types":["rule","data"],"tokens":["cast","allowed"],"score":0.83,"filePath":"player/CastManager.kt","lineRange":[72,91]}
```

大小控制：

- 只索引有产品信号的节点。
- 每个 node 最多保留 N 条 signal。
- 每条 signal 不存长 snippet。
- 低分 signal 不落盘。
- 大文件按 top K key 保存。
- 后续支持按文件 hash 增量缓存。

## 生成流程

### 1. 前置检查

`/understand-product` 第一版要求已有：

```text
.understand-anything/knowledge-graph.json
```

没有时提示先运行 `/understand`。如果存在 `domain-graph.json`，作为可选增强输入；不存在不阻塞。

### 2. 加载 Product Profile

第一版内置 Android profile，但核心接口跨平台。

Android profile 提供：

- 入口识别规则。
- 产品信号类型和打分规则。
- 文件和节点过滤规则。
- graph 扩展权重。
- 默认预算。

项目可配置入口模式：

```json
{
  "product": {
    "platform": "android",
    "entryPatterns": [
      "*Activity",
      "*Fragment",
      "*ActivityProxy",
      "*Router",
      "*RouteTable",
      "*Service",
      "*Receiver",
      "*Worker"
    ]
  }
}
```

### 3. 全局构建 nodeSignalIndex

确定性扫描 `knowledge-graph.json` 的节点和必要源码短片段，生成 `nodeSignalIndex`。

信号类型：

- `entry`
- `copy`
- `ui`
- `rule`
- `data`
- `lifecycle`
- `network`
- `storage`
- `analytics`
- `integration`

这一步不使用 LLM。

### 4. 枚举 Product Entry Points

优先从结构图节点中找入口，而不是从散乱 evidence 聚类猜 topic。

Android 入口包括：

- `Activity`
- `Fragment`
- `DialogFragment`
- `ActivityProxy`
- `Router target`
- `Deeplink handler`
- `Service`
- `BroadcastReceiver`
- `Worker`
- `Job`
- `Scheduler`
- `Push handler`
- `SDK callback`

输出 `TopicSeed`：

```json
{
  "id": "seed:player-page",
  "source": "entry-point",
  "entryKind": "activity",
  "nameCandidates": ["PlayerActivity", "播放页"],
  "entryNodeId": "class:app/player/PlayerActivity.kt:PlayerActivity",
  "score": 0.92
}
```

### 5. 合并相似 Topic Seeds

多个入口可能代表同一产品主题，例如：

```text
PlayerActivity
PlayerFragment
PlayerRouter
PlayerActivityProxy
```

先用确定性特征合并：

- 名称 token 相似。
- 同 package 或同路由。
- graph neighborhood overlap 高。
- 共享 evidence 比例高。

必要时使用少量 LLM 做命名和去重，但输入只包含 seed 摘要，不包含全量源码。

### 6. 局部 Graph 扩展

不用固定 `depth=2`。大型客户端项目要用预算驱动的加权扩展。

推荐默认：

```json
{
  "maxDepth": 8,
  "maxNodesPerTopic": 240,
  "maxFrontierPerDepth": 40,
  "maxEvidencePerTopic": 50,
  "hubDegreeThreshold": 80
}
```

扩展方式：

```text
for depth in 1..maxDepth:
  candidates = expand(frontier)
  scored = score(candidates)
  collect high-score evidence
  frontier = topK(scored)
  if no new high-value nodes:
    stop
```

边权重：

- 高权重：`calls`、`contains`、`routes`、`reads_from`、`writes_to`、`defines_schema`
- 中权重：`imports`、`depends_on`、`configures`、`documents`
- 低权重：`related`、`similar_to`

Hub 节点降权：

```text
BaseActivity
NetworkClient
JsonUtils
Logger
CommonAdapter
```

这些节点除非命中 topic token 或强产品信号，否则不应主导 evidence。

### 7. Topic Evidence 聚合

局部扩展只拿 nodeId 集合，然后从全局 `nodeSignalIndex` 查 signals，避免不同 topic seed 重复解析源码和重复打 signal。

去重层级：

1. Node-level cache：同一 nodeId 只分析一次。
2. Signal-level dedupe：同一 nodeId、signal type、lineRange、token 只生成一条 signal。
3. Evidence-level dedupe：同一定位证据只生成一条 evidence，被多个 topic 复用。

### 8. LLM Topic Normalization

LLM 只在这里做少量工作：

输入：

```text
topic seed
入口名称
高分 evidence 摘要
少量文案和字段
domain refs
```

输出：

```text
topic.name
topic.kind
topic.aliases
topic.summary
topic merge decision
```

### 9. LLM Fact Summarization

只对高置信 topic 的局部 evidence cluster 生成 facts。

输入：

```text
单个 topic 的 top evidence
相关 signal types
短 snippet 或 graph summary
可选 domain context
```

输出：

```text
facts[]
```

LLM 不允许：

- 全项目找文件。
- 生成没有 evidence 的 fact。
- 引入 evidence 中没有的业务结论。
- 判断路径安全。
- 维护 graph 扩展。

### 10. Validator 和保存

保存前校验：

- `evidence.filePath` 必须是项目内相对路径。
- `evidence.nodeId` 如果存在，必须能在 `knowledge-graph.json` 找到。
- `lineRange` 合法。
- `topic.evidenceIds` 都存在。
- `topic.entryEvidenceIds` 都存在。
- `fact.topicIds` 都存在。
- `fact.evidenceIds` 都存在。
- `confirmed` fact 至少有一个 `confirmed` evidence。
- `domainRefs` 如果不存在，降级为 warning。
- git hash 不一致时标记 stale。

失败策略：

- 无效 evidence 删除或降级。
- fact 缺证据则删除。
- topic 缺证据则 status 降到 `seeded`。
- domainRef 无效则移入 `coverage.warnings`。
- 新产物未通过最低校验时，不覆盖旧 `product-index.json`。

## LLM 使用边界

需要 LLM 的步骤：

1. Topic normalization：命名、去重、别名、摘要。
2. Fact summarization：只对高置信局部 evidence cluster 归纳事实。

不需要 LLM 的步骤：

- 读取 graph。
- 加载 profile。
- 枚举 entry points。
- 构建 nodeSignalIndex。
- 局部 graph 扩展。
- signal 提升 evidence。
- 校验、降级、保存。

运行模式：

- `--fast`：只生成 topics + evidence，不生成 facts。
- 默认模式：生成 topics + evidence，并为 top N 高置信 topic 生成 facts。
- `--full`：对更多 topic 做 fact summarization。
- `--topic <name>`：只对指定 topic 深挖并生成 facts。

## 回答流程

`/understand-chat` 增强为 product-aware，但保持无 `product-index.json` 时的旧行为。

```text
用户问题
  -> 判断是否像产品问题
  -> 检索 product-index.json 的 topics / facts / evidence
  -> 如果命中成熟 fact，直接使用 fact + evidence
  -> 如果只命中 topic，沿 evidence 和 knowledge graph 局部扩展
  -> 如果命中 signal sidecar，临时构建 evidence cluster
  -> 可选补 domain-graph 的 flow / step 背景
  -> 生成回答
```

优先级：

```text
Product facts
  -> Product evidence
  -> Knowledge graph code context
  -> Domain graph flow context
```

回答格式：

1. 直接回答产品含义、规则或行为。
2. 说明触发条件或展示条件。
3. 给出代码证据：文件、symbol、lineRange。
4. 说明相关调用链或上下游。
5. 如证据不足，明确标记“当前索引只能定位到候选位置”。

示例：

```text
问题：投屏为什么不可用？

回答：
投屏不可用主要和 castAllowed 字段、内容版权策略、设备发现状态有关。

已确认规则：
- 当 castAllowed=false 时，投屏入口会被禁用或隐藏。
  证据：PlaybackInfo.kt:31 castAllowed
  证据：CastViewModel.kt:74-96 checkCastAvailable

相关代码入口：
- PlayerActivity.kt 播放页入口
- CastButton.kt 投屏按钮点击
- CastViewModel.kt 设备发现和连接状态

当前索引没有完整确认所有版权策略来源，需要继续追踪 PolicyManager 的调用链。
```

## Dashboard 集成

第一版只做轻量展示：

- 在 sidebar 或独立 panel 中展示 product topics。
- 支持搜索 topic、fact、evidence token。
- 点击 evidence 跳转已有 CodeViewer 或结构图节点。
- 按 topic 聚合 facts，渲染成产品知识卡片：
  - 主题
  - 摘要
  - 规则
  - 展示条件
  - 字段映射
  - 代码证据

Dashboard 不需要第一版新增复杂产品关系图。

## 准确性策略

1. Topic 从入口枚举产生，不从全局散乱 evidence 猜。
2. Evidence 从确定性 signal 和 graph 局部扩展产生。
3. Facts 只对高置信局部生成。
4. 所有 confirmed 结论必须有 confirmed evidence。
5. 低置信内容保留为 indexed topic 或 warning，不伪装成确定知识。
6. 主索引和 signal sidecar 分离，避免大项目主文件过大。

## 验收标准

1. 没有 `knowledge-graph.json` 时，`/understand-product` 清晰提示先运行 `/understand`。
2. 可生成 `.understand-anything/product-index.json`。
3. 可选生成 `.understand-anything/product-signals.jsonl`。
4. Android 项目中能从 Activity、Fragment、ActivityProxy、Router、Service、Receiver、Worker 等入口生成 topics。
5. 同一 evidence 可被多个 topic 复用，不重复分析同一 node。
6. `confirmed` fact 无 evidence 时校验失败或降级。
7. `/understand-chat` 能优先使用 product index 回答产品问题，并回退到结构图问答。
8. Dashboard 能展示 topic/fact/evidence，并能跳转代码证据。
