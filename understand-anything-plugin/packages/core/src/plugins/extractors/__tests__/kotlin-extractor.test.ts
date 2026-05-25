import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { KotlinExtractor } from "../kotlin-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let kotlinLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm",
  );
  kotlinLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(kotlinLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("KotlinExtractor", () => {
  const extractor = new KotlinExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["kotlin"]);
  });

  it("extracts classes, properties, member functions, and top-level functions", () => {
    const { tree, parser, root } = parse(`package com.example.home

import kotlinx.coroutines.flow.Flow
import com.example.analytics.Tracker as AnalyticsTracker

class HomeViewModel(
    private val repository: HomeRepository
) {
    private val screenName = "home"

    suspend fun loadHome(userId: String): HomeState {
        repository.load(userId)
        return HomeState()
    }

    override fun onCleared() {
        repository.close()
    }
}

fun Context.openHome(tabId: String) {
    startActivity(HomeActivity.intent(this, tabId))
}
`);
    const result = extractor.extractStructure(root);

    expect(result.imports).toEqual([
      {
        source: "kotlinx.coroutines.flow.Flow",
        specifiers: ["Flow"],
        lineNumber: 3,
      },
      {
        source: "com.example.analytics.Tracker",
        specifiers: ["AnalyticsTracker"],
        lineNumber: 4,
      },
    ]);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]).toMatchObject({
      name: "HomeViewModel",
      methods: ["loadHome", "onCleared"],
      properties: ["repository", "screenName"],
    });

    expect(result.functions.map((fn) => fn.name)).toEqual([
      "loadHome",
      "onCleared",
      "openHome",
    ]);
    expect(result.functions[0]).toMatchObject({
      name: "loadHome",
      params: ["userId"],
      returnType: "HomeState",
    });
    expect(result.functions[2]).toMatchObject({
      name: "openHome",
      params: ["tabId"],
    });

    tree.delete();
    parser.delete();
  });

  it("extracts object declarations and call graph entries", () => {
    const { tree, parser, root } = parse(`object HomeRouter {
    fun routeToHome(id: String) {
        Analytics.track(id)
        openHome(id)
    }
}
`);
    const structure = extractor.extractStructure(root);
    const callGraph = extractor.extractCallGraph(root);

    expect(structure.classes).toHaveLength(1);
    expect(structure.classes[0].name).toBe("HomeRouter");
    expect(structure.functions.map((fn) => fn.name)).toEqual(["routeToHome"]);
    expect(callGraph).toEqual([
      {
        caller: "routeToHome",
        callee: "Analytics.track",
        lineNumber: 3,
      },
      {
        caller: "routeToHome",
        callee: "openHome",
        lineNumber: 4,
      },
    ]);

    tree.delete();
    parser.delete();
  });
});
