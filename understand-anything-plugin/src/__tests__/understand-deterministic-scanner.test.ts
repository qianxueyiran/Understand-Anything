import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..", "..");
const scanProjectScript = join(pluginRoot, "skills", "understand", "scan-project.mjs");
const extractImportMapScript = join(
  pluginRoot,
  "skills",
  "understand",
  "extract-import-map.mjs",
);

function createScopedFixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "ua-deterministic-scanner-"));
  mkdirSync(join(projectRoot, "packages", "a", "src"), { recursive: true });
  mkdirSync(join(projectRoot, "packages", "b", "src"), { recursive: true });
  mkdirSync(join(projectRoot, ".understand-anything", "intermediate"), { recursive: true });
  writeFileSync(join(projectRoot, "README.md"), "# Fixture\n", "utf-8");
  writeFileSync(
    join(projectRoot, "packages", "a", "src", "a.ts"),
    "import '../../b/src/b';\nexport const a = 1;\n",
    "utf-8",
  );
  writeFileSync(
    join(projectRoot, "packages", "b", "src", "b.ts"),
    "export const b = 1;\n",
    "utf-8",
  );
  return projectRoot;
}

function runNode(args: string[]) {
  const result = spawnSync(process.execPath, args, {
    cwd: join(pluginRoot, ".."),
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${process.execPath} ${args.join(" ")}`,
        `stdout:\n${result.stdout}`,
        `stderr:\n${result.stderr}`,
      ].join("\n"),
    );
  }
  return result;
}

function runNodeAllowFailure(args: string[]) {
  return spawnSync(process.execPath, args, {
    cwd: join(pluginRoot, ".."),
    encoding: "utf-8",
  });
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("deterministic project scanner scripts", () => {
  it("scans scoped files while resolving imports against repository files", () => {
    const projectRoot = createScopedFixture();
    try {
      const scanOutput = join(
        projectRoot,
        ".understand-anything",
        "intermediate",
        "scan-files.json",
      );
      const importOutput = join(
        projectRoot,
        ".understand-anything",
        "intermediate",
        "import-map.json",
      );
      const repositoryOutput = join(
        projectRoot,
        ".understand-anything",
        "intermediate",
        "repository-files.json",
      );

      runNode([
        scanProjectScript,
        projectRoot,
        scanOutput,
        "--scope-json",
        '["packages/a"]',
        "--repository-output",
        repositoryOutput,
      ]);
      runNode([
        extractImportMapScript,
        scanOutput,
        importOutput,
        "--repository-input",
        repositoryOutput,
      ]);

      const scan = readJson(scanOutput);
      const repository = readJson(repositoryOutput);
      const imports = readJson(importOutput);

      expect(scan.files.map((file: { path: string }) => file.path)).toEqual([
        "packages/a/src/a.ts",
      ]);
      expect(scan.repositoryFiles).toBeUndefined();
      expect(repository.repositoryFiles.map((file: { path: string }) => file.path)).toEqual(
        expect.arrayContaining(["packages/a/src/a.ts", "packages/b/src/b.ts"]),
      );
      expect(Object.keys(imports.importMap)).toEqual(["packages/a/src/a.ts"]);
      expect(imports.importMap["packages/a/src/a.ts"]).toEqual([
        "packages/b/src/b.ts",
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("keeps no-scope scan input compatible with the import-map script", () => {
    const projectRoot = createScopedFixture();
    try {
      const scanOutput = join(
        projectRoot,
        ".understand-anything",
        "intermediate",
        "scan-files.json",
      );
      const importOutput = join(
        projectRoot,
        ".understand-anything",
        "intermediate",
        "import-map.json",
      );

      runNode([scanProjectScript, projectRoot, scanOutput]);
      runNode([extractImportMapScript, scanOutput, importOutput]);

      const scan = readJson(scanOutput);
      const imports = readJson(importOutput);
      const scannedPaths = scan.files.map((file: { path: string }) => file.path);

      expect(scan.repositoryFiles).toBeUndefined();
      expect(scannedPaths).toEqual(
        expect.arrayContaining(["packages/a/src/a.ts", "packages/b/src/b.ts"]),
      );
      expect(Object.keys(imports.importMap)).toEqual(
        expect.arrayContaining(["packages/a/src/a.ts", "packages/b/src/b.ts"]),
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("excludes local agent skill directories from scan files", () => {
    const projectRoot = createScopedFixture();
    try {
      mkdirSync(
        join(projectRoot, ".agents", "skills", "lark-doc", "references"),
        { recursive: true },
      );
      writeFileSync(
        join(
          projectRoot,
          ".agents",
          "skills",
          "lark-doc",
          "references",
          "lark-doc-update.md",
        ),
        "# local agent notes\n",
        "utf-8",
      );
      const scanOutput = join(
        projectRoot,
        ".understand-anything",
        "intermediate",
        "scan-files.json",
      );

      runNode([scanProjectScript, projectRoot, scanOutput]);

      const scan = readJson(scanOutput);
      expect(scan.files.map((file: { path: string }) => file.path)).not.toContain(
        ".agents/skills/lark-doc/references/lark-doc-update.md",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails instead of scanning the full repository when a required scope is empty", () => {
    const projectRoot = createScopedFixture();
    try {
      const scanOutput = join(
        projectRoot,
        ".understand-anything",
        "intermediate",
        "scan-files.json",
      );

      const result = runNodeAllowFailure([
        scanProjectScript,
        projectRoot,
        scanOutput,
        "--scope-json",
        "[]",
        "--require-scope",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--require-scope requires non-empty --scope-json");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

});
