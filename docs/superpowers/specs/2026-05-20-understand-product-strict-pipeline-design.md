# /understand-product 严格分阶段生成流程设计

## 背景

当前 `/understand-product` 已经具备部分 grounded product-index 能力：可以从 `knowledge-graph.json` 中的 `businessSignals` 发现候选入口，生成 `TopicContextPack`，并在 finalize 阶段把 fact 的 `evidenceRefs` 转成最终 `ProductEvidence`。

但当前实现仍存在几个与目标不一致的问题：

- Topic 由代码从 candidate 一对一生成，没有经过 LLM 合并、删除、重命名和摘要。
- Fact 可以由 deterministic fallback 生成，内容容易退化成代码解释。
- CLI 默认路径可以绕过 LLM 直接生成 `product-index.json`。
- LLM 输出没有完整 schema validation 和 warning trace。
- Trace 没有完整记录 boundary candidates、topic normalization、discarded candidates、ignored files、overflow files 和 warnings。

本设计要求 `/understand-product` 严格执行分阶段产物驱动流程。Topic 和 Fact 必须来自 LLM 阶段；代码只负责候选发现、上下文构建、校验、canonicalization 和落盘。

## 目标

1. 正式流程必须经过 LLM Topic Normalization。
2. 正式流程必须经过 LLM Fact + Evidence extraction。
3. 删除 `--fast` 和 default fallback 生成正式 product-index 的路径。
4. 每一步保留中间产物，便于用户审查。
5. 校验不因质量问题中断流程；质量和引用问题写入 warnings。
6. 只有结构性错误阻断执行。
7. 最终 `product-index.json` 只保存产品主题、产品事实和最小代码证据索引。
8. `product-index-trace.json` 保存完整审查链路。

## 非目标

- 不让 `/understand-product` 重新全量扫描源码。
- 不让 LLM 自由新增文件、anchor 或无证据 fact。
- 不把所有 `businessSignals` 提升为 evidence。
- 不把 Topic 当成入口类名集合。
- 不保留 deterministic fallback 作为正式 product-index 生成路径。
- 不在本轮重做 `/understand-chat` 的整体检索架构；只保证它继续能消费最终 product-index。

## 严格 Pipeline

`/understand-product` 执行五个阶段：

```text
1. prepare-candidates
2. normalize-topics
3. build-context-packs
4. extract-facts
5. finalize
```

### Phase 1: prepare-candidates

代码读取：

```text
.understand-anything/knowledge-graph.json
.understand-anything/domain-graph.json
```

代码输出：

```text
.understand-anything/intermediate/product-boundary-candidates.json
```

职责：

- 使用 language/framework entryPoints、graph node、`businessSignals` 发现 `ProductBoundaryCandidate`。
- 关联 root node、filePath、businessSignals、neighborNodeIds、domainRefs。
- 不生成 Topic。
- 不生成 Fact。
- 不生成 Evidence。

### Phase 2: normalize-topics

LLM agent：`understand-anything-plugin/agents/product-topic-normalizer.md`

LLM 读取：

```text
.understand-anything/intermediate/product-boundary-candidates.json
```

LLM 输出：

```text
.understand-anything/intermediate/product-topic-normalization.json
```

职责：

- 对 candidates 做 keep、merge、drop。
- 生成产品化 topic name。
- 生成 topic summary。
- 选择 topic kind。
- 维护 `sourceCandidateIds` 和 `rootNodeIds`。
- 记录 `discardedCandidates`。
- 记录 `sourceReads`。
- 不抽取 Fact。
- 不选择 evidenceRefs。

源码读取规则：

- 默认使用 candidate 内已有信息。
- 如果现有信息不足以判断，可以读取源码。
- 只能读取 candidate 直接相关的 `filePath`。
- 不能全项目搜索。
- 源码读取目的仅限于判断 candidate 是否为产品主题、是否应合并、是否应 drop、topic 应如何命名。

输出结构：

```json
{
  "topics": [
    {
      "id": "topic:boot-startup",
      "name": "开机启动处理",
      "summary": "系统开机广播触发应用初始化和首页数据准备。",
      "kind": "capability",
      "sourceCandidateIds": ["candidate:class:BootBroadcastReceiver"],
      "rootNodeIds": ["class:BootBroadcastReceiver"],
      "domainRefs": [],
      "confidence": "confirmed"
    }
  ],
  "discardedCandidates": [
    {
      "candidateId": "candidate:class:BaseReceiver",
      "reason": "基础广播类，不表达具体产品业务。"
    }
  ],
  "sourceReads": [
    {
      "candidateId": "candidate:class:BootBroadcastReceiver",
      "filePath": "app/BootBroadcastReceiver.java",
      "reason": "确认开机广播入口是否表达具体产品行为。"
    }
  ],
  "warnings": []
}
```

### Phase 3: build-context-packs

代码读取：

```text
.understand-anything/intermediate/product-boundary-candidates.json
.understand-anything/intermediate/product-topic-normalization.json
.understand-anything/knowledge-graph.json
.understand-anything/domain-graph.json
```

代码输出：

```text
.understand-anything/intermediate/product-context-packs.json
```

职责：

- 将 LLM normalized topics 转为 `NormalizedProductTopic`。
- 按 topic root 和 source candidates 做候选文件召回。
- 构建 LLM 可读的 `TopicContextPack`。
- 生成 anchors。
- 记录 overflowFiles。
- 不抽取 Fact。
- 不生成最终 Evidence。

候选文件召回来源：

- root 文件。
- knowledge-graph 直接邻近文件。
- 二跳且带 `businessSignals` 的文件。
- 同一 topic source candidate 直接关联文件。
- domainGraph 直接关联文件。
- route、action、schema、manifest、resource、api、config、cache 等已在 graph summary/signals 中可见的相关文件。

硬过滤：

- test 文件。
- generated 文件。
- build 文件。
- R / BuildConfig。
- 明显第三方依赖。
- 明显通用 util/logger/base。
- 明显纯 DI/module/provider。

过滤只影响 Context Pack 候选输入。带明确 `businessSignals` 的文件应谨慎过滤，优先保留并写 warning。

### Phase 4: extract-facts

LLM agent：`understand-anything-plugin/agents/product-index-analyzer.md`

LLM 读取：

```text
.understand-anything/intermediate/product-context-packs.json
```

LLM 输出：

```text
.understand-anything/intermediate/product-index-extractions.json
```

职责：

- 必须读取 Context Pack 中相关 `candidateFiles[].filePath` 的源码。
- 从源码和 context pack 中裁剪低关联文件。
- 抽取产品 Fact。
- 为每个 Fact 选择最小 evidenceRefs。
- 记录 usedFiles。
- 记录 ignoredFiles。
- 记录 sourceReads。
- 不新增 fileId。
- 不新增 anchorId。
- 不读取全项目源码。

源码读取规则：

- 必须读取被认为相关的 candidate files。
- 只能读取当前 topic 的 `candidateFiles`。
- 不能读取 `overflowFiles`。
- 如果源码中发现重要事实但 Context Pack 没有可引用 anchor，不允许编造 evidenceRef；写入 warning `missing-anchor-for-observed-fact`。

输出结构：

```json
[
  {
    "topicId": "topic:boot-startup",
    "sourceReads": [
      {
        "fileId": "file:app/BootBroadcastReceiver.java",
        "filePath": "app/BootBroadcastReceiver.java",
        "reason": "确认开机广播触发条件和后续处理。"
      }
    ],
    "usedFiles": [
      {
        "fileId": "file:app/BootBroadcastReceiver.java",
        "reason": "承载开机广播入口和处理逻辑。"
      }
    ],
    "ignoredFiles": [
      {
        "fileId": "file:common/BaseReceiver.java",
        "reason": "通用基础类，不表达开机启动业务事实。"
      }
    ],
    "facts": [
      {
        "type": "behavior",
        "text": "系统开机后，应用会接收开机广播并触发后续初始化处理。",
        "conditions": ["系统发出开机广播"],
        "evidenceRefs": ["anchor:function:BootBroadcastReceiver.java:onReceive:0"],
        "confidence": "confirmed"
      }
    ],
    "warnings": []
  }
]
```

### Phase 5: finalize

代码读取：

```text
.understand-anything/intermediate/product-boundary-candidates.json
.understand-anything/intermediate/product-topic-normalization.json
.understand-anything/intermediate/product-context-packs.json
.understand-anything/intermediate/product-index-extractions.json
```

代码输出：

```text
.understand-anything/product-index.json
.understand-anything/product-index-trace.json
```

职责：

- 校验 LLM 输出结构。
- 将 evidenceRefs 转成 `ProductEvidence`。
- 生成稳定 topic/fact/evidence id。
- 合并重复 Fact。
- 删除无有效 Evidence 的 Fact。
- 删除无 Fact 的 Topic。
- 写 coverage。
- 写 quality。
- 写完整 trace。

## CLI 行为

删除：

```text
--fast
default fallback path
```

新增或保留明确阶段参数：

```text
--prepare-candidates
--build-context-packs
--finalize
```

兼容策略：

- `--prepare` 可以作为 `--prepare-candidates` 的别名保留一段时间。
- 文档只展示 `--prepare-candidates`。
- 不带阶段参数时，CLI 报错并打印用法，不生成任何 product-index。

用法错误：

```text
Please run through /understand-product or specify one stage:
--prepare-candidates | --build-context-packs | --finalize
```

## Skill 编排

`understand-anything-plugin/skills/understand-product/SKILL.md` 改为严格顺序：

```text
Phase 1: node product-index-cli.js "$PROJECT_ROOT" --prepare-candidates
Phase 2: dispatch product-topic-normalizer agent
Phase 3: node product-index-cli.js "$PROJECT_ROOT" --build-context-packs
Phase 4: dispatch product-index-analyzer agent
Phase 5: node product-index-cli.js "$PROJECT_ROOT" --finalize
```

每个阶段后检查产物是否存在。缺少 LLM 产物时停止，并提示缺失文件。

## 校验策略

校验不以“质量问题”为理由中断主流程。校验结果写入 `product-index-trace.json.warnings`，并在最终摘要中提示 warning 数量和主要类别。

### 阻断错误

这些错误必须失败：

- `knowledge-graph.json` 缺失或无法解析。
- 阶段所需中间产物缺失。
- JSON 非法。
- LLM 输出顶层结构完全错误，例如 normalization 没有 `topics` 数组，extractions 不是数组。

### 非阻断 Warning

这些问题不阻断：

- candidate 没有被 topic 使用，也没有被 discarded。
- Topic name 像纯类名。
- Topic summary 过短或像代码解释。
- `sourceCandidateIds` 引用了不存在的 candidate。
- `rootNodeIds` 引用了不存在的 graph node。
- `discardedCandidates` 引用了不存在的 candidate。
- 同一个 candidate 同时被使用和 discarded。
- extraction 缺少某个 topic。
- 一个 topic 出现多个 extraction。
- `usedFiles/ignoredFiles.fileId` 不存在。
- fact 没有 evidenceRefs。
- evidenceRefs 不存在。
- fact text 像代码解释。
- ignoredFiles 包含被 fact 引用的文件。
- usedFiles 没覆盖 fact evidence 所在文件。
- 无 Fact 的 Topic 被最终丢弃。
- 无有效 Evidence 的 Fact 被最终丢弃。

Warning 结构：

```json
{
  "code": "topic-name-looks-like-class",
  "severity": "warning",
  "stage": "topic-normalization",
  "message": "Topic name looks like a code class name.",
  "topicId": "topic:PlayerActivity",
  "candidateId": "candidate:class:PlayerActivity"
}
```

`severity` 支持：

```text
info | warning | error
```

`error` 表示结构性失败；`warning` 和 `info` 不阻断。

## Trace

`product-index-trace.json` 必须包含完整审查链路：

```json
{
  "mode": "llm-strict",
  "boundaryCandidates": [],
  "topicNormalization": {},
  "contextPacks": [],
  "extractions": [],
  "discardedCandidates": [],
  "ignoredFiles": [],
  "overflowFiles": [],
  "warnings": []
}
```

保留完整 context packs 是有意设计，因为用户需要逐步确认每一步产物是否符合预期。后续如果产物过大，再引入 summary trace。

## 模块变更

### 保留

- `ProductBoundaryCandidate`
- `buildProductBoundaryCandidates()`
- `TopicContextPack`
- `buildTopicContextPacks()`
- `ProductTopicExtraction`
- `finalizeGroundedProductIndex()`
- `product-index-analyzer.md` 的基本职责
- `product-index.json` public schema 主体
- `product-index-context-builder.ts` 回答链路
- 中间产物保留机制

### 新增

- `understand-anything-plugin/agents/product-topic-normalizer.md`
- `packages/core/src/product-index-pipeline.ts`

`product-index-pipeline.ts` 放内部 pipeline schema、normalization/extraction validation、warning collection 和 trace 构建，避免 `product-index-builder.ts` 继续膨胀。

建议新增函数：

```ts
validateTopicNormalization(...)
applyTopicNormalization(...)
validateProductExtractions(...)
buildProductIndexTrace(...)
```

### 调整

- `normaliseProductTopics()` 不再作为主路径使用。
- `buildTopicContextPacks()` 的主输入来自 LLM normalized topics。
- `finalizeGroundedProductIndex()` 接收 validation warnings 并写入 coverage/trace。
- `product-index-analyzer.md` 强制源码读取和 `sourceReads` 输出。
- `understand-product/SKILL.md` 严格编排两个 LLM 阶段。

## 验收标准

1. CLI 不带明确阶段时不生成 product-index。
2. `/understand-product` 不存在 `--fast` 或 default fallback。
3. 没有 `product-topic-normalization.json` 时不能 build context packs。
4. 没有 `product-index-extractions.json` 时不能 finalize。
5. Topic 可以由多个 candidates merge 而来。
6. dropped candidate 进入 trace。
7. Fact 必须引用 evidenceRefs。
8. Evidence 必须来自 Context Pack anchors。
9. 无效 evidenceRef 会写 warning，并从 fact 中丢弃。
10. 无有效 evidence 的 fact 被丢弃并 warning。
11. 无 fact 的 topic 被丢弃并 warning。
12. `product-index-trace.json` 包含完整审查链路。
13. Topic name 疑似类名时写 warning。
14. Fact text 疑似代码解释时写 warning。
15. `/understand-chat` 能继续优先使用 product-index 回答产品问题，并带出代码证据节点。

## 测试策略

核心单元测试：

- topic normalization schema accepts valid LLM output.
- topic normalization schema rejects invalid top-level shape.
- `applyTopicNormalization()` supports merge/drop/sourceReads.
- invalid candidate references create warnings, not crashes.
- build-context-packs requires topic normalization.
- context packs are built from normalized topics, not deterministic candidate mapping.
- extraction schema accepts valid sourceReads/usedFiles/ignoredFiles/facts.
- invalid evidenceRefs become warnings.
- fact with no valid evidence is dropped.
- topic with no facts is dropped.
- trace includes boundaryCandidates/topicNormalization/contextPacks/extractions/discardedCandidates/ignoredFiles/overflowFiles/warnings.

CLI tests:

- no mode returns usage error and writes no product-index.
- `--prepare-candidates` writes only boundary candidates.
- `--build-context-packs` fails if normalization file is missing.
- `--finalize` fails if extractions file is missing.
- full staged CLI flow with fixture LLM outputs writes product-index and trace.
- `--fast` is rejected as unknown or removed option.

Skill/agent tests:

- `/understand-product` references `product-topic-normalizer.md`.
- `/understand-product` phase order matches strict pipeline.
- `product-index-analyzer.md` requires sourceReads and candidate source reading.

Regression commands:

```bash
corepack pnpm --filter @understand-anything/core test
corepack pnpm --filter @understand-anything/skill test
corepack pnpm --filter @understand-anything/core build
corepack pnpm --filter @understand-anything/skill build
corepack pnpm --filter @understand-anything/dashboard build
```
