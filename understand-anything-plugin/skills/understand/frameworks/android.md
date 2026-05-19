# Android Framework Prompt Addendum

## Android 项目识别

- 将 `AndroidManifest.xml`、`settings.gradle(.kts)`、`build.gradle(.kts)`、`libs.versions.toml`、`src/main/res/`、`src/main/java/`、`src/main/kotlin/` 视为 Android 项目的强线索。
- `com.android.application` 通常表示应用入口 module，`com.android.library` 通常表示可复用 Android library 或 feature module。
- AndroidX、Jetpack Compose、Hilt、Dagger、Room、Retrofit、OkHttp、Navigation、Lifecycle、ViewModel、DataBinding、ViewBinding 都是 Android framework/library 证据。

## 多 Module 边界

- 优先解释 Gradle module 边界，再解释 module 内部结构。
- `:app` 通常负责启动、组装、全局导航、Application 初始化和跨 feature wiring。
- `:feature:*`、`:feature-*` 通常承载页面、用户流程或业务功能。
- `:core:*`、`:common`、`:shared`、`:library:*` 通常承载基础能力、通用 UI、网络、存储、日志、配置或跨业务复用代码。
- 不要仅凭 `Presenter`、`Repository`、`Adapter`、`Manager` 这类技术角色命名推断业务域；业务边界应结合页面名、资源文案、路由、接口、埋点和用户动作判断。

## Android 组件

- `Application` 是进程级初始化入口，常负责 DI、SDK、全局配置和启动前准备。
- `Activity` 与 `Fragment` 是 UI 入口、生命周期承载、权限/Intent 处理和导航触发点。
- `Service`、`BroadcastReceiver`、`ContentProvider` 是 Android framework 组件，应根据 Manifest、intent-filter、权限和调用关系解释职责。
- Manifest 中的 launcher Activity、permission、service、receiver、provider、intent-filter、deep link 是理解入口、能力暴露和系统集成的关键证据。

## UI 与导航

- XML layout、ViewBinding、DataBinding、RecyclerView Adapter 和 Jetpack Compose 都是展示层实现证据。
- Compose 中的 `@Composable`、state hoisting、`remember`、`LaunchedEffect`、`collectAsState` 通常指向 UI state 与生命周期协作。
- Navigation graph、Intent 跳转、deep link、router/route table 共同构成页面流转证据。
- `Adapter` 通常是列表渲染或 UI binding 结构，不应直接当作业务域。

## 数据、依赖注入与架构

- `Repository`、`DataSource`、`DAO`、Room、Retrofit、OkHttp、cache/local/remote source 是数据访问结构。
- Hilt、Dagger、Koin、`@Inject`、`@Module`、`@Provides`、`@Binds` 是依赖注入和组装结构证据。
- MVP、MVVM、MVI、Clean Architecture 都应作为 Android 常见架构模式识别。
- `Presenter` 是 presentation logic，不是业务域本身；`Contract` 是接口边界和协作协议，不是业务流程本身。
- MVP 信号包括 `BasePresenter`、`BaseView`、`attachView`、`detachView`、`subscribe`、`unsubscribe`、`Activity/Fragment implements XxxContract.View`，以及 `Contract` 文件中同时定义 `View` 和 `Presenter` 接口。
- MVVM 信号包括 `ViewModel`、LiveData、StateFlow、UI state、Repository 调用和 lifecycle-aware collection。
- MVI 信号包括 intent/action、reducer、state、effect、unidirectional data flow。
- Clean Architecture 信号包括 `domain`、`usecase`、`interactor`、`data`、`repository`、`entity` 和单向依赖边界。
