# 产品知识图谱增强设计

## 背景

Understand Anything 当前已经有三类理解能力：

1. `/understand` 生成代码结构图 `knowledge-graph.json`，用于理解文件、函数、类、依赖、架构层和学习路径。
2. `/understand-domain` 生成业务流程图 `domain-graph.json`，用于理解业务域、业务流程和流程步骤。
3. `/understand-chat` 基于图谱节点检索和一跳关系扩展回答代码库问题。

这些能力适合回答“代码在哪里”“模块如何依赖”“业务流程大致是什么”。但产品经理更常问的是页面级产品知识，例如：

> 播放页是怎么展示码流标签的？不同标签代表什么业务含义？

这类问题需要理解页面元素、展示条件、业务规则、接口字段、枚举映射、资源文案和代码证据链。现有 `knowledge-graph.json` 偏代码结构，`domain-graph.json` 偏业务流程，二者都不能稳定表达这种产品语义。

## 目标

1. 让产品经理能通过项目产物理解页面元素、业务标签、状态、入口、提示语和权益规则的含义。
2. 支持回答“是什么”“为什么展示”“什么条件下展示”“不同标签/状态的业务差异是什么”。
3. 每条产品知识必须尽量绑定代码、资源、接口字段或枚举证据，避免无证据推断。
4. 第一版尽量不影响现有 `/understand` 主流程、结构图生成、领域图生成和 Dashboard 基本使用。
5. 优先覆盖 Android/客户端场景，但数据模型保持通用，后续可扩展到 Web、后端和其他端。

## 非目标

1. 不重构 `/understand` 主流程。
2. 不把产品知识强制塞进 `knowledge-graph.json`。
3. 不替代 `domain-graph.json`。
4. 不在第一版实现复杂的新 Dashboard 全量视图。
5. 不构建向量数据库或外部索引服务。
6. 不要求第一版完整追踪所有跨模块调用，只保证可解释、可验证、可增量增强。

## 推荐方案

采用独立产品知识产物：

```text
.understand-anything/
  knowledge-graph.json      # 代码结构事实层
  domain-graph.json         # 业务流程层，可选
  product-knowledge.json    # 产品语义层，可选，新增
```

新增 `/understand-product` skill，用现有结构图、领域图和必要源码片段生成 `product-knowledge.json`。`/understand-chat` 在回答产品语义问题时优先检索产品知识，再补充领域流程和代码结构证据。

该方案让产品知识成为现有图谱体系的下游增强层，不破坏已有产物和流程。

## 当前知识生产与检索原理

### `knowledge-graph.json`

由 `/understand` 生成，流程如下：

```text
project-scanner
  -> file-analyzer batches
  -> merge-batch-graphs.py
  -> architecture-analyzer
  -> tour-builder
  -> validate and save knowledge-graph.json
```

它负责保存代码结构事实：

- file/function/class/config/document 等节点
- imports/calls/contains/configures/documents 等边
- layers 架构层
- tour 学习路径

### `domain-graph.json`

由 `/understand-domain` 生成，来源有两种：

1. 已有 `knowledge-graph.json` 时，从结构图的节点摘要、边、层和 tour 推导业务域。
2. 没有结构图时，做轻量扫描，提取入口、文件签名和少量片段，再由 agent 生成领域图。

它负责保存业务流程：

- domain 节点：业务域
- flow 节点：业务流程
- step 节点：流程步骤
- contains_flow、flow_step、cross_domain 边

### 当前 Chat 检索

`/understand-chat` 当前主要读取 `knowledge-graph.json`：

1. 搜索节点的 `name`、`tags`、`summary`、`languageNotes`。
2. 对命中节点扩展一跳边关系。
3. 收集相关 layer。
4. 组装 prompt 给模型回答。

这个机制适合代码结构问答，但对产品语义问题不够稳定。

## `product-knowledge.json` 的位置

`product-knowledge.json` 位于产品语义层，是 `knowledge-graph.json` 和 `domain-graph.json` 的下游派生产物：

```text
源码 / 资源 / API model / 枚举 / 埋点 / 文档
        ↓
/understand
        ↓
knowledge-graph.json
        ↓
/understand-domain
        ↓
domain-graph.json
        ↓
/understand-product
        ↓
product-knowledge.json
```

三类产物职责如下：

| 产物 | 层级 | 主要回答 |
|---|---|---|
| `knowledge-graph.json` | 代码结构事实层 | 代码在哪里，如何依赖，属于哪个架构层 |
| `domain-graph.json` | 业务流程层 | 有哪些业务域、流程和步骤 |
| `product-knowledge.json` | 产品语义层 | 页面元素是什么意思，展示条件是什么，字段/标签代表什么业务含义 |

## 第一版数据模型

第一版使用独立 JSON，不复用 `KnowledgeGraph` 的 node/edge schema，以降低对现有验证、Dashboard 和 graph rendering 的影响。

```typescript
interface ProductKnowledge {
  version: string;
  project: {
    name: string;
    analyzedAt: string;
    gitCommitHash: string;
  };
  productAreas: ProductArea[];
  concepts: ProductConcept[];
}

interface ProductArea {
  id: string;
  name: string;
  summary: string;
  domainRefs?: string[];
  codeRefs?: EvidenceRef[];
}

interface ProductConcept {
  id: string;
  name: string;
  areaId?: string;
  meaning: string;
  userFacingTerms: string[];
  businessRules: string[];
  displayRules: DisplayRule[];
  dataFields: DataFieldRef[];
  relatedConceptIds: string[];
  evidence: EvidenceRef[];
  confidence: "confirmed" | "inferred" | "uncertain";
}

interface DisplayRule {
  condition: string;
  result: string;
  evidence?: EvidenceRef[];
}

interface DataFieldRef {
  name: string;
  source: "api" | "model" | "enum" | "resource" | "local-state" | "unknown";
  meaning: string;
  evidence?: EvidenceRef[];
}

interface EvidenceRef {
  filePath?: string;
  nodeId?: string;
  symbol?: string;
  lineRange?: [number, number];
  reason: string;
}
```

### 示例

```json
{
  "id": "concept:stream-quality-label",
  "name": "码流标签",
  "areaId": "area:playback-page",
  "meaning": "用于向用户表达当前内容可播放的清晰度、画质能力或权益限制。",
  "userFacingTerms": ["高清", "蓝光", "HDR"],
  "businessRules": [
    "标签展示依赖内容可用码流、用户权益和设备播放能力。"
  ],
  "displayRules": [
    {
      "condition": "接口返回对应码流标签且当前码流可展示",
      "result": "在播放页清晰度入口或码流选择列表展示对应标签"
    }
  ],
  "dataFields": [
    {
      "name": "stream.label",
      "source": "api",
      "meaning": "服务端下发的码流展示文案或枚举"
    }
  ],
  "relatedConceptIds": [],
  "evidence": [
    {
      "filePath": "player/PlayerViewModel.kt",
      "symbol": "buildStreamLabels",
      "lineRange": [120, 168],
      "reason": "构建播放页可展示码流标签"
    }
  ],
  "confidence": "confirmed"
}
```

## 产品知识生产流程

### `/understand-product`

新增可选 skill，不自动插入 `/understand` 主链路。

```text
/understand-product
  -> 读取 knowledge-graph.json
  -> 可选读取 domain-graph.json
  -> 运行产品知识上下文抽取
  -> dispatch product-analyzer
  -> validate product-knowledge.json
  -> 保存 product-knowledge.json
```

### 上下文抽取

第一版上下文抽取重点服务 Android/客户端：

1. 页面入口：Activity、Fragment、Compose screen、ViewModel、Presenter。
2. UI 元素：layout、binding、Adapter、Compose UI、菜单、弹窗、列表项。
3. 文案资源：`strings.xml`、资源 key、硬编码展示文案。
4. 数据字段：API model、response、DTO、enum、常量。
5. 业务规则：if/when/switch、状态判断、权益判断、设备能力判断。
6. 证据引用：文件路径、symbol、line range、相关 graph node id。

上下文抽取的目标不是重新实现完整静态分析，而是给 `product-analyzer` 提供足够高信号的材料。

### `product-analyzer`

新增 agent，职责是把上下文解释成产品知识：

1. 识别产品区域，例如播放页、搜索页、详情页、会员权益页。
2. 识别产品概念，例如码流标签、清晰度、试看、会员角标、下载状态。
3. 解释面向用户的业务含义。
4. 提取展示规则、字段来源和业务规则。
5. 给每个结论绑定证据。
6. 对证据不足的结论标记 `inferred` 或 `uncertain`。

## 产品知识检索流程

产品知识检索是分层召回：

```text
用户问题
  -> QueryIntentParser
  -> ProductKnowledgeRetriever
  -> DomainContextExpander
  -> CodeEvidenceExpander
  -> UnifiedAnswerContext
  -> PM-oriented answer
```

### 1. Query intent parsing

从用户问题中提取：

- 页面或区域：例如播放页
- 产品概念：例如码流标签
- 关注点：展示规则、业务含义、数据来源、代码证据
- 问题类型：产品解释、规则解释、影响分析、证据追踪

第一版可用规则和关键词启发式实现，不引入新模型调用。

### 2. 优先检索 `product-knowledge.json`

检索字段：

- `productAreas.name`
- `productAreas.summary`
- `concepts.name`
- `concepts.meaning`
- `concepts.userFacingTerms`
- `concepts.businessRules`
- `concepts.displayRules.condition`
- `concepts.displayRules.result`
- `concepts.dataFields.name`
- `concepts.dataFields.meaning`

命中后得到产品上下文：

- 概念含义
- 面向用户的术语
- 展示规则
- 数据字段
- 业务规则
- 证据引用
- 置信度

### 3. 补充 `domain-graph.json`

如果产品知识里有 `areaId`、`domainRefs` 或概念名能匹配 domain/flow/step，则补充：

- 所属业务域
- 相关流程
- 流程步骤
- 跨业务域关系

这一步回答“它属于哪个业务流程”。

### 4. 补充 `knowledge-graph.json`

用 product evidence 里的 `filePath`、`nodeId`、`symbol` 反查结构图：

- 找相关 file/function/class 节点
- 扩展一跳 imports/calls/contains 关系
- 找所属 layer
- 形成代码证据上下文

这一步回答“实现链路和证据在哪里”。

### 5. 组装回答

回答顺序面向产品经理：

1. 先解释产品概念是什么。
2. 再解释不同标签、状态或入口的业务含义。
3. 再解释什么条件下展示。
4. 再说明数据来自哪里。
5. 最后列代码证据。
6. 如果证据不足，明确说明当前图谱无法确认。

## 修改项与流程影响评估

| 修改项 | 内容 | 对项目流程影响 | 风险 | 说明 |
|---|---|---:|---:|---|
| 新增产品知识类型 | 新增 `ProductKnowledge` 独立类型 | 低 | 低 | 不修改 `KnowledgeGraph` 主 schema |
| 新增持久化函数 | `saveProductKnowledge` / `loadProductKnowledge` | 低 | 低 | 与现有 `saveDomainGraph` 类似 |
| 新增 `product-knowledge.json` | 独立保存产品语义层 | 低 | 低 | 不存在时系统照旧 |
| 新增 `/understand-product` | 可选生成产品知识 | 低 | 中 | 不挂进 `/understand`，避免主流程变慢 |
| 新增 `product-analyzer` agent | 抽取产品区域、概念、展示规则、证据 | 低 | 中 | 主要风险是证据不足或推断过度 |
| 新增上下文抽取脚本 | 面向 Android/客户端抽取页面、文案、字段、规则线索 | 中 | 中 | 独立脚本，不影响 `/understand` scanner |
| 增强 Android 规则 | 补充产品元素、资源文案、枚举、埋点、API 字段规则 | 低 | 中 | 复用已有 Android 规则增强方向 |
| 增强 `/understand-chat` | 产品问题优先查产品知识，再补 domain 和 code evidence | 中 | 中 | 需保证没有产品知识时完全回退旧逻辑 |
| Dashboard 轻量展示 | 在 sidebar 或新 tab 展示产品概念和证据 | 中 | 中 | 第一版只做轻量展示，不新建复杂图 |
| 新增校验器 | 校验证据路径、字段完整性、置信度 | 低 | 低 | 保护输出质量 |
| 新增测试 | core 类型、持久化、检索、prompt 规则测试 | 低 | 低 | 不需要完整 Android fixture |

## 对现有流程的影响

### `/understand`

默认不变。

不新增 phase，不改变已有输出，不增加主流程耗时。未来如果要自动触发产品知识生成，应通过显式参数，例如 `/understand --product`，不作为第一版默认行为。

### `/understand-domain`

默认不变。

`/understand-product` 可以读取 `domain-graph.json` 补充业务背景，但 `domain-graph.json` 不依赖产品知识。

### `/understand-chat`

有轻微行为变化：

1. 如果存在 `product-knowledge.json`，并且问题像产品语义问题，则优先检索产品知识。
2. 如果不存在产品知识，或未命中产品知识，则沿用当前 `knowledge-graph.json` 检索。
3. 回答中新增“产品含义、展示规则、数据来源、代码证据”的组织方式。

这是对 PM 使用价值最大的改动，也是第一版最重要的集成点。

### Dashboard

第一版只做轻量集成：

1. 如果存在 `product-knowledge.json`，可在 sidebar 或产品知识 tab 展示概念详情。
2. 点击证据时跳转到已有 CodeViewer 或结构图节点。
3. 不新增复杂产品图布局，避免影响现有图渲染和性能。

### 测试与发布

新增测试应聚焦低风险边界：

1. `product-knowledge.json` 保存和读取。
2. 产品知识检索能命中 `name`、`userFacingTerms`、`displayRules`。
3. Chat 在无产品知识时回退旧逻辑。
4. Chat 在有产品知识时优先返回产品上下文。
5. Android 规则文件包含资源文案、页面元素、API 字段、枚举、展示条件等关键词。

## 错误处理

1. 没有 `knowledge-graph.json` 时，`/understand-product` 可以提示先运行 `/understand`，或进入轻量模式。第一版建议要求先运行 `/understand`，降低复杂度。
2. 没有 `domain-graph.json` 时，不阻塞产品知识生成，只缺少业务流程背景。
3. 证据文件不存在时，该 evidence 降级为 warning，概念置信度不应为 `confirmed`。
4. 同一概念被多处识别时，按 `id` 合并，保留多条 evidence。
5. 模型输出无法解析时，不覆盖旧的 `product-knowledge.json`。

## 验收标准

1. 新增 `product-knowledge.json` 不影响现有 `/understand` 和 `/understand-domain`。
2. 没有 `product-knowledge.json` 时，`/understand-chat` 行为保持兼容。
3. 有产品知识时，类似“播放页码流标签是什么意思、怎么展示”能优先召回产品概念、展示规则和证据。
4. 产品知识中的 confirmed 结论必须至少有一条有效 evidence。
5. Dashboard 可以展示产品概念详情，并能从 evidence 跳到代码位置或结构节点。
6. 所有新增说明性内容使用中文。

## 实施顺序

1. 新增产品知识类型、校验和持久化。
2. 新增 `/understand-product` skill 骨架。
3. 新增产品知识上下文抽取脚本。
4. 新增 `product-analyzer` agent prompt。
5. 新增产品知识检索器和 chat 上下文格式化。
6. Dashboard 轻量展示产品概念详情和证据跳转。
7. 补测试和文档。

## 后续扩展

1. 支持 `/understand --product` 显式联动生成。
2. 支持增量更新产品知识。
3. 支持 Web/后端产品知识规则包。
4. 支持概念之间的可视化关系图。
5. 支持导出 PM 可读的产品知识 Markdown。
