---
name: product-qa
description: 用于回答产品问题，如业务规则、页面行为、功能入口、展示条件、集成行为、埋点等。
argument-hint: [问题]
---

# /product-qa

 - **适合回答本项目的产品细节类问题**，如：“首页的加载流程是什么样的”
 - **不适合回答概念类问题**，如：“什么是银河”
 - **不适合回答与本项目无关的问题**，如：“竞品是怎么实现xxx功能的?”
 - **不适合技术原理问题**，如：“Kotlin 协程怎么用”

## 产物定位

先读取 `.understand-anything/knowledge-graph.json` 与 `.understand-anything/product-index.json` 的顶层 `kind`，判断当前是**非分片**还是**分片**项目，再按下列方式消费产物。不要把 manifest 当作完整内容文件搜索。

| 根文件 | 非分片 | 分片 |
|---|---|---|
| `knowledge-graph.json` | 完整 code graph（通常无 `kind`，或不是 `codebase-sharded`） | `kind: codebase-sharded` manifest |
| `product-index.json` | `kind: product-index` 完整索引 | `kind: product-sharded` manifest |

| 产物 | 定位 | 使用时机 | 使用方式 |
|---|---|---|---|
| `.understand-anything/product-index.json` | 产品知识索引入口：Topic、Fact、Evidence、别名、置信度与可回溯证据。 | 用户问产品行为、入口、展示条件、业务规则、集成、埋点等时**优先**使用。 | **非分片：** 直接在本文件内搜索 Topic / Fact / Evidence；验证证据时在同一文件的 `evidence[]` 中按 `evidenceIds` 解析。**分片：** 只读 manifest（`shards[]`、`source`）；用关键词在 `product-shards/*.json` 中定位候选 shard，再读取命中的 `product-shards/<id>.json` 做 Topic / Fact / Evidence 检索；不要对 manifest 做全文 Topic 搜索。 |
| `.understand-anything/product-shards/<id>.json` | 单个 code shard 对应的产品索引正文（分片专用）。 | 分片项目命中某产品区域后，在该 shard 内读取完整 Topic / Fact / Evidence。 | **非分片：** 不存在，忽略。**分片：** 读取 manifest 中 `shards[].path` 指向的文件；在同一 shard 内用 `evidenceIds` 解析 `evidence[]`；需要追溯源码或结构关系时，按 manifest 条目的 `sourceCodeShard`（及可选 `sourceDomainShard`）跳转到对应 code / domain shard。 |
| `.understand-anything/knowledge-graph.json` | 结构 code graph 入口：file 级节点、摘要、`businessSignals`、文件间关系。 | 验证 product Evidence、将 `nodeId` 解析为 `filePath`、沿边补查关联文件，或 product-index 无命中时兜底。 | **非分片：** 直接在本文件内搜索 `nodeId`、`filePath`、summary、tags、businessSignals；沿 `imports` / `depends_on` / `tested_by` 等边做 1-hop 扩展。**分片：** 只读 manifest 的 `shards[]` 与项目元信息；在 `.understand-anything/shards/` 下按 `nodeId` 或关键词搜索并读取命中的 `shards/<id>.json`； |
| `.understand-anything/shards/<id>.json` | 单个 code shard 的结构图正文（分片专用）。 | 分片项目验证 Evidence、补查文件关系、或兜底搜索代码上下文。 | **非分片：** 不存在，忽略。**分片：** 读取与当前 product shard 同 id 的 code shard（见 `product-index.json` manifest 中 `sourceCodeShard`）；在该文件内定位 `nodeId`（多为 `file:<相对路径>`）并读取 `filePath`、邻接边与 `businessSignals`。 |

**分片联动约定：** 处理某个 product shard 时，优先使用 manifest 上声明的 `sourceCodeShard` 做证据验证；若有 `sourceDomainShard`，再读同名 domain shard。除非用户要求全局概览，不要一次性加载所有 shard 全文。

在本 Skill 中，不要生成或更新这些产物。如果某个产物缺失，继续使用可用产物；只有当缺失会影响结论置信度时，才在回答中说明限制。

## 产品问答流程

### 1. 理解用户问题

先识别：

- 产品对象：如页面、功能、按钮、入口、设置项、状态、权限、账号类型、内容类型或集成能力。
- 用户意图：如展示什么、何时出现、为什么不可用、如何变化、由什么触发、之后发生什么。
- 搜索关键词：包括中文词、别名、界面文案、业务名词、动作词、条件词，或token、VIP、SDK、Push 等常见缩写。

**如果出现以下情况，先问澄清问题，再做深入搜索：**
- 用户表述过宽，对应多个产品区域
- 无法根据用户问题识别出产品对象、用户意图

### 2. 检查并搜索 Product Index 

#### 2.1 检查 `.understand-anything/product-index.json`。

- 如果不存在，进入第 4 步兜底路径。
- 如果 `kind` 是 `product-index`，直接检索。
- 如果 `kind` 是 `product-sharded`，把它当作 manifest。先读取 manifest 中的 shard 列表，再用第 1 步提取的关键词对 `product-shards/*.json` 做轻量搜索来定位候选 shard。

分片搜索规则：

- **优先使用搜索工具**在 shard 文件内容中查关键词，不要一开始读取所有 shard 文件全文。
- 先搜索 Topic 名称、别名、摘要、Fact 文本、条件和 Evidence tokens 等文本字段。
- 如果多个关键词可用，先用最能区分产品区域的业务名词、界面文案、功能名搜索，再用动作词和条件词缩小范围。
- 只读取命中最集中的少量候选 shard，再判断 Topic / Fact。
- 除非用户明确要求全局回答，不要为了一个宽泛问题读取所有 shard。
- **当轻量搜索后仍出现多个同等可信的产品区域，或完全无法定位候选 shard 时，问用户澄清问题**

#### 2.2 确认搜索结果

命中 Topic 时：

- 读取它的名称、别名、摘要、状态、`facts`、`entryEvidenceIds`、`evidenceIds` 和 `domainRefs`。
- 读取该 Topic 下的 `facts`。
- 通过 fact 的 `evidenceIds` 在同一 product-index 文件（或同一 `product-shards/<id>.json` shard）的 `evidence[]` 中解析对应的 Evidence 对象。
- 判断 Topic 加 Facts 是否能命中用户的具体问题。

命中 Fact 时：

- 根据 `fact.topicIds` 找到所有关联 Topic。
- 读取命中的 Topic，以及该 Topic 下的其它 Facts。
- 判断 Topic 加 Facts 是否能命中用户的具体问题。
- 除非 Topic 和相关 Facts 支撑完整结论，否则不要把一条局部 Fact 扩展成完整产品结论。

如果命中多条结果：

- 优先选择关联度最高的结果，继续执行第3步来验证答案
- 顺序执行，直到能够回答用户问题

### 3. 用源证据验证

如果 product-index 有可用命中，用最小必要源文件读取来验证答案。验证阶段可以读取路径和源码；最终回答仍遵守下文「回答风格」，不要向用户暴露文件路径、行号或图谱 ID。

- **优先使用 Evidence 的 `filePath`** 读取源文件。
- 若缺少 `filePath`、仅有 `nodeId`，再在 knowledge graph 中定位节点并解析 `filePath`：
  - 若 `knowledge-graph.json` 的 `kind` 为 `codebase-sharded`，在 `.understand-anything/shards/` 中搜索该 `nodeId`；不要只在 manifest 里找节点。
  - 当前知识图谱为 file-only：`nodeId` 通常为 `file:<相对路径>`。
- 若 Evidence 有 `lineRange`，优先读取窄范围；否则读取整个源文件
- 需要扩展关联文件时，沿 `imports`、`depends_on`、`tested_by` 等边查找，或读取明显产品配置关系指向的文件；
- 一旦足以支撑产品答案，就停止。不要把产品问答变成全量代码审计。

### 4. 兜底使用 Knowledge Graph

**当 product-index 缺失，或没有搜索到可用 Topic / Fact 时，走此路径**。

1. 按 `understand-chat` 的 knowledge-graph 检索流程执行：
   - 检查 `knowledge-graph.json`。
   - 读取项目元信息。
   - 用产品关键词搜索节点的名称、摘要、标签、业务信号。
   - 沿命中节点周围的边查上下文。
   - 读取最小必要源文件。
2. 保持 `product-qa` 的回答风格。即使是兜底路径，也要用产品语言回答，不要变成代码解释。
3. **如果 knowledge graph 也无法支撑答案，Agent应使用常规的代码搜索和定位手段继续查找和回答问题**


## 回答风格

除非用户明确要求其它语言，否则始终**使用中文回答**。

**使用产品语言**：

- 说明用户会看到什么、什么时候发生、由什么条件控制、结果是什么。
- 规则类问题要说明适用条件、例外情况和用户可感知结果。
- 流程类问题要说明触发条件、关键步骤、分支和最终状态。
- 可以保留约定俗成或产品侧可理解的缩写，如 token、VIP、SDK、Push、URL、ID、API。

**不要包含**：

- 代码片段。
- 函数名、类名、变量名、文件路径、行号、包名或实现术语。
- 内部图谱 ID 或原始 JSON 字段名。

**禁止臆测**
- 答案必须有代码文件读取作为证据支撑
- 当有不能确定的部分时，要直接说明不确定性。


流程类回答中，如果 domain graph 或源证据能够支撑步骤顺序，尽量附 Mermaid 流程图：

