import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("domain-shard-workflow.py")


def load_workflow():
    spec = importlib.util.spec_from_file_location("domain_shard_workflow", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DomainShardWorkflowTest(unittest.TestCase):
    def test_prepare_validates_sharded_root_and_returns_isolated_paths(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ua_dir = root / ".understand-anything"
            (ua_dir / "shards").mkdir(parents=True)
            (ua_dir / "knowledge-graph.json").write_text(
                json.dumps({"version": "1.0.0", "kind": "codebase-sharded"}),
                encoding="utf-8",
            )
            (ua_dir / "shards" / "home.json").write_text(
                json.dumps({"version": "1.0.0", "nodes": [], "edges": [], "layers": [], "tour": []}),
                encoding="utf-8",
            )

            result = workflow.prepare_domain_shard(root, "home")

            self.assertEqual(result["codeShardPath"], str(ua_dir / "shards" / "home.json"))
            self.assertEqual(
                result["intermediatePath"],
                str(ua_dir / "intermediate" / "domain-shards" / "home" / "domain-analysis.json"),
            )
            self.assertEqual(result["domainShardPath"], str(ua_dir / "domain-shards" / "home.json"))

    def test_prepare_rejects_unsharded_root(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ua_dir = root / ".understand-anything"
            ua_dir.mkdir(parents=True)
            (ua_dir / "knowledge-graph.json").write_text(
                json.dumps({"version": "1.0.0", "kind": "codebase", "nodes": []}),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "当前项目不是 sharded code graph"):
                workflow.prepare_domain_shard(root, "home")

    def test_finalize_writes_domain_shard_and_refreshes_manifest(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ua_dir = root / ".understand-anything"
            (ua_dir / "shards").mkdir(parents=True)
            (ua_dir / "intermediate" / "domain-shards" / "home").mkdir(parents=True)
            (ua_dir / "knowledge-graph.json").write_text(
                json.dumps({"version": "1.0.0", "kind": "codebase-sharded"}),
                encoding="utf-8",
            )
            (ua_dir / "shards" / "home.json").write_text(
                json.dumps({"version": "1.0.0", "nodes": [], "edges": [], "layers": [], "tour": []}),
                encoding="utf-8",
            )
            domain_graph = {
                "version": "1.0.0",
                "project": {
                    "name": "home",
                    "languages": [],
                    "frameworks": [],
                    "description": "home domain",
                    "analyzedAt": "2026-05-21T00:00:00.000Z",
                    "gitCommitHash": "abc123",
                },
                "nodes": [],
                "edges": [],
                "layers": [],
                "tour": [],
            }
            (ua_dir / "intermediate" / "domain-shards" / "home" / "domain-analysis.json").write_text(
                json.dumps(domain_graph),
                encoding="utf-8",
            )

            result = workflow.finalize_domain_shard(root, "home")

            saved_shard = json.loads((ua_dir / "domain-shards" / "home.json").read_text(encoding="utf-8"))
            manifest = json.loads((ua_dir / "domain-graph.json").read_text(encoding="utf-8"))
            self.assertEqual(saved_shard, domain_graph)
            self.assertEqual(result["domainShardPath"], str(ua_dir / "domain-shards" / "home.json"))
            self.assertEqual(manifest["kind"], "domain-sharded")
            self.assertEqual(manifest["shards"][0]["id"], "home")


if __name__ == "__main__":
    unittest.main()
