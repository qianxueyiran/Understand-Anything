# Android 项目理解规则增强设计

## 背景

Understand Anything 当前通过 `/understand` skill 编排项目扫描、批量文件分析、图谱合并、架构分层、学习 tour 和 dashboard 展示。现有流程偏通用代码库理解，对 Android 大型多 Module 项目的 Java、Kotlin、Android framework 和常见客户端架构模式理解不足。

本次目标不是改造分析流水线，而是在现有扩展点上强化规则，让现有 agent 在不改变 workflow 的前提下更准确理解 Android 项目。

## 目标

1. 提升 Android 项目识别能力，使项目扫描阶段能把 Android 识别为 framework。
2. 强化 Kotlin 和 Java 在 Android 场景下的语言特性理解。
3. 强化 Android 组件、资源、导航、依赖注入、数据访问和 UI 技术的职责判断。
4. 支持识别 MVP、MVVM、MVI、Clean Architecture 等 Android 常见架构模式。
5. 支持更准确理解多 Module 项目中的模块命名、模块职责和模块内架构模式。

## 非目标

本次不实现以下内容：

1. 不改变 `/understand` 的 phase 顺序或主流程。
2. 不新增 Android 专用预扫描阶段。
3. 不新增 Gradle module graph、Manifest graph 或 Navigation graph 的新数据结构。
4. 不修改 KnowledgeGraph node/edge schema。
5. 不新增 Kotlin tree-sitter extractor。
6. 不新增 AndroidManifest、Navigation XML、Gradle 的确定性 parser。
7. 不修改 dashboard 视图。

## 推荐方案

采用“规则增强包”方案：只在现有 prompt、language snippet、framework addendum 和轻量启发式配置中补充 Android 规则。该方案利用现有 `/understand` 的扩展机制，不改变系统架构和执行路径。

## 文件级设计

### `understand-anything-plugin/skills/understand/frameworks/android.md`

新增 Android framework addendum，作为 Android 项目理解的主规则文件。

内容覆盖：

1. Android 多 Module 常见结构：`:app`、`:feature:*`、`:core:*`、`:common`、`:shared`、`:library:*`。
2. Gradle 线索：`settings.gradle(.kts)`、`build.gradle(.kts)`、`libs.versions.toml`、`com.android.application`、`com.android.library`。
3. Manifest 线索：`AndroidManifest.xml`、launcher Activity、permission、service、receiver、provider、intent-filter、deep link。
4. Android 组件：`Activity`、`Fragment`、`Service`、`BroadcastReceiver`、`ContentProvider`、`Application`。
5. UI 技术：XML layout、ViewBinding、DataBinding、Jetpack Compose、RecyclerView Adapter。
6. 导航技术：Navigation graph、Intent 跳转、deep link、路由表。
7. 数据访问：Repository、DataSource、DAO、Room、Retrofit、OkHttp、cache/local/remote source。
8. 依赖注入：Hilt、Dagger、Koin、`@Inject`、`@Module`、`@Provides`、`@Binds`。
9. 架构模式：MVP、MVVM、MVI、Clean Architecture。

关键约束：

1. 不要把 `Presenter`、`Repository`、`Adapter`、`Manager` 直接当作业务域。
2. 技术角色应作为业务功能实现结构的证据，而不是业务边界本身。
3. 架构分析优先解释 module 边界，再解释 module 内部结构。

### `understand-anything-plugin/agents/project-scanner.md`

补充 Android framework detection 规则。

当发现以下信号时，应把 `Android` 加入 frameworks：

1. 任意路径存在 `AndroidManifest.xml`。
2. `build.gradle` 或 `build.gradle.kts` 包含 `com.android.application` 或 `com.android.library`。
3. 存在 `settings.gradle` 或 `settings.gradle.kts`，并且包含 Android module include。
4. 存在 `src/main/res`、`src/main/java`、`src/main/kotlin` 等 Android 源集目录。
5. `libs.versions.toml` 或 Gradle 文件出现 Android Gradle Plugin、AndroidX、Jetpack、Compose、Hilt、Room 等依赖线索。

该修改只影响 scanner 输出的 framework 名称，不新增扫描阶段。

### `understand-anything-plugin/skills/understand/languages/kotlin.md`

强化 Kotlin 在 Android 项目中的语言规则。

重点补充：

1. `suspend`、coroutines、Flow、StateFlow、SharedFlow。
2. `data class`、`sealed class`、`object`、`companion object`。
3. extension function、higher-order function、DSL builder。
4. null safety、scope functions、delegation。
5. Compose 的 `@Composable`、state hoisting、remember、LaunchedEffect。
6. Android 生命周期相关方法和回调。
7. MVP 中常见泛型基类，例如 `BasePresenter<V : BaseView>`。

### `understand-anything-plugin/skills/understand/languages/java.md`

强化 Java 在 Android 项目中的语言规则。

重点补充：

1. 注解驱动结构，例如 `@Override`、`@Inject`、`@Provides`、`@Binds`。
2. 泛型接口和抽象基类。
3. 匿名内部类、callback/listener、RxJava observer。
4. Android 生命周期方法，例如 `onCreate`、`onStart`、`onResume`、`onPause`、`onDestroy`。
5. MVP 中的 `Contract.View`、`Contract.Presenter`、`Presenter` 与 `View` 绑定关系。

### `understand-anything-plugin/agents/file-analyzer.md`

补充 Android 文件职责识别规则。

新增规则应指导 agent：

1. 识别 `Activity` / `Fragment` 为 UI 入口、生命周期承载和导航触发点。
2. 识别 `ViewModel` 为 UI 状态和页面逻辑承载。
3. 识别 `Presenter` / `Contract` / `View` 为 MVP 结构证据。
4. 识别 `Repository` / `DataSource` / `DAO` / `Room` / `Retrofit` 为数据访问结构。
5. 识别 `Adapter` 为列表渲染或 UI 绑定结构，不直接当业务域。
6. 识别 `UseCase` / `Interactor` 为业务动作或应用服务边界的重要证据。
7. 结合资源文案、路由、页面类名、菜单、埋点、接口路径判断业务含义。

### `understand-anything-plugin/agents/architecture-analyzer.md`

补充 Android 架构分层规则。

分析 Android 项目时，优先顺序为：

1. 先识别 Gradle module 边界和 module 命名意图。
2. 再识别 module 内部架构模式，例如 MVP、MVVM、MVI、Clean Architecture。
3. 最后结合依赖方向、文件摘要、Android 组件和数据访问结构形成 layer。

分层规则：

1. `app` module 通常是启动、组装和全局导航入口。
2. `feature-*` module 通常承载页面或业务功能。
3. `core-*`、`common`、`shared` 通常承载基础能力。
4. `data`、`repository`、`datasource`、`dao`、`database` 倾向数据层。
5. `domain`、`usecase`、`interactor` 倾向领域或应用服务层。
6. `ui`、`view`、`activity`、`fragment`、`compose`、`viewmodel`、`presenter` 倾向展示或 presentation 层。
7. `contract` 倾向接口/类型边界。
8. `di`、`hilt`、`dagger` 倾向依赖注入或配置层。

要求不要把每个技术角色机械拆成全局大层。对大型多 Module 项目，layer 名称应帮助用户理解项目，而不是复述每个目录名。

### `understand-anything-plugin/packages/core/src/languages/configs/kotlin.ts`

轻量补充 Kotlin 元数据，不新增 extractor。

建议增加：

1. Android 相关 concepts：Android lifecycle、Jetpack Compose、ViewModel、MVP、MVVM、Hilt、Room、Retrofit。
2. entry point patterns：`**/*Application.kt`、`**/*Activity.kt`、`**/*Fragment.kt`。
3. architecture patterns：`**/*ViewModel.kt`、`**/*Presenter.kt`、`**/*Contract.kt`、`**/*UseCase.kt`。
4. test patterns：`**/androidTest/**/*.kt`、`**/test/**/*.kt`。

### `understand-anything-plugin/packages/core/src/languages/configs/java.ts`

轻量补充 Java 元数据。

建议增加：

1. Android 相关 concepts：Android lifecycle、annotations、callbacks、MVP、MVVM、Hilt、Dagger、Room、Retrofit。
2. entry point patterns：`**/*Application.java`、`**/*Activity.java`、`**/*Fragment.java`。
3. architecture patterns：`**/*Presenter.java`、`**/*Contract.java`、`**/*ViewModel.java`、`**/*UseCase.java`。
4. test patterns：`**/androidTest/**/*.java`、`**/test/**/*.java`。

### `understand-anything-plugin/packages/core/src/analyzer/layer-detector.ts`

同步轻量 fallback 规则。

建议补充：

1. UI / Presentation：`activity`、`fragment`、`compose`、`viewmodel`、`screen`、`layout`、`view`。
2. Presentation Logic：`presenter`。
3. Interface / Types：`contract`、`dto`、`request`、`response`。
4. Domain / Service：`usecase`、`interactor`、`domain`。
5. Data：`repository`、`datasource`、`dao`、`room`、`database`、`entity`。
6. DI / Configuration：`di`、`hilt`、`dagger`、`inject`。
7. Navigation：`navigation`、`navgraph`、`router`。
8. Test：`androidTest`、`test`。

该文件只是 fallback heuristic，同步规则即可，不承载 Android 专用分析流程。

## MVP 识别规则

MVP 需要作为 Android 架构模式明确加入规则。

识别信号：

1. 文件名包含 `Presenter`、`Contract`、`View`。
2. 存在 `BasePresenter`、`BaseView`。
3. 存在 `attachView`、`detachView`、`subscribe`、`unsubscribe` 等生命周期绑定方法。
4. `Activity` 或 `Fragment` 实现 `XxxContract.View`。
5. `Presenter` 持有或调用 `View` 接口。
6. `Contract` 文件内同时定义 `View` 和 `Presenter` 接口。

解释规则：

1. `Presenter` 是 presentation logic，不是业务域本身。
2. `Contract` 是接口边界和协作协议，不是业务流程本身。
3. `Model`、`Repository`、`DataSource` 是数据来源或业务数据访问结构。
4. 业务含义应结合页面名、路由、资源文案、接口、埋点和用户动作判断。

## 数据流

现有数据流保持不变：

1. `/understand` 解析参数并准备扫描。
2. `project-scanner` 识别文件、语言、frameworks 和 importMap。
3. `file-analyzer` 按批次生成节点和边。
4. `merge-batch-graphs.py` 合并图谱。
5. `architecture-analyzer` 注入 language snippet 和 framework addendum 后生成 layers。
6. `tour-builder` 生成 tour。
7. validation 后保存 `knowledge-graph.json`。

Android 规则只在第 2、3、5 步通过现有 prompt/context 产生影响。

## 错误处理与风险

### 风险 1：只新增 `android.md` 但没有 scanner 输出 `Android`

缓解：必须同步补充 `project-scanner.md` 的 Android detection 规则。

### 风险 2：Kotlin 没有 tree-sitter extractor，结构抽取仍弱

缓解：本轮不解决 AST 精度，只通过 `kotlin.md` 和 `file-analyzer.md` 规则要求 agent 在必要时补充读取和理解 Kotlin 文件。

### 风险 3：技术层被误判为业务边界

缓解：在 `android.md`、`file-analyzer.md`、`architecture-analyzer.md` 中明确禁止把 `Presenter`、`Repository`、`Adapter`、`Manager` 直接当业务域。

### 风险 4：多 Module 需求膨胀成流程改造

缓解：本轮只让 agent 理解 module 命名和边界，不生成新的 module graph，也不新增 Gradle parser。

## 测试策略

1. 增加轻量文本规则测试或快照测试，确认关键 Android 规则文件存在并包含核心关键词。
2. 如已有 scanner prompt 测试，可补充 Android detection 文案存在性断言。
3. 如修改 `kotlin.ts`、`java.ts`、`layer-detector.ts`，运行现有 core 单元测试。
4. 不要求构建真实 Android fixture 或跑完整 `/understand`，因为本轮是规则增强，不是流程实现。

## 实施顺序

1. 新增 `understand-anything-plugin/skills/understand/frameworks/android.md`。
2. 修改 `understand-anything-plugin/agents/project-scanner.md`，补 Android framework detection。
3. 修改 `understand-anything-plugin/skills/understand/languages/kotlin.md` 和 `understand-anything-plugin/skills/understand/languages/java.md`。
4. 修改 `understand-anything-plugin/agents/file-analyzer.md`。
5. 修改 `understand-anything-plugin/agents/architecture-analyzer.md`。
6. 轻量修改 `understand-anything-plugin/packages/core/src/languages/configs/kotlin.ts`、`understand-anything-plugin/packages/core/src/languages/configs/java.ts`、`understand-anything-plugin/packages/core/src/analyzer/layer-detector.ts`。
7. 增加或更新最小测试。
8. 运行相关测试并记录结果。

## 验收标准

1. `/understand` 主流程说明没有新增 phase。
2. graph schema 没有变化。
3. Android 项目规则能通过现有 framework addendum 机制进入 architecture analysis。
4. Java/Kotlin 规则明确覆盖 Android 生命周期、注解、异步、MVP/MVVM/MVI/Clean Architecture。
5. MVP 相关文件不会被规则描述为业务域本身，而是被描述为 presentation 架构证据。
6. 多 Module 规则只用于理解 module 边界和职责，不引入新数据结构。
