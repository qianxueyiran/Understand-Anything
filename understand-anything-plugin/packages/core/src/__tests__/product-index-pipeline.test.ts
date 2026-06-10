import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../types.js";
import type { ProductBoundaryCandidate, TopicContextPack } from "../product-index-builder.js";
import {
  applyTopicNormalization,
  buildProductIndexTrace,
  validateProductExtractions,
  validateTopicNormalization,
} from "../product-index-pipeline.js";

const graph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "video-app",
    languages: ["java"],
    frameworks: ["Android"],
    description: "Video app",
    analyzedAt: "2026-05-20T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "class:BootBroadcastReceiver.java:BootBroadcastReceiver",
      type: "class",
      name: "BootBroadcastReceiver",
      filePath: "app/BootBroadcastReceiver.java",
      summary: "Receives boot broadcasts.",
      tags: ["receiver"],
      complexity: "simple",
      businessSignals: [{ type: "entry", text: "开机广播入口" }],
    },
  ],
  edges: [],
  layers: [],
  tour: [],
};

const candidate: ProductBoundaryCandidate = {
  id: "candidate:class:BootBroadcastReceiver.java:BootBroadcastReceiver",
  rootNodeId: "class:BootBroadcastReceiver.java:BootBroadcastReceiver",
  name: "BootBroadcastReceiver",
  entryKind: "receiver",
  filePath: "app/BootBroadcastReceiver.java",
  businessSignals: [{ type: "entry", text: "开机广播入口" }],
  neighborNodeIds: [],
  domainRefs: ["domain:startup"],
};

function validNormalization(): unknown {
  return {
    topics: [
      {
        id: "topic:boot-startup",
        name: "开机启动处理",
        summary: "系统开机广播触发应用初始化和首页数据准备。",
        kind: "capability",
        sourceCandidateIds: [candidate.id],
        rootNodeIds: [candidate.rootNodeId],
        domainRefs: [],
        confidence: "confirmed",
      },
    ],
    discardedCandidates: [],
    sourceReads: [],
    warnings: [],
  };
}

describe("product index strict pipeline", () => {
  it("validates topic normalization and applies candidate-backed merge metadata", () => {
    const result = validateTopicNormalization(validNormalization(), [candidate], graph);
    const topics = applyTopicNormalization(result.normalization, [candidate]);

    expect(result.warnings).toEqual([]);
    expect(topics).toEqual([
      {
        id: "topic:boot-startup",
        name: "开机启动处理",
        summary: "系统开机广播触发应用初始化和首页数据准备。",
        kind: "capability",
        sourceCandidateIds: [candidate.id],
        rootNodeIds: [candidate.rootNodeId],
        domainRefs: ["domain:startup"],
      },
    ]);
  });

  it("rejects invalid topic normalization top-level shape", () => {
    expect(() => validateTopicNormalization({ discardedCandidates: [] }, [candidate], graph)).toThrow(
      /product-topic-normalization\.json must contain a topics array/,
    );
  });

  it("turns invalid normalization references into warnings", () => {
    const result = validateTopicNormalization(
      {
        topics: [
          {
            id: "topic:BootBroadcastReceiver",
            name: "BootBroadcastReceiver",
            summary: "代码类。",
            kind: "capability",
            sourceCandidateIds: ["candidate:missing"],
            rootNodeIds: ["node:missing"],
            domainRefs: [],
            confidence: "confirmed",
          },
        ],
        discardedCandidates: [{ candidateId: "candidate:missing", reason: "重复" }],
        sourceReads: [],
        warnings: [],
      },
      [candidate],
      graph,
    );

    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "topic-name-looks-like-class",
        "topic-summary-too-short",
        "unknown-source-candidate",
        "unknown-root-node",
        "unknown-discarded-candidate",
        "candidate-used-and-discarded",
        "candidate-not-normalized",
      ]),
    );
  });

  it("validates extractions and warns for invalid evidence without blocking", () => {
    const pack: TopicContextPack = {
      topic: {
        id: "topic:boot-startup",
        name: "开机启动处理",
        summary: "系统开机广播触发应用初始化和首页数据准备。",
        kind: "capability",
        rootNodeIds: [candidate.rootNodeId],
        domainRefs: [],
      },
      candidateFiles: [
        {
          fileId: "file:app/BootBroadcastReceiver.java",
          filePath: "app/BootBroadcastReceiver.java",
          nodeSummaries: [],
          businessSignals: [],
          structuralReasons: [],
          anchors: [
            {
              anchorId: "anchor:function:BootBroadcastReceiver.java:onReceive:0",
              nodeId: candidate.rootNodeId,
              signalType: "entry",
              text: "接收开机广播并启动后续处理",
              snippetSummary: "开机广播处理",
            },
          ],
        },
      ],
    };

    const result = validateProductExtractions(
      [
        {
          topicId: "topic:boot-startup",
          sourceReads: [],
          usedFiles: [],
          ignoredFiles: [{ fileId: "file:app/BootBroadcastReceiver.java", reason: "误忽略" }],
          facts: [
            {
              type: "behavior",
              text: "BootBroadcastReceiver 调用 onReceive。",
              conditions: [],
              evidenceRefs: ["anchor:missing"],
              confidence: "confirmed",
            },
            {
              type: "behavior",
              text: "系统开机后应用会启动后续处理。",
              conditions: ["系统发出开机广播"],
              evidenceRefs: ["anchor:function:BootBroadcastReceiver.java:onReceive:0"],
              confidence: "confirmed",
            },
          ],
        },
      ],
      [pack],
    );

    expect(result.extractions).toHaveLength(1);
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "invalid-evidence-ref",
        "fact-text-looks-like-code",
        "used-files-missing-evidence-file",
      ]),
    );
  });

  it("coerces signal-only fact types such as entry before schema validation", () => {
    const pack: TopicContextPack = {
      topic: {
        id: "topic:boot-startup",
        name: "开机启动处理",
        summary: "系统开机广播触发应用初始化和首页数据准备。",
        kind: "capability",
        rootNodeIds: [candidate.rootNodeId],
        domainRefs: [],
      },
      candidateFiles: [
        {
          fileId: "file:app/BootBroadcastReceiver.java",
          filePath: "app/BootBroadcastReceiver.java",
          nodeSummaries: [],
          businessSignals: [],
          structuralReasons: [],
          anchors: [
            {
              anchorId: "anchor:function:BootBroadcastReceiver.java:onReceive:0",
              nodeId: candidate.rootNodeId,
              signalType: "entry",
              text: "开机广播入口",
              snippetSummary: "开机广播处理",
            },
          ],
        },
      ],
    };

    const result = validateProductExtractions(
      [
        {
          topicId: "topic:boot-startup",
          sourceReads: [],
          usedFiles: [{ fileId: "file:app/BootBroadcastReceiver.java", reason: "入口证据" }],
          ignoredFiles: [],
          facts: [
            {
              type: "entry",
              text: "系统开机广播会拉起应用启动处理。",
              conditions: [],
              evidenceRefs: ["anchor:function:BootBroadcastReceiver.java:onReceive:0"],
              confidence: "confirmed",
            },
          ],
          warnings: [],
        },
      ],
      [pack],
    );

    expect(result.extractions[0]?.facts[0]?.type).toBe("behavior");
    expect(result.warnings.map((warning) => warning.code)).toContain("fact-type-coerced-from-signal");
  });

  it("builds full strict trace", () => {
    const normalization = validateTopicNormalization(validNormalization(), [candidate], graph).normalization;
    const trace = buildProductIndexTrace({
      boundaryCandidates: [candidate],
      topicNormalization: normalization,
      contextPacks: [],
      extractions: [],
      warnings: [],
    });

    expect(trace.mode).toBe("llm-strict");
    expect(trace.boundaryCandidates).toHaveLength(1);
    expect(trace.topicNormalization).toBe(normalization);
    expect(trace.discardedCandidates).toEqual([]);
    expect(trace.ignoredFiles).toEqual([]);
    expect(trace.overflowFiles).toEqual([]);
  });
});
