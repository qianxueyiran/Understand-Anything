---
name: product-qa
description: 用于回答基于 Understand-Anything 产品产物的产品问题、业务规则、页面行为、功能入口、展示条件、集成行为、埋点、SDK 回调、Push、同步、投屏、下载或用户流程问题。
argument-hint: [问题]
---

# /product-qa

优先使用 `.understand-anything/product-index.json` 回答产品问题；流程类问题用 `domain-graph.json` 补充业务路径；需要验证事实或兜底检索时使用 `knowledge-graph.json`。

## 产物定位

| 产物 | 定位 | 使用时机 |
|---|---|---|
| `.understand-anything/product-index.json` | 产品知识索引。包含产品 Topic、Fact、Evidence、别名、置信度，以及可回溯的证据。 | 用户询问产品行为、功能入口、展示条件、业务规则、用户可见状态、后台能力、SDK 回调、Push、同步、投屏、下载、埋点或集成行为时优先使用。 |
| `.understand-anything/domain-graph.json` | 业务流程图谱。包含业务域、流程、步骤和跨业务关系。 | 用户询问流程、用户路径、状态流转、前置条件、后续影响，或一个业务动作如何连接到另一个业务动作时使用。 |
| `.understand-anything/knowledge-graph.json` | 结构代码图谱。包含文件、符号、摘要、分层和关系。 | 需要验证 product-index 的 Evidence、把 `nodeId` 解析到源文件、顺着相邻关系补查，或 product-index 没有有效命中时兜底使用。 |

不要生成或更新这些产物。如果某个产物缺失，继续使用可用产物；只有当缺失会影响结论置信度时，才在回答中说明限制。

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

- 如果不存在，进入第 7 步兜底路径。
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

如果 product-index 有可用命中，用最小必要源文件读取来验证答案。

- 优先读取 Evidence 的 `filePath`。
- 如果 Evidence 只有 `nodeId`，先在 `knowledge-graph.json` 中定位该节点，再解析到 `filePath`。
- 如果有行范围，优先读取窄范围；否则读取对应源文件。
- 必要时，可以读取 imports、calls、contains 边，或明显产品配置关系指向的关联文件。
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



### 5. 流程类问题使用 Domain Graph （可选）

对于流程类问题，使用 `domain-graph.json` 的方式要参考 `/understand-chat` 使用 `knowledge-graph.json` 的方式：先搜索相关节点，再沿图关系查上下文。

能从产品上下文进入时，优先从产品上下文进入：

- 如果命中的 Topic 有 `domainRefs`，优先使用这些节点。
- 如果没有 `domainRefs`，再用问题关键词搜索 domain graph。

检查 domain graph 形态：

- 如果不存在，继续回答，但没有流程图谱辅助。
- 如果 `kind` 是 `domain-sharded`，把它当作 manifest。优先选择与当前 product shard 关联的 domain shard。如果无法推断 shard，询问用户业务区域或 shard。
- 如果是完整 graph，直接搜索 `nodes[]` 和 `edges[]`。

搜索 domain 节点时关注：

- 节点 `type`：`domain`、`flow`、`step`。
- `name`、`summary`、`tags` 和 `languageNotes`。
- 如果存在，也搜索 `domainMeta.entities`、`domainMeta.businessRules`、`domainMeta.crossDomainInteractions`、`domainMeta.entryPoint` 和 `domainMeta.entryType`。

找到候选节点后，继续查边：

- `contains_flow`：从业务域找到流程。
- `flow_step`：从流程找到有序步骤；如果有 edge weight 或顺序信息，用它还原步骤顺序。
- `cross_domain`：查找相关业务域或跨域交接。

domain graph 只用于补充业务顺序和上下游关系。产品规则和用户可见行为仍以 product-index 为主。


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

