import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("cold-start-workflow.py")


def load_workflow():
    spec = importlib.util.spec_from_file_location("cold_start_workflow", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ColdStartWorkflowTests(unittest.TestCase):
    def test_load_config_builds_ordered_commands(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            (root / "a_home_api").mkdir()
            (root / "a_player").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {
                    "version": 1,
                    "platform": "android",
                    "shards": [
                        {"id": "home", "scopes": ["a_home", "a_home_api"]},
                        {"id": "player", "scopes": ["a_player"]},
                    ],
                },
            )

            plan = workflow.load_config(root, config_path)

            self.assertEqual(plan["platform"], "android")
            self.assertEqual([shard["id"] for shard in plan["shards"]], ["home", "player"])
            self.assertEqual(
                [shard["scopeArg"] for shard in plan["shards"]],
                ["a_home,a_home_api", "a_player"],
            )
            self.assertEqual(
                plan["shards"][0]["understandCommand"],
                "/understand --scope a_home,a_home_api --shard home",
            )
            self.assertEqual(
                plan["shards"][0]["productCommand"],
                "/understand-product --shard home --platform android",
            )

    def test_load_config_rejects_invalid_or_duplicate_shards(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {
                    "version": 1,
                    "shards": [
                        {"id": "home", "scopes": ["a_home"]},
                        {"id": "home", "scopes": ["a_home"]},
                    ],
                },
            )

            with self.assertRaisesRegex(ValueError, "Duplicate shard id"):
                workflow.load_config(root, config_path)

            self.write_json(
                config_path,
                {
                    "version": 1,
                    "shards": [{"id": "../home", "scopes": ["a_home"]}],
                },
            )

            with self.assertRaisesRegex(ValueError, "Invalid shard id"):
                workflow.load_config(root, config_path)

    def test_load_config_rejects_missing_or_escaping_scope(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {
                    "version": 1,
                    "shards": [{"id": "home", "scopes": ["missing"]}],
                },
            )

            with self.assertRaisesRegex(ValueError, "Scope path does not exist"):
                workflow.load_config(root, config_path)

            outside = root.parent / f"{root.name}-outside"
            outside.mkdir()
            try:
                self.write_json(
                    config_path,
                    {
                        "version": 1,
                        "shards": [{"id": "outside", "scopes": [f"../{outside.name}"]}],
                    },
                )

                with self.assertRaisesRegex(ValueError, "outside project root"):
                    workflow.load_config(root, config_path)
            finally:
                outside.rmdir()

    def test_verify_outputs_checks_code_and_product_artifacts(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {"version": 1, "shards": [{"id": "home", "scopes": ["a_home"]}]},
            )
            plan = workflow.load_config(root, config_path)
            ua_dir = root / ".understand-anything"
            (ua_dir / "shards").mkdir(parents=True)
            (ua_dir / "product-shards").mkdir()
            (ua_dir / "product-traces").mkdir()

            self.write_json(
                ua_dir / "knowledge-graph.json",
                {
                    "kind": "codebase-sharded",
                    "shards": [{"id": "home", "path": "shards/home.json"}],
                },
            )
            self.write_json(
                ua_dir / "shards" / "home.json",
                {"shard": {"id": "home", "scopes": ["a_home"]}, "nodes": [], "edges": []},
            )
            self.write_json(
                ua_dir / "product-index.json",
                {
                    "kind": "product-sharded",
                    "shards": [
                        {
                            "id": "home",
                            "path": "product-shards/home.json",
                            "tracePath": "product-traces/home.json",
                            "sourceCodeShard": "shards/home.json",
                        }
                    ],
                },
            )
            self.write_json(ua_dir / "product-shards" / "home.json", {"topics": []})
            self.write_json(ua_dir / "product-traces" / "home.json", {"trace": []})

            report = workflow.verify_outputs(root, plan)

            self.assertTrue(report["ok"], report)
            self.assertEqual(report["checkedShardIds"], ["home"])
            self.assertEqual(report["errors"], [])

    def test_verify_outputs_reports_missing_artifacts(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {"version": 1, "shards": [{"id": "home", "scopes": ["a_home"]}]},
            )
            plan = workflow.load_config(root, config_path)

            report = workflow.verify_outputs(root, plan)

            self.assertFalse(report["ok"])
            self.assertTrue(
                any(".understand-anything/knowledge-graph.json" in error for error in report["errors"]),
                report,
            )
            self.assertTrue(
                any("product-shards/home.json" in error for error in report["errors"]),
                report,
            )

    def write_json(self, path, value):
        path.write_text(json.dumps(value), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
