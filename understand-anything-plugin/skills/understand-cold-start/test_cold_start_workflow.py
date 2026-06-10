import importlib
import importlib.util
import json
import sys
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

    def test_main_creates_report_parent_directory(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {"version": 1, "shards": [{"id": "home", "scopes": ["a_home"]}]},
            )
            report_path = root / ".understand-anything" / "cold-start-plan.json"

            exit_code = workflow.main(
                ["cold-start-workflow.py", "plan", str(root), str(config_path), str(report_path)]
            )

            self.assertEqual(exit_code, 0)
            self.assertTrue(report_path.exists())

    def test_main_supports_run_state_commands(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {"version": 1, "shards": [{"id": "home", "scopes": ["a_home"]}]},
            )
            run_path = root / ".understand-anything" / "cold-start-run.json"
            next_path = root / ".understand-anything" / "cold-start-next.json"

            self.assertEqual(
                workflow.main(["cold-start-workflow.py", "init", str(root), str(config_path), str(run_path)]),
                0,
            )
            self.assertTrue(run_path.exists())
            self.assertEqual(
                workflow.main(
                    [
                        "cold-start-workflow.py",
                        "next",
                        str(root),
                        str(config_path),
                        str(run_path),
                        str(next_path),
                    ]
                ),
                0,
            )
            action = json.loads(next_path.read_text(encoding="utf-8"))
            self.assertEqual(action["action"], "run-code-shard")

            self.assertEqual(
                workflow.main(
                    [
                        "cold-start-workflow.py",
                        "mark-start",
                        str(root),
                        str(config_path),
                        str(run_path),
                        "code",
                        "home",
                        "scan",
                    ]
                ),
                0,
            )
            self.assertEqual(
                workflow.main(
                    [
                        "cold-start-workflow.py",
                        "mark-success",
                        str(root),
                        str(config_path),
                        str(run_path),
                        "code",
                        "home",
                    ]
                ),
                0,
            )
            state = workflow.read_run_state(run_path)
            self.assertEqual(state["shards"][0]["code"]["status"], "success")

    def test_helper_can_be_imported_with_underscore_module_name(self):
        module_dir = str(SCRIPT_PATH.parent)
        sys.path.insert(0, module_dir)
        try:
            sys.modules.pop("cold_start_workflow", None)
            module = importlib.import_module("cold_start_workflow")
        finally:
            sys.path.remove(module_dir)

        self.assertTrue(callable(module.load_config))
        self.assertTrue(callable(module.main))

    def test_run_state_returns_next_code_then_product_action(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {"version": 1, "shards": [{"id": "home", "scopes": ["a_home"]}]},
            )
            run_path = root / ".understand-anything" / "cold-start-run.json"

            state = workflow.init_run_state(root, config_path, run_path)
            self.assertEqual(state["shards"][0]["code"]["status"], "pending")
            self.assertTrue(run_path.exists())

            action = workflow.next_action(root, config_path, run_path, resume=False, continue_on_error=False)
            self.assertEqual(action["action"], "run-code-shard")
            self.assertEqual(action["stage"], "code")
            self.assertEqual(action["shardId"], "home")
            self.assertEqual(action["scopeArg"], "a_home")

            workflow.mark_stage_start(root, config_path, run_path, "code", "home", "scan")
            state = workflow.mark_stage_success(root, config_path, run_path, "code", "home")
            self.assertEqual(state["shards"][0]["code"]["status"], "success")
            self.assertEqual(state["shards"][0]["code"]["attempts"], 1)

            action = workflow.next_action(root, config_path, run_path, resume=False, continue_on_error=False)
            self.assertEqual(action["action"], "run-product-shard")
            self.assertEqual(action["stage"], "product")
            self.assertEqual(action["shardId"], "home")

    def test_run_state_retries_once_then_blocks_or_continues(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            (root / "a_player").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {
                    "version": 1,
                    "shards": [
                        {"id": "home", "scopes": ["a_home"]},
                        {"id": "player", "scopes": ["a_player"]},
                    ],
                },
            )
            run_path = root / ".understand-anything" / "cold-start-run.json"
            workflow.init_run_state(root, config_path, run_path)

            workflow.mark_stage_start(root, config_path, run_path, "code", "home", "scan")
            workflow.mark_stage_failed(root, config_path, run_path, "code", "home", "scan", "scanner failed")
            retry = workflow.next_action(root, config_path, run_path, resume=False, continue_on_error=False)
            self.assertEqual(retry["action"], "run-code-shard")
            self.assertTrue(retry["retry"])
            self.assertEqual(retry["shardId"], "home")

            workflow.mark_stage_start(root, config_path, run_path, "code", "home", "scan")
            workflow.mark_stage_failed(root, config_path, run_path, "code", "home", "scan", "scanner failed again")
            blocked = workflow.next_action(root, config_path, run_path, resume=False, continue_on_error=False)
            self.assertEqual(blocked["action"], "blocked")
            self.assertEqual(blocked["stage"], "code")
            self.assertEqual(blocked["shardId"], "home")

            continued = workflow.next_action(root, config_path, run_path, resume=False, continue_on_error=True)
            self.assertEqual(continued["action"], "run-code-shard")
            self.assertEqual(continued["shardId"], "player")

    def test_continue_on_error_does_not_run_product_for_failed_code_shard(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            (root / "a_player").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {
                    "version": 1,
                    "shards": [
                        {"id": "home", "scopes": ["a_home"]},
                        {"id": "player", "scopes": ["a_player"]},
                    ],
                },
            )
            run_path = root / ".understand-anything" / "cold-start-run.json"
            workflow.init_run_state(root, config_path, run_path)
            for _ in range(2):
                workflow.mark_stage_start(root, config_path, run_path, "code", "home", "scan")
                workflow.mark_stage_failed(root, config_path, run_path, "code", "home", "scan", "scanner failed")
            workflow.mark_stage_start(root, config_path, run_path, "code", "player", "scan")
            workflow.mark_stage_success(root, config_path, run_path, "code", "player")

            action = workflow.next_action(root, config_path, run_path, resume=False, continue_on_error=True)

            self.assertEqual(action["action"], "run-product-shard")
            self.assertEqual(action["shardId"], "player")

    def test_resume_skips_only_verified_code_and_product_artifacts(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {"version": 1, "shards": [{"id": "home", "scopes": ["a_home"]}]},
            )
            run_path = root / ".understand-anything" / "cold-start-run.json"
            workflow.init_run_state(root, config_path, run_path)
            ua_dir = root / ".understand-anything"
            (ua_dir / "shards").mkdir(parents=True, exist_ok=True)
            (ua_dir / "product-shards").mkdir(exist_ok=True)
            (ua_dir / "product-traces").mkdir(exist_ok=True)

            self.write_json(
                ua_dir / "shards" / "home.json",
                {
                    "shard": {"id": "home", "scopes": ["a_home"]},
                    "nodes": [],
                    "edges": [],
                },
            )

            action = workflow.next_action(root, config_path, run_path, resume=True, continue_on_error=False)
            self.assertEqual(action["action"], "run-product-shard")
            state = workflow.read_run_state(run_path)
            self.assertEqual(state["shards"][0]["code"]["status"], "skipped")

            self.write_json(ua_dir / "product-shards" / "home.json", {"topics": []})
            self.write_json(ua_dir / "product-traces" / "home.json", {"trace": []})
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

            action = workflow.next_action(root, config_path, run_path, resume=True, continue_on_error=False)
            self.assertEqual(action["action"], "complete")
            state = workflow.read_run_state(run_path)
            self.assertEqual(state["shards"][0]["product"]["status"], "skipped")

    def test_resume_reinitializes_when_config_hash_changes(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            (root / "a_player").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {"version": 1, "shards": [{"id": "home", "scopes": ["a_home"]}]},
            )
            run_path = root / ".understand-anything" / "cold-start-run.json"
            workflow.init_run_state(root, config_path, run_path)
            workflow.mark_stage_start(root, config_path, run_path, "code", "home", "scan")
            workflow.mark_stage_success(root, config_path, run_path, "code", "home")

            self.write_json(
                config_path,
                {
                    "version": 1,
                    "shards": [
                        {"id": "home", "scopes": ["a_home"]},
                        {"id": "player", "scopes": ["a_player"]},
                    ],
                },
            )

            action = workflow.next_action(root, config_path, run_path, resume=True, continue_on_error=False)
            state = workflow.read_run_state(run_path)
            self.assertEqual(action["action"], "run-code-shard")
            self.assertEqual(action["shardId"], "home")
            self.assertEqual([shard["id"] for shard in state["shards"]], ["home", "player"])
            self.assertEqual(state["shards"][0]["code"]["status"], "pending")

    def test_init_preserves_existing_run_state_when_config_is_unchanged(self):
        workflow = load_workflow()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a_home").mkdir()
            config_path = root / "scope-shards.json"
            self.write_json(
                config_path,
                {"version": 1, "shards": [{"id": "home", "scopes": ["a_home"]}]},
            )
            run_path = root / ".understand-anything" / "cold-start-run.json"
            workflow.init_run_state(root, config_path, run_path)
            workflow.mark_stage_start(root, config_path, run_path, "code", "home", "scan")
            workflow.mark_stage_success(root, config_path, run_path, "code", "home")

            state = workflow.init_run_state(root, config_path, run_path)

            self.assertEqual(state["shards"][0]["code"]["status"], "success")

    def write_json(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
