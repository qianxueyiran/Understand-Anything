import type { CallGraphEntry, StructuralAnalysis } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

function directChildren(node: TreeSitterNode): TreeSitterNode[] {
  const children: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      children.push(child);
    }
  }
  return children;
}

function directChild(node: TreeSitterNode, type: string): TreeSitterNode | null {
  return directChildren(node).find((child) => child.type === type) ?? null;
}

function directChildrenOfType(node: TreeSitterNode, type: string): TreeSitterNode[] {
  return directChildren(node).filter((child) => child.type === type);
}

function descendantsOfType(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const matches: TreeSitterNode[] = [];
  const visit = (current: TreeSitterNode) => {
    if (current.type === type) {
      matches.push(current);
    }
    for (let i = 0; i < current.childCount; i++) {
      const child = current.child(i);
      if (child) {
        visit(child);
      }
    }
  };
  visit(node);
  return matches;
}

function firstIdentifier(node: TreeSitterNode): TreeSitterNode | null {
  return directChild(node, "identifier") ?? findChild(node, "identifier");
}

function hasVisibilityModifier(node: TreeSitterNode, modifier: string): boolean {
  const modifiers = directChild(node, "modifiers");
  if (!modifiers) {
    return false;
  }
  return modifiers.text.split(/\s+/).includes(modifier);
}

function isExported(node: TreeSitterNode): boolean {
  return !hasVisibilityModifier(node, "private") && !hasVisibilityModifier(node, "internal");
}

function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) {
    return [];
  }

  return findChildren(paramsNode, "parameter")
    .map((param) => firstIdentifier(param)?.text)
    .filter((name): name is string => Boolean(name));
}

function extractReturnType(functionNode: TreeSitterNode, paramsNode: TreeSitterNode | null): string | undefined {
  if (!paramsNode) {
    return undefined;
  }

  const returnType = directChildren(functionNode).find(
    (child) =>
      child.startIndex > paramsNode.endIndex &&
      (child.type === "user_type" ||
        child.type === "nullable_type" ||
        child.type === "function_type" ||
        child.type === "type_identifier"),
  );

  return returnType?.text;
}

function lastIdentifierText(node: TreeSitterNode): string | undefined {
  const identifiers: string[] = [];
  const visit = (current: TreeSitterNode) => {
    if (current.type === "identifier") {
      identifiers.push(current.text);
    }
    for (let i = 0; i < current.childCount; i++) {
      const child = current.child(i);
      if (child) {
        visit(child);
      }
    }
  };
  visit(node);
  return identifiers.at(-1);
}

function extractPropertyName(node: TreeSitterNode): string | undefined {
  if (node.type === "class_parameter") {
    return firstIdentifier(node)?.text;
  }

  const variable = directChild(node, "variable_declaration");
  return variable ? firstIdentifier(variable)?.text : undefined;
}

function extractCallee(callNode: TreeSitterNode): string | null {
  const callee = directChildren(callNode).find((child) => child.type !== "value_arguments");
  if (!callee) {
    return null;
  }

  if (callee.type === "identifier") {
    return callee.text;
  }

  if (callee.type === "navigation_expression") {
    const identifiers = directChildrenOfType(callee, "identifier").map((child) => child.text);
    return identifiers.length > 0 ? identifiers.join(".") : callee.text;
  }

  return lastIdentifierText(callee) ?? null;
}

export class KotlinExtractor implements LanguageExtractor {
  readonly languageIds = ["kotlin"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (const node of directChildren(rootNode)) {
      switch (node.type) {
        case "import":
          this.extractImport(node, imports);
          break;

        case "class_declaration":
        case "object_declaration":
        case "interface_declaration":
          this.extractClassLike(node, functions, classes, exports);
          break;

        case "function_declaration":
          this.extractFunction(node, undefined, functions, exports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walk = (node: TreeSitterNode) => {
      let pushedName = false;

      if (node.type === "function_declaration") {
        const name = firstIdentifier(node)?.text;
        if (name) {
          functionStack.push(name);
          pushedName = true;
        }
      }

      if (node.type === "call_expression" && functionStack.length > 0) {
        const callee = extractCallee(node);
        if (callee) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          walk(child);
        }
      }

      if (pushedName) {
        functionStack.pop();
      }
    };

    walk(rootNode);
    return entries;
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const qualified = directChild(node, "qualified_identifier");
    if (!qualified) {
      return;
    }

    const alias = directChildrenOfType(node, "identifier").at(-1)?.text;
    imports.push({
      source: qualified.text,
      specifiers: [alias ?? lastIdentifierText(qualified) ?? qualified.text],
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractClassLike(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = firstIdentifier(node);
    if (!nameNode) {
      return;
    }

    const methods: string[] = [];
    const properties: string[] = [];

    const primaryConstructor = directChild(node, "primary_constructor");
    if (primaryConstructor) {
      const parameters = descendantsOfType(primaryConstructor, "class_parameter");
      for (const param of parameters) {
        const name = extractPropertyName(param);
        if (name) {
          properties.push(name);
        }
      }
    }

    const body = directChild(node, "class_body");
    if (body) {
      for (const member of directChildren(body)) {
        if (member.type === "function_declaration") {
          this.extractFunction(member, methods, functions, exports);
        } else if (member.type === "property_declaration") {
          const name = extractPropertyName(member);
          if (name) {
            properties.push(name);
          }
        }
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    });

    if (isExported(node)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractFunction(
    node: TreeSitterNode,
    methods: string[] | undefined,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = firstIdentifier(node);
    if (!nameNode) {
      return;
    }

    const paramsNode = directChild(node, "function_value_parameters");
    const params = extractParams(paramsNode);
    const returnType = extractReturnType(node, paramsNode);

    methods?.push(nameNode.text);
    functions.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params,
      returnType,
    });

    if (isExported(node)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }
}
