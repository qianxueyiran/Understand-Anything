# Kotlin Language Prompt Snippet

## Key Concepts

- **Coroutines and Flow**: Structured concurrency with suspending functions; Flow for reactive streams
- **Data Classes**: Auto-generated `equals`, `hashCode`, `toString`, `copy`, and destructuring
- **Sealed Classes/Interfaces**: Restricted hierarchies enabling exhaustive `when` expressions
- **Extension Functions**: Add methods to existing classes without inheritance or wrappers
- **Null Safety**: `?.` safe call, `!!` non-null assertion, `?:` Elvis operator for default values
- **Delegation (by keyword)**: Delegate interface implementation or property access to another object
- **DSL Builders**: Lambda-with-receiver syntax enabling type-safe builder patterns
- **Inline Functions and Reified Types**: Inline for zero-overhead lambdas; reified for runtime type access
- **Companion Objects**: Named or anonymous singleton associated with a class (replaces static members)
- **Scope Functions**: `let`, `run`, `apply`, `also`, `with` for concise object configuration and transformation
- **Android Coroutines**: `suspend`, `viewModelScope`, `lifecycleScope`, `Flow`, `StateFlow`, and `SharedFlow` often carry async UI/data flow
- **Android Architecture Types**: `ViewModel`, `Presenter`, `Contract`, `UseCase`, `Interactor`, and sealed UI state classes are architecture evidence
- **Jetpack Compose Runtime**: `@Composable`, `remember`, `LaunchedEffect`, state hoisting, and lifecycle-aware collection indicate declarative UI state handling

## Import Patterns

- `import package.ClassName` — import a specific class
- `import package.*` — wildcard import of all declarations in a package
- `import package.function as alias` — import with alias to resolve naming conflicts

## File Patterns

- `build.gradle.kts` — Gradle build script using Kotlin DSL
- `Application.kt` — application entry point (Spring Boot or Ktor)
- `*Application.kt`, `*Activity.kt`, `*Fragment.kt` — Android application and UI lifecycle entry points
- `*ViewModel.kt`, `*Presenter.kt`, `*Contract.kt`, `*UseCase.kt` — Android MVVM/MVP/Clean Architecture structure
- `src/androidTest/kotlin/` — Android instrumentation tests
- `src/main/kotlin/` — main source root following Gradle conventions
- `src/test/kotlin/` — test source root with matching package structure
- `settings.gradle.kts` — multi-module project configuration

## Common Frameworks

- **Spring Boot (Kotlin)** — Kotlin-first support with coroutines and DSL extensions
- **Ktor** — Kotlin-native async web framework from JetBrains
- **Jetpack Compose** — Declarative UI toolkit for Android using composable functions
- **AndroidX / Jetpack** — Android support libraries for lifecycle, navigation, Room, WorkManager, and UI state
- **Hilt / Dagger / Koin** — Dependency injection frameworks commonly used in Android apps
- **Room / Retrofit / OkHttp** — Common persistence and network access stack
- **Exposed** — Lightweight SQL framework with type-safe DSL and DAO patterns
- **Koin** — Pragmatic dependency injection framework using Kotlin DSL

## Android Notes

在 Android 项目中，优先把 `Activity`、`Fragment`、Compose screen、`ViewModel`、`Presenter`、`Repository`、`DataSource`、`DAO`、DI module 和 navigation 线索解释为架构证据。不要把 `Presenter`、`Repository`、`Adapter`、`Manager` 直接当作业务域；业务含义需要结合页面名、资源文案、路由、接口路径、埋点和用户动作判断。

## Example Language Notes

> Uses sealed class hierarchy with `when` exhaustive matching to handle all possible
> API response states. The compiler enforces that every variant is covered, eliminating
> the need for a fallback `else` branch and catching missing cases at compile time.
>
> Extension functions allow adding utilities like `String.toSlug()` without modifying
> the original class — keeping the extension discoverable through IDE auto-complete.
