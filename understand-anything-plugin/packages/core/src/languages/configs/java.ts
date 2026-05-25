import type { LanguageConfig } from "../types.js";

export const javaConfig = {
  id: "java",
  displayName: "Java",
  extensions: [".java"],
  treeSitter: {
    wasmPackage: "tree-sitter-java",
    wasmFile: "tree-sitter-java.wasm",
  },
  concepts: [
    "generics",
    "annotations",
    "interfaces",
    "abstract classes",
    "streams API",
    "lambdas",
    "sealed classes",
    "records",
    "dependency injection",
    "checked exceptions",
    "Android lifecycle",
    "callbacks",
    "MVP",
    "MVVM",
    "Hilt",
    "Dagger",
    "Room",
    "Retrofit",
  ],
  filePatterns: {
    entryPoints: [
      "**/*Application.java",
      "**/*Activity.java",
      "**/*Fragment.java",
      "**/Application.java",
      "**/Main.java",
      "src/main/java/**/App.java",
    ],
    barrels: [],
    tests: ["**/androidTest/**/*.java", "**/test/**/*.java", "*Test.java", "*Tests.java", "*IT.java"],
    config: ["pom.xml", "build.gradle", "build.gradle.kts"],
  },
} satisfies LanguageConfig;
