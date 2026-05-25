# Java Language Prompt Snippet

## Key Concepts

- **Generics (with Erasure)**: Parameterized types erased at runtime; compile-time safety only
- **Annotations**: Metadata markers (`@Override`, `@Autowired`) processed at compile or runtime
- **Interfaces and Abstract Classes**: Contracts with default methods (Java 8+) and partial implementations
- **Streams API**: Functional-style pipeline operations on collections (filter, map, reduce)
- **Lambdas**: Concise anonymous function syntax for functional interfaces
- **Sealed Classes**: Restricted class hierarchies with explicit permitted subclasses (Java 17+)
- **Records**: Immutable data carriers with auto-generated accessors, equals, hashCode (Java 16+)
- **Dependency Injection**: IoC pattern central to Spring; constructor, field, or method injection
- **Checked vs Unchecked Exceptions**: Checked must be declared or caught; unchecked extend RuntimeException
- **Optional**: Container for nullable values encouraging explicit handling over null checks
- **Android Lifecycle Overrides**: `onCreate`, `onStart`, `onResume`, `onPause`, `onStop`, `onDestroy`, and callback/listener methods often define UI lifecycle behavior
- **Android Annotations and DI**: `@Inject`, `@Module`, `@Provides`, `@Binds`, `@AndroidEntryPoint`, and `@Override` can reveal Hilt/Dagger wiring and framework contracts
- **MVP Contracts**: `Contract.View`, `Contract.Presenter`, `BasePresenter`, `BaseView`, and presenter/view binding methods are Android MVP structure evidence

## Import Patterns

- `import package.Class` — import a specific class
- `import package.*` — wildcard import of all classes in a package
- `import static package.Class.method` — static import for direct method/constant access

## File Patterns

- `src/main/java/` — source root following Maven/Gradle standard layout
- `src/test/java/` — test source root with matching package structure
- `pom.xml` — Maven project configuration and dependency management
- `build.gradle` — Gradle build script (Groovy or Kotlin DSL)
- `Application.java` — Spring Boot entry point with `@SpringBootApplication`
- `*Application.java`, `*Activity.java`, `*Fragment.java` — Android application and UI lifecycle entry points
- `*Presenter.java`, `*Contract.java`, `*ViewModel.java`, `*UseCase.java` — Android MVP/MVVM/Clean Architecture structure
- `src/androidTest/java/` — Android instrumentation tests

## Common Frameworks

- **Spring Boot** — Opinionated framework for production-ready Spring applications
- **Android Framework / AndroidX** — Activity, Fragment, lifecycle, navigation, RecyclerView, Room, and other Android app building blocks
- **Hilt / Dagger** — Annotation-driven dependency injection frameworks common in Android Java/Kotlin projects
- **Retrofit / OkHttp / Room** — Common network and persistence stack
- **Jakarta EE** — Enterprise Java standards (formerly Java EE) for server-side development
- **Quarkus** — Cloud-native framework optimized for GraalVM and containers
- **Micronaut** — Compile-time DI framework for microservices and serverless
- **Hibernate** — ORM framework implementing JPA specification

## Android Notes

在 Android Java 项目中，`Activity` / `Fragment` 是 UI 入口和生命周期承载，`Presenter` / `Contract` / `View` 是 MVP 协作结构，`Repository` / `DataSource` / `DAO` 是数据访问结构。不要把这些技术角色直接当作业务域；业务含义需要结合页面名、Manifest、路由、资源文案、接口路径和用户动作判断。

## Example Language Notes

> Uses `@Autowired` annotation for constructor injection, following Spring IoC container
> pattern. Constructor injection is preferred over field injection because it makes
> dependencies explicit and enables immutability.
>
> The Maven standard directory layout (`src/main/java`, `src/test/java`) is a strong
> convention — most build tools and IDEs expect this structure by default.
