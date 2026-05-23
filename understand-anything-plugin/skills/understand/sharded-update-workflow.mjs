#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW_DIR = dirname(fileURLToPath(import.meta.url));
const MERGE_SCRIPT = join(WORKFLOW_DIR, "merge-batch-graphs.py");

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".cpp",
  ".c",
  ".h",
  ".cs",
  ".swift",
  ".php",
]);

const SYMBOL_NODE_TYPES = new Set(["function", "class"]);
const SYMBOL_EDGE_TYPES = new Set([
  "contains",
  "exports",
  "calls",
  "inherits",
  "implements",
]);

function stripSymbolGraph(nodes, edges) {
  const symbolIds = new Set(
    (nodes ?? [])
      .filter((node) => SYMBOL_NODE_TYPES.has(node?.type) && typeof node?.id === "string")
      .map((node) => node.id),
  );
  const keptNodes = (nodes ?? []).filter((node) => !SYMBOL_NODE_TYPES.has(node?.type));
  const keptEdges = (edges ?? []).filter(
    (edge) =>
      !SYMBOL_EDGE_TYPES.has(edge?.type)
      && !symbolIds.has(edge?.source)
      && !symbolIds.has(edge?.target),
  );
  return { nodes: keptNodes, edges: keptEdges };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function runGit(projectRoot, args) {
  return execFileSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf-8",
  }).trim();
}

function normalizeChangedFiles(files) {
  return [...new Set(files)].filter((filePath) => filePath && !filePath.startsWith(".understand-anything/"));
}

function isSourceFile(filePath) {
  return [...SOURCE_EXTENSIONS].some((extension) => filePath.endsWith(extension));
}

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function artifactHash(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function extractFingerprint(filePath, content) {
  const functions = [
    ...Array.from(content.matchAll(/(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gu)),
    ...Array.from(content.matchAll(/(?:public|private|protected|internal|suspend|inline|override|\s)*\bfun\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gu)),
  ].map((match) => ({
    name: match[1],
    params: match[2] ? match[2].split(",").map((item) => item.trim()).filter(Boolean) : [],
    exported: /^\s*export\b/mu.test(match[0]) || /\bpublic\b/u.test(match[0]),
    lineCount: 1,
  }));
  const classes = Array.from(
    content.matchAll(/\b(?:class|interface|object|enum\s+class)\s+([A-Za-z_]\w*)/gu),
  ).map((match) => ({
    name: match[1],
    methods: [],
    exported: /^\s*export\b/mu.test(match[0]) || /\bpublic\b/u.test(match[0]),
    lineCount: 1,
  }));
  const imports = Array.from(content.matchAll(/^\s*import\s+(.+)$/gmu)).map((match) => ({
    source: match[1].trim(),
    specifiers: [],
  }));
  const exports = Array.from(content.matchAll(/^\s*export\s+(?:\{([^}]+)\}|(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*))/gmu)).map((match) => ({
    name: (match[2] ?? match[1] ?? "").trim(),
  }));

  return {
    filePath,
    contentHash: contentHash(content),
    functions,
    classes,
    imports,
    exports,
    totalLines: content.split("\n").length,
    hasStructuralAnalysis: true,
  };
}

function classifyChangedFiles(projectRoot, changedFiles, fingerprintStore) {
  const structuralFiles = [];
  const deletedFiles = [];

  for (const filePath of changedFiles) {
    const absolutePath = join(projectRoot, filePath);
    const existedBefore = Object.prototype.hasOwnProperty.call(fingerprintStore.files, filePath);
    const existsNow = existsSync(absolutePath);

    if (!existsNow) {
      if (existedBefore) {
        deletedFiles.push(filePath);
      }
      continue;
    }

    if (!existedBefore) {
      structuralFiles.push(filePath);
      continue;
    }

    // Any file still present in the git diff is treated as structural (including comment-only edits).
    structuralFiles.push(filePath);
  }

  return { structuralFiles, deletedFiles };
}

function pruneGraphForChangedFiles(graph, structuralFiles, deletedFiles) {
  const changed = new Set([...structuralFiles, ...deletedFiles]);
  const removedNodeIds = new Set(
    (graph.nodes ?? [])
      .filter((node) => typeof node.filePath === "string" && changed.has(node.filePath))
      .map((node) => node.id),
  );
  const nodes = (graph.nodes ?? []).filter((node) => !removedNodeIds.has(node.id));
  const remainingNodeIds = new Set(nodes.map((node) => node.id));

  return omitLayersAndTour({
    ...graph,
    nodes,
    edges: (graph.edges ?? []).filter(
      (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
    ),
  });
}

function omitLayersAndTour(graph) {
  const next = { ...graph };
  delete next.layers;
  delete next.tour;
  return next;
}

function pruneMetadataNodeReferences(entries, remainingNodeIds) {
  if (!Array.isArray(entries)) {
    return entries;
  }

  return entries.flatMap((entry) => {
    const next = { ...entry };
    if (Array.isArray(entry.nodeIds)) {
      next.nodeIds = entry.nodeIds.filter((nodeId) => remainingNodeIds.has(nodeId));
      if (next.nodeIds.length === 0) {
        return [];
      }
    }
    if (typeof entry.nodeId === "string" && !remainingNodeIds.has(entry.nodeId)) {
      return [];
    }
    return [next];
  });
}

function buildBaselineFingerprint(projectRoot, shardId, shardGraph, headCommitHash) {
  const files = {};
  for (const node of shardGraph.nodes ?? []) {
    if (node.type !== "file" || typeof node.filePath !== "string") {
      continue;
    }
    const absolutePath = join(projectRoot, node.filePath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    files[node.filePath] = extractFingerprint(node.filePath, readFileSync(absolutePath, "utf-8"));
  }

  return {
    version: "1.0.0",
    shardId,
    gitCommitHash: headCommitHash,
    generatedAt: new Date().toISOString(),
    files,
  };
}

function matchChangedFilesToShard(filePath, shard, shardGraph) {
  if ((shard.scopes ?? []).some((scope) => filePath === scope || filePath.startsWith(`${scope}/`))) {
    return "changed file matched shard scope";
  }
  if ((shardGraph.nodes ?? []).some((node) => node.filePath === filePath)) {
    return "changed file matched existing shard node";
  }
  return undefined;
}

function buildShardedDiffPlan(projectRoot) {
  const uaDir = join(projectRoot, ".understand-anything");
  const manifestPath = join(uaDir, "knowledge-graph.json");
  const manifest = readJson(manifestPath);
  if (manifest.kind !== "codebase-sharded") {
    throw new Error("sharded-update-workflow plan requires kind: codebase-sharded");
  }

  const headCommitHash = runGit(projectRoot, ["rev-parse", "HEAD"]);
  const baseCommitHash = manifest.update?.gitCommitHash;
  const warnings = [];
  let requiresRerun = false;
  if (!baseCommitHash) {
    requiresRerun = true;
    warnings.push(
      "Initialized sharded update baseline; rerun /understand --update-diff to classify changes from this commit.",
    );
  }
  const changedFiles = baseCommitHash
    ? normalizeChangedFiles(
        runGit(projectRoot, ["diff", `${baseCommitHash}..${headCommitHash}`, "--name-only"])
          .split("\n"),
      )
    : [];

  const affectedByShard = new Map();
  const matchedFiles = new Set();

  for (const shard of manifest.shards ?? []) {
    const shardGraph = readJson(join(uaDir, shard.path));
    for (const filePath of changedFiles) {
      const reason = matchChangedFilesToShard(filePath, shard, shardGraph);
      if (!reason) {
        continue;
      }
      matchedFiles.add(filePath);
      if (!affectedByShard.has(shard.id)) {
        affectedByShard.set(shard.id, {
          id: shard.id,
          path: shard.path,
          scopes: shard.scopes ?? [],
          changedFiles: [],
          structuralFiles: [],
          deletedFiles: [],
          reason,
          shardGraph,
        });
      }
      affectedByShard.get(shard.id).changedFiles.push(filePath);
    }
  }

  const unmappedChangedFiles = changedFiles.filter(
    (filePath) => !matchedFiles.has(filePath) && isSourceFile(filePath),
  );
  for (const filePath of unmappedChangedFiles) {
    warnings.push(
      `${filePath} did not match any shard; add a shard or rerun /understand --scope ... --shard ...`,
    );
  }

  const affectedCodeShards = [];
  for (const shard of affectedByShard.values()) {
    const fingerprintPath = join(uaDir, "fingerprints", "shards", `${shard.id}.json`);
    if (!existsSync(fingerprintPath)) {
      const baseline = buildBaselineFingerprint(projectRoot, shard.id, shard.shardGraph, headCommitHash);
      writeJson(fingerprintPath, baseline);
      requiresRerun = true;
      warnings.push(
        `Created shard fingerprint baseline for ${shard.id}; rerun update-diff after this baseline to classify file changes.`,
      );
      affectedCodeShards.push({
        id: shard.id,
        path: shard.path,
        scopes: shard.scopes,
        changedFiles: shard.changedFiles,
        structuralFiles: [],
        deletedFiles: [],
        reason: shard.reason,
      });
      continue;
    }

    const classification = classifyChangedFiles(projectRoot, shard.changedFiles, readJson(fingerprintPath));
    affectedCodeShards.push({
      id: shard.id,
      path: shard.path,
      scopes: shard.scopes,
      changedFiles: shard.changedFiles,
      structuralFiles: classification.structuralFiles,
      deletedFiles: classification.deletedFiles,
      reason: shard.reason,
    });
  }

  const plan = {
    baseCommitHash,
    headCommitHash,
    changedFiles,
    affectedCodeShards,
    unmappedChangedFiles,
    warnings,
    requiresRerun,
  };
  return plan;
}

function buildRunId(headCommitHash) {
  return `${new Date().toISOString()}-${headCommitHash.slice(0, 12)}`;
}

function statusForShard(shard) {
  if ((shard.structuralFiles ?? []).length > 0) {
    return "needs-file-analysis";
  }
  if ((shard.deletedFiles ?? []).length > 0) {
    return "deleted-only";
  }
  return "noop";
}

function toRunRecord(plan) {
  const runId = buildRunId(plan.headCommitHash);
  const blocked = plan.requiresRerun === true;
  return {
    version: "1.0.0",
    runId,
    baseCommitHash: plan.baseCommitHash,
    headCommitHash: plan.headCommitHash,
    status: blocked ? "blocked" : "ready",
    changedFiles: plan.changedFiles,
    unmappedChangedFiles: plan.unmappedChangedFiles ?? [],
    shards: (plan.affectedCodeShards ?? []).map((shard) => ({
      ...shard,
      status: blocked ? "blocked" : statusForShard(shard),
      requiredOutputs: {
        fileAnalyzerBatches:
          (shard.structuralFiles ?? []).length > 0
            ? [`intermediate/sharded/${shard.id}/batch-001.json`]
            : [],
        candidateShard: `intermediate/sharded/${shard.id}/candidate-shard.json`,
        assembleResult: `intermediate/sharded/${shard.id}/assemble-result.json`,
      },
    })),
    warnings: plan.warnings ?? [],
  };
}

function plan(projectRoot) {
  const uaDir = join(projectRoot, ".understand-anything");
  const updatePlan = buildShardedDiffPlan(projectRoot);
  writeJson(join(uaDir, "intermediate", "sharded-update-run.json"), toRunRecord(updatePlan));
}

function readRun(projectRoot) {
  return readJson(join(projectRoot, ".understand-anything", "intermediate", "sharded-update-run.json"));
}

function findRunShard(run, shardId) {
  const shard = (run.shards ?? []).find((candidate) => candidate.id === shardId);
  if (!shard) {
    throw new Error(`Shard ${shardId} is not present in sharded update run`);
  }
  return shard;
}

function isCurrentRunArtifact(value, run, shardId) {
  return value?.runId === run.runId && value?.headCommitHash === run.headCommitHash && value?.shardId === shardId;
}

function writeAssembleResult(projectRoot, shardId, result) {
  writeJson(join(projectRoot, ".understand-anything", "intermediate", "sharded", shardId, "assemble-result.json"), result);
}

function failAssemble(projectRoot, run, shardId, warning) {
  writeAssembleResult(projectRoot, shardId, {
    runId: run.runId,
    headCommitHash: run.headCommitHash,
    shardId,
    status: "failed",
    warning,
  });
}

function mergeRetainedGraphWithBatches(retainedGraph, batches) {
  const nodesById = new Map();
  const edgesByKey = new Map();

  const addNode = (node) => {
    if (!node?.id) {
      return;
    }
    nodesById.set(node.id, node);
  };

  const addEdge = (edge) => {
    const key = `${edge?.source ?? ""}\0${edge?.target ?? ""}\0${edge?.type ?? ""}\0${edge?.direction ?? ""}`;
    const previous = edgesByKey.get(key);
    if (!previous || Number(edge?.weight ?? 0) > Number(previous.weight ?? 0)) {
      edgesByKey.set(key, edge);
    }
  };

  for (const node of retainedGraph.nodes ?? []) {
    addNode(node);
  }
  for (const edge of retainedGraph.edges ?? []) {
    addEdge(edge);
  }

  for (const batch of batches) {
    for (const node of batch.nodes ?? []) {
      addNode(node);
    }
    for (const edge of batch.edges ?? []) {
      addEdge(edge);
    }
  }

  const merged = omitLayersAndTour({
    ...retainedGraph,
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
  });
  const stripped = stripSymbolGraph(merged.nodes, merged.edges);
  return omitLayersAndTour({
    ...merged,
    nodes: stripped.nodes,
    edges: stripped.edges,
  });
}

function getFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function assembleShard(projectRoot, args) {
  const shardId = getFlagValue(args, "--shard");
  if (!shardId) {
    throw new Error("assemble-shard requires --shard <id>");
  }

  const uaDir = join(projectRoot, ".understand-anything");
  const run = readRun(projectRoot);
  const shard = findRunShard(run, shardId);
  if (shard.status === "deleted-only") {
    const oldGraph = readJson(join(uaDir, shard.path));
    const candidate = omitLayersAndTour({
      ...pruneGraphForChangedFiles(oldGraph, [], shard.deletedFiles ?? []),
      runId: run.runId,
      headCommitHash: run.headCommitHash,
      shardId,
    });
    const candidatePath = shard.requiredOutputs?.candidateShard ?? `intermediate/sharded/${shardId}/candidate-shard.json`;
    const candidateAbsPath = join(uaDir, candidatePath);
    writeJson(candidateAbsPath, candidate);
    runShardImportRecovery(projectRoot, candidateAbsPath);
    writeAssembleResult(projectRoot, shardId, {
      runId: run.runId,
      headCommitHash: run.headCommitHash,
      shardId,
      status: "success",
      candidatePath,
    });
    return;
  }

  const batches = [];
  for (const batchPath of shard.requiredOutputs?.fileAnalyzerBatches ?? []) {
    const absolutePath = join(projectRoot, ".understand-anything", batchPath);
    if (!existsSync(absolutePath)) {
      failAssemble(projectRoot, run, shardId, `${batchPath} is missing`);
      return;
    }

    const batch = readJson(absolutePath);
    if (!isCurrentRunArtifact(batch, run, shardId)) {
      failAssemble(
        projectRoot,
        run,
        shardId,
        `${batchPath} does not belong to this sharded update run`,
      );
      return;
    }
    if (batch.status !== undefined && batch.status !== "success") {
      failAssemble(
        projectRoot,
        run,
        shardId,
        `${batchPath} ${batch.status}: ${batch.warning ?? "unknown status"}`,
      );
      return;
    }
    batches.push(batch);
  }

  const oldGraph = readJson(join(uaDir, shard.path));
  const retainedGraph = pruneGraphForChangedFiles(
    oldGraph,
    shard.structuralFiles ?? [],
    shard.deletedFiles ?? [],
  );
  const candidate = {
    ...mergeRetainedGraphWithBatches(retainedGraph, batches),
    runId: run.runId,
    headCommitHash: run.headCommitHash,
    shardId,
  };
  const candidatePath = shard.requiredOutputs?.candidateShard ?? `intermediate/sharded/${shardId}/candidate-shard.json`;
  const candidateAbsPath = join(uaDir, candidatePath);
  writeJson(candidateAbsPath, candidate);
  runShardImportRecovery(projectRoot, candidateAbsPath);
  writeAssembleResult(projectRoot, shardId, {
    runId: run.runId,
    headCommitHash: run.headCommitHash,
    shardId,
    status: "success",
    candidatePath,
  });
}

function buildShardFingerprintStore(projectRoot, shardId, graph, gitCommitHash) {
  const files = {};
  for (const node of graph.nodes ?? []) {
    if (node.type !== "file" || typeof node.filePath !== "string") {
      continue;
    }
    const absolutePath = join(projectRoot, node.filePath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    files[node.filePath] = extractFingerprint(node.filePath, readFileSync(absolutePath, "utf-8"));
  }

  return {
    version: "1.0.0",
    shardId,
    gitCommitHash,
    generatedAt: new Date().toISOString(),
    files,
  };
}

function planDownstream(projectRoot, manifest, previousShardUpdates, codeShards, plan, args, warnings) {
  const uaDir = join(projectRoot, ".understand-anything");
  const requested = {
    domain: hasFlag(args, "--with-domain"),
    product: hasFlag(args, "--with-product"),
  };
  const changedCodeShards = codeShards.filter((shard) => {
    const previousHash = previousShardUpdates[shard.id]?.artifactHash;
    const nextHash = manifest.update?.shards?.[shard.id]?.artifactHash;
    return nextHash && previousHash !== nextHash;
  }).map((shard) => shard.id);

  const downstreamPlan = {
    runId: plan.runId,
    baseCommitHash: plan.baseCommitHash,
    headCommitHash: plan.headCommitHash,
    requested,
    changedCodeShards,
    domainShardsToRebuild: [],
    productShardsToRebuild: [],
    warnings,
  };

  if (requested.domain) {
    const domainManifestPath = join(uaDir, "domain-graph.json");
    if (!existsSync(domainManifestPath)) {
      warnings.push("domain-graph.json is missing; skipped requested domain follow-up");
    } else {
      const domainManifest = readJson(domainManifestPath);
      if (domainManifest.kind !== "domain-sharded") {
        warnings.push("domain-graph.json is not domain-sharded; skipped requested domain follow-up");
      } else {
        const domainShardIds = new Set((domainManifest.shards ?? []).map((shard) => shard.id));
        downstreamPlan.domainShardsToRebuild = changedCodeShards.filter((id) => domainShardIds.has(id));
      }
    }
  }

  if (requested.product) {
    const productManifestPath = join(uaDir, "product-index.json");
    if (!existsSync(productManifestPath)) {
      warnings.push("product-index.json is missing; skipped requested product follow-up");
    } else {
      const productManifest = readJson(productManifestPath);
      if (productManifest.kind !== "product-sharded") {
        warnings.push("product-index.json is not product-sharded; skipped requested product follow-up");
      } else {
        const productShardIds = new Set((productManifest.shards ?? []).map((shard) => shard.id));
        downstreamPlan.productShardsToRebuild = changedCodeShards.filter((id) => productShardIds.has(id));
      }
    }
  }

  writeJson(join(uaDir, "intermediate", "sharded-downstream-plan.json"), downstreamPlan);
  return requested.domain || requested.product;
}

function requestedDownstreamShardIds(run, type, args, downstreamPlan) {
  if (!hasFlag(args, `--with-${type}`)) {
    return undefined;
  }

  const key = `${type}ShardsToRebuild`;
  const downstream = run.downstream ?? {};
  const section = downstream[type] ?? {};
  const requested = section.requested === true || downstream.requested?.[type] === true || run.requested?.[type] === true;
  const shardsToRebuild =
    section.shardsToRebuild ??
    section[key] ??
    downstream[key] ??
    run[key] ??
    [];

  if (!requested && shardsToRebuild.length === 0) {
    const planRequested = downstreamPlan?.requested?.[type] === true;
    const planShardsToRebuild = downstreamPlan?.[key] ?? [];
    if (!planRequested && planShardsToRebuild.length === 0) {
      return undefined;
    }
    return planShardsToRebuild;
  }
  return shardsToRebuild;
}

function readCurrentDownstreamPlan(projectRoot, run, warnings) {
  const planPath = join(projectRoot, ".understand-anything", "intermediate", "sharded-downstream-plan.json");
  if (!existsSync(planPath)) {
    return undefined;
  }

  const plan = readJson(planPath);
  if (
    plan.runId !== run.runId ||
    plan.baseCommitHash !== run.baseCommitHash ||
    plan.headCommitHash !== run.headCommitHash
  ) {
    appendWarning(warnings, "sharded downstream plan does not belong to this sharded update run");
    return { rejected: true };
  }
  return { plan, rejected: false };
}

function validateDownstreamResult(projectRoot, run, type, shardId, warnings) {
  const resultPath = join(
    projectRoot,
    ".understand-anything",
    "intermediate",
    `${type}-shards`,
    shardId,
    `${type}-update-result.json`,
  );
  if (!existsSync(resultPath)) {
    appendWarning(warnings, `${shardId} ${type} rebuild result is missing for current run`);
    return undefined;
  }

  const result = readJson(resultPath);
  if (!isCurrentRunArtifact(result, run, shardId)) {
    appendWarning(warnings, `${shardId} ${type} rebuild result does not belong to this sharded update run`);
    return undefined;
  }
  if (result.status !== "success") {
    appendWarning(
      warnings,
      `${shardId} ${type} rebuild result failed: ${result.warning ?? result.status ?? "unknown status"}`,
    );
    return undefined;
  }
  if (!result.artifactHash) {
    appendWarning(warnings, `${shardId} ${type} rebuild result is missing artifactHash`);
    return undefined;
  }
  return result;
}

function validateDownstreamCommit(projectRoot, run, args, warnings) {
  if (!hasFlag(args, "--with-domain") && !hasFlag(args, "--with-product")) {
    return undefined;
  }

  const planRequest = readCurrentDownstreamPlan(projectRoot, run, warnings);
  if (planRequest?.rejected) {
    return {
      requested: { domain: [], product: [] },
      results: { domain: new Map(), product: new Map() },
      rejected: true,
    };
  }
  const requested = {
    domain: requestedDownstreamShardIds(run, "domain", args, planRequest?.plan),
    product: requestedDownstreamShardIds(run, "product", args, planRequest?.plan),
  };
  if (!requested.domain && !requested.product) {
    return undefined;
  }

  const results = { domain: new Map(), product: new Map() };
  let rejected = false;
  for (const shardId of requested.domain ?? []) {
    const result = validateDownstreamResult(projectRoot, run, "domain", shardId, warnings);
    if (!result) {
      rejected = true;
    } else {
      results.domain.set(shardId, result);
    }
  }
  for (const shardId of requested.product ?? []) {
    const result = validateDownstreamResult(projectRoot, run, "product", shardId, warnings);
    if (!result) {
      rejected = true;
    } else {
      results.product.set(shardId, result);
    }
  }

  return { requested, results, rejected };
}

function writeValidatedDownstreamMetadata(projectRoot, codeManifest, downstreamCommit, now, warnings) {
  const uaDir = join(projectRoot, ".understand-anything");
  let domainManifest;

  if (downstreamCommit.requested.domain) {
    const domainManifestPath = join(uaDir, "domain-graph.json");
    domainManifest = readJson(domainManifestPath);
    const domainShards = { ...(domainManifest.update?.shards ?? {}) };

    for (const shardId of downstreamCommit.requested.domain) {
      const result = downstreamCommit.results.domain.get(shardId);
      const update = {
        ...domainShards[shardId],
        artifactHash: result.artifactHash,
        sourceCodeArtifactHash: codeManifest.update?.shards?.[shardId]?.artifactHash,
        lastRebuiltAt: now,
      };
      if (result.traceArtifactHash) {
        update.traceArtifactHash = result.traceArtifactHash;
      }
      domainShards[shardId] = update;
    }

    domainManifest.update = {
      updatedAt: now,
      shards: domainShards,
      warnings,
    };
    writeJson(domainManifestPath, domainManifest);
  }

  if (downstreamCommit.requested.product) {
    const productManifestPath = join(uaDir, "product-index.json");
    const productManifest = readJson(productManifestPath);
    const needsDomainMetadata = (productManifest.shards ?? []).some((shard) => shard.sourceDomainShard);
    if (!domainManifest && needsDomainMetadata) {
      const domainManifestPath = join(uaDir, "domain-graph.json");
      if (existsSync(domainManifestPath)) {
        domainManifest = readJson(domainManifestPath);
      }
    }
    const productShards = { ...(productManifest.update?.shards ?? {}) };

    for (const shardId of downstreamCommit.requested.product) {
      const shard = (productManifest.shards ?? []).find((candidate) => candidate.id === shardId);
      const result = downstreamCommit.results.product.get(shardId);
      const domainShard = (domainManifest?.shards ?? []).find((candidate) =>
        candidate.id === shardId || (shard?.sourceDomainShard && candidate.path === shard.sourceDomainShard),
      );
      const sourceDomainArtifactHash =
        domainManifest?.update?.shards?.[domainShard?.id ?? shardId]?.artifactHash ??
        productShards[shardId]?.sourceDomainArtifactHash;
      const update = {
        ...productShards[shardId],
        artifactHash: result.artifactHash,
        sourceCodeArtifactHash: codeManifest.update?.shards?.[shardId]?.artifactHash,
        lastRebuiltAt: now,
      };
      if (sourceDomainArtifactHash) {
        update.sourceDomainArtifactHash = sourceDomainArtifactHash;
      }
      if (result.traceArtifactHash) {
        update.traceArtifactHash = result.traceArtifactHash;
      }
      productShards[shardId] = update;
    }

    productManifest.update = {
      updatedAt: now,
      shards: productShards,
      warnings,
    };
    writeJson(productManifestPath, productManifest);
  }
}

function refreshCodeManifestSummary(uaDir, manifest, warnings) {
  let nodeCount = 0;
  let edgeCount = 0;
  const refreshedShards = [];

  for (const shard of manifest.shards ?? []) {
    const shardPath = join(uaDir, shard.path);
    if (!existsSync(shardPath)) {
      warnings.push(`${shard.path} is missing; manifest summary kept stale for ${shard.id}`);
      refreshedShards.push(shard);
      continue;
    }

    const graph = readJson(shardPath);
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    nodeCount += nodes.length;
    edgeCount += edges.length;
    refreshedShards.push({
      ...shard,
      scopes: Array.isArray(graph.shard?.scopes) ? graph.shard.scopes : shard.scopes,
      updatedAt: graph.shard?.updatedAt ?? graph.project?.analyzedAt ?? shard.updatedAt,
      gitCommitHash: graph.shard?.gitCommitHash ?? graph.project?.gitCommitHash ?? shard.gitCommitHash,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    });
  }

  manifest.shards = refreshedShards;
  manifest.overview = {
    ...(manifest.overview ?? {}),
    summary: `Sharded codebase manifest with ${refreshedShards.length} shards, ${nodeCount} nodes, and ${edgeCount} edges.`,
    nodeCount,
    edgeCount,
    shardCount: refreshedShards.length,
  };
}

function appendWarning(warnings, warning) {
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}

function stripTransientShardMetadata(candidate) {
  const { runId, headCommitHash, shardId, ...graph } = candidate;
  return omitLayersAndTour(graph);
}

function isShardExternalImportEdge(edge, nodeIds) {
  if (edge?.external !== true) {
    return false;
  }
  if (!nodeIds.has(edge.source)) {
    return false;
  }
  return typeof edge.target === "string" && edge.target.startsWith("file:");
}

function isDanglingShardEdge(edge, nodeIds) {
  if (isShardExternalImportEdge(edge, nodeIds)) {
    return false;
  }
  return !nodeIds.has(edge.source) || !nodeIds.has(edge.target);
}

function runShardImportRecovery(projectRoot, candidateAbsPath) {
  execFileSync(
    "python3",
    [MERGE_SCRIPT, projectRoot, "--import-recovery-only", "--graph", candidateAbsPath],
    { encoding: "utf-8" },
  );
}

function validatePublishedShardGraph(shardId, graph) {
  const warnings = [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));

  for (const edge of graph.edges ?? []) {
    if (isDanglingShardEdge(edge, nodeIds)) {
      warnings.push(`${shardId} published shard has dangling edge ${edge.source} -> ${edge.target}`);
    }
  }

  if ("layers" in graph) {
    warnings.push(`${shardId} published shard must not include layers`);
  }
  if ("tour" in graph) {
    warnings.push(`${shardId} published shard must not include tour`);
  }

  for (const node of nodes) {
    if (SYMBOL_NODE_TYPES.has(node.type)) {
      warnings.push(`${shardId} published shard has symbol node ${node.id} (type: ${node.type})`);
    }
  }

  return warnings;
}

function collectPublishedShardWarnings(manifest, uaDir) {
  const warnings = [];
  for (const shard of manifest.shards ?? []) {
    const shardPath = join(uaDir, shard.path);
    if (!existsSync(shardPath)) {
      warnings.push(`${shard.id} shard artifact is missing at ${shard.path}`);
      continue;
    }
    const graph = readJson(shardPath);
    for (const warning of validatePublishedShardGraph(shard.id, graph)) {
      appendWarning(warnings, warning);
    }
  }
  return warnings;
}

function reconcileManifestWarnings(projectRoot) {
  const uaDir = join(projectRoot, ".understand-anything");
  const manifestPath = join(uaDir, "knowledge-graph.json");
  const manifest = readJson(manifestPath);
  const warnings = [...(manifest.warnings ?? [])];
  const publishedWarnings = collectPublishedShardWarnings(manifest, uaDir);
  manifest.update = {
    ...(manifest.update ?? {}),
    updatedAt: new Date().toISOString(),
    warnings: publishedWarnings,
  };
  refreshCodeManifestSummary(uaDir, manifest, publishedWarnings);
  writeJson(manifestPath, manifest);
  return publishedWarnings;
}

function collectCandidateContentWarnings(runShard, candidate) {
  const warnings = [];
  const nodes = Array.isArray(candidate.nodes) ? candidate.nodes : [];
  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));

  for (const filePath of runShard.structuralFiles ?? []) {
    if (!nodes.some((node) => node.type === "file" && node.filePath === filePath)) {
      warnings.push(`${runShard.id} candidate is missing structural file ${filePath}`);
    }
  }

  for (const filePath of runShard.deletedFiles ?? []) {
    if (nodes.some((node) => node.filePath === filePath)) {
      warnings.push(`${runShard.id} candidate still contains deleted file ${filePath}`);
    }
  }

  for (const edge of candidate.edges ?? []) {
    if (isDanglingShardEdge(edge, nodeIds)) {
      warnings.push(`${runShard.id} candidate has dangling edge ${edge.source} -> ${edge.target}`);
    }
  }

  return warnings;
}

function commitShardedUpdate(projectRoot, args = []) {
  const uaDir = join(projectRoot, ".understand-anything");
  const manifestPath = join(uaDir, "knowledge-graph.json");
  const manifest = readJson(manifestPath);
  const run = readRun(projectRoot);
  const warnings = [...(manifest.update?.warnings ?? [])];
  const now = new Date().toISOString();
  const previousGitCommitHash = manifest.update?.gitCommitHash ?? run.baseCommitHash;
  const previousShardUpdates = { ...(manifest.update?.shards ?? {}) };
  const nextShardUpdates = { ...previousShardUpdates };
  const pendingWrites = [];
  const successfulCodeShards = [];
  let rejected = false;

  if (run.status !== "ready") {
    appendWarning(warnings, "sharded update run is blocked");
    manifest.update = {
      ...(manifest.update ?? {}),
      gitCommitHash: previousGitCommitHash,
      updatedAt: now,
      warnings,
    };
    writeJson(manifestPath, manifest);
    return;
  }

  for (const runShard of run.shards ?? []) {
    if (runShard.status === "noop") {
      continue;
    }

    const assembleResultPath = join(
      uaDir,
      runShard.requiredOutputs?.assembleResult ?? `intermediate/sharded/${runShard.id}/assemble-result.json`,
    );
    if (!existsSync(assembleResultPath)) {
      rejected = true;
      appendWarning(warnings, `${runShard.id} assemble result is missing`);
      continue;
    }

    const assembleResult = readJson(assembleResultPath);
    if (!isCurrentRunArtifact(assembleResult, run, runShard.id)) {
      rejected = true;
      appendWarning(warnings, `${runShard.id} assemble result does not belong to this sharded update run`);
      continue;
    }
    const shardPath = join(uaDir, runShard.path);
    if (assembleResult.status !== "success") {
      rejected = true;
      appendWarning(
        warnings,
        `${runShard.id} assemble result failed: ${assembleResult.warning ?? assembleResult.status ?? "unknown status"}`,
      );
      continue;
    }

    const requiredCandidatePath = runShard.requiredOutputs?.candidateShard;
    if (requiredCandidatePath && assembleResult.candidatePath !== requiredCandidatePath) {
      rejected = true;
      appendWarning(warnings, `${runShard.id} assemble result candidate path does not match required output`);
      if (!assembleResult.candidatePath || !existsSync(join(uaDir, assembleResult.candidatePath))) {
        appendWarning(warnings, `${runShard.id} candidate shard is missing`);
      }
      continue;
    }

    const candidatePath = assembleResult.candidatePath ?? requiredCandidatePath;
    if (!candidatePath || !existsSync(join(uaDir, candidatePath))) {
      rejected = true;
      appendWarning(warnings, `${runShard.id} candidate shard is missing`);
      continue;
    }

    const candidate = readJson(join(uaDir, candidatePath));
    if (!isCurrentRunArtifact(candidate, run, runShard.id)) {
      rejected = true;
      appendWarning(warnings, `${runShard.id} candidate shard does not belong to this sharded update run`);
      continue;
    }

    omitLayersAndTour(candidate);

    const contentWarnings =
      (runShard.structuralFiles ?? []).length > 0 || (runShard.deletedFiles ?? []).length > 0
        ? collectCandidateContentWarnings(runShard, candidate)
        : [];
    if (contentWarnings.length > 0) {
      rejected = true;
      for (const warning of contentWarnings) {
        appendWarning(warnings, warning);
      }
      continue;
    }

    const finalGraph = stripTransientShardMetadata(candidate);
    const stripped = stripSymbolGraph(finalGraph.nodes, finalGraph.edges);
    finalGraph.nodes = stripped.nodes;
    finalGraph.edges = stripped.edges;
    pendingWrites.push(() => {
      writeJson(shardPath, finalGraph);
      writeJson(
        join(uaDir, "fingerprints", "shards", `${runShard.id}.json`),
        buildShardFingerprintStore(projectRoot, runShard.id, finalGraph, run.headCommitHash),
      );
      writeJson(join(uaDir, "intermediate", "sharded", runShard.id, "code-update-result.json"), {
        runId: run.runId,
        headCommitHash: run.headCommitHash,
        shardId: runShard.id,
        status: "success",
        artifactHash: artifactHash(shardPath),
      });
    });
    nextShardUpdates[runShard.id] = {
      ...nextShardUpdates[runShard.id],
      fingerprintPath: nextShardUpdates[runShard.id]?.fingerprintPath ?? `fingerprints/shards/${runShard.id}.json`,
      lastPatchedAt: now,
    };
    successfulCodeShards.push(runShard);
  }

  if (rejected) {
    manifest.update = {
      ...(manifest.update ?? {}),
      gitCommitHash: previousGitCommitHash,
      updatedAt: now,
      warnings,
    };
    writeJson(manifestPath, manifest);
    return;
  }

  for (const writePendingArtifact of pendingWrites) {
    writePendingArtifact();
  }

  for (const runShard of successfulCodeShards) {
    nextShardUpdates[runShard.id] = {
      ...nextShardUpdates[runShard.id],
      artifactHash: artifactHash(join(uaDir, runShard.path)),
      fingerprintPath: nextShardUpdates[runShard.id]?.fingerprintPath ?? `fingerprints/shards/${runShard.id}.json`,
      lastPatchedAt: now,
    };
  }

  const downstreamCommit = validateDownstreamCommit(projectRoot, run, args, warnings);
  const finalWarnings = [...warnings];
  for (const publishedWarning of collectPublishedShardWarnings(manifest, uaDir)) {
    appendWarning(finalWarnings, publishedWarning);
  }
  manifest.update = {
    gitCommitHash: downstreamCommit?.rejected ? previousGitCommitHash : run.headCommitHash,
    updatedAt: now,
    shards: nextShardUpdates,
    warnings: finalWarnings,
  };
  refreshCodeManifestSummary(uaDir, manifest, finalWarnings);
  if (downstreamCommit) {
    if (!downstreamCommit.rejected) {
      writeValidatedDownstreamMetadata(projectRoot, manifest, downstreamCommit, now, warnings);
    }
  } else {
    const hasRequestedDownstream = planDownstream(
      projectRoot,
      manifest,
      previousShardUpdates,
      successfulCodeShards,
      {
        runId: run.runId,
        baseCommitHash: run.baseCommitHash,
        headCommitHash: run.headCommitHash,
        warnings: run.warnings ?? [],
      },
      args,
      warnings,
    );
    if (hasRequestedDownstream) {
      manifest.update.gitCommitHash = previousGitCommitHash;
    }
  }
  writeJson(manifestPath, manifest);
}

const REMOVED_COMMANDS = {
  prepare: "plan",
  "write-batch-existing": "assemble-shard",
  "finalize-code": "assemble-shard and commit",
  "finalize-manifest": "commit",
  "finalize-downstream": "commit --with-domain/--with-product",
};

function main() {
  const [, , projectRoot, command, ...args] = process.argv;
  if (!projectRoot || !command) {
    process.stderr.write(
      "Usage: node sharded-update-workflow.mjs <project-root> <plan|assemble-shard|commit|reconcile-warnings>\n",
    );
    process.exit(2);
  }

  if (command in REMOVED_COMMANDS) {
    process.stderr.write(
      `Removed sharded update workflow command: ${command} (use ${REMOVED_COMMANDS[command]})\n`,
    );
    process.exit(2);
  }

  if (command === "plan") {
    plan(projectRoot);
    return;
  }

  if (command === "assemble-shard") {
    assembleShard(projectRoot, args);
    return;
  }

  if (command === "commit") {
    commitShardedUpdate(projectRoot, args);
    return;
  }

  if (command === "reconcile-warnings") {
    const warnings = reconcileManifestWarnings(projectRoot);
    process.stdout.write(`${JSON.stringify({ warnings }, null, 2)}\n`);
    return;
  }

  process.stderr.write(`Unknown sharded update workflow command: ${command}\n`);
  process.exit(2);
}

main();
