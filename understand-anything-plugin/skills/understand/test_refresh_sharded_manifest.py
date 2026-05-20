import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("refresh-sharded-manifest.py")


def load_refresh_manifest():
    spec = importlib.util.spec_from_file_location("refresh_sharded_manifest", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.refresh_manifest


class RefreshShardedManifestTests(unittest.TestCase):
    def test_builds_manifest_from_shards(self):
        refresh_manifest = load_refresh_manifest()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            shards_dir = root / ".understand-anything" / "shards"
            shards_dir.mkdir(parents=True)

            self.write_json(
                shards_dir / "home.json",
                {
                    "shard": {"id": "home", "scopes": ["a_home", "a_home_api"]},
                    "project": {
                        "name": "Demo",
                        "languages": ["TypeScript"],
                        "frameworks": ["React"],
                        "description": "Demo project",
                        "analyzedAt": "2026-05-20T00:00:00Z",
                        "gitCommitHash": "abc123",
                    },
                    "overview": {"summary": "Home area"},
                    "nodes": [{"id": "home.ts"}, {"id": "api.ts"}],
                    "edges": [{"from": "home.ts", "to": "api.ts"}],
                },
            )
            self.write_json(
                shards_dir / "player.json",
                {
                    "shard": {"id": "player", "scopes": ["a_player"]},
                    "project": {
                        "name": "Demo",
                        "languages": ["TypeScript", "CSS"],
                        "frameworks": ["React", "Vite"],
                        "description": "Demo project",
                        "analyzedAt": "2026-05-20T01:00:00Z",
                        "gitCommitHash": "def456",
                    },
                    "overview": {"summary": "Player area"},
                    "nodes": [{"id": "player.ts"}],
                    "edges": [
                        {"from": "player.ts", "to": "home.ts"},
                        {"from": "player.ts", "to": "api.ts"},
                    ],
                },
            )

            manifest = refresh_manifest(root)

            self.assertEqual(manifest["kind"], "codebase-sharded")
            self.assertEqual(manifest["overview"]["shardCount"], 2)
            self.assertEqual(manifest["overview"]["nodeCount"], 3)
            self.assertEqual(manifest["overview"]["edgeCount"], 3)
            self.assertEqual([shard["id"] for shard in manifest["shards"]], ["home", "player"])
            self.assertEqual(manifest["shards"][0]["scopes"], ["a_home", "a_home_api"])

            output_path = root / ".understand-anything" / "knowledge-graph.json"
            self.assertTrue(output_path.exists())
            self.assertEqual(json.loads(output_path.read_text())["kind"], "codebase-sharded")

    def test_skips_malformed_shard_files(self):
        refresh_manifest = load_refresh_manifest()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            shards_dir = root / ".understand-anything" / "shards"
            shards_dir.mkdir(parents=True)

            self.write_json(
                shards_dir / "valid.json",
                {
                    "shard": {"id": "valid", "scopes": ["a_valid"]},
                    "project": {"name": "Demo", "languages": ["Python"]},
                    "nodes": [{"id": "valid.py"}],
                    "edges": [],
                },
            )
            (shards_dir / "broken.json").write_text("{not json", encoding="utf-8")

            manifest = refresh_manifest(root)

            self.assertEqual(manifest["overview"]["shardCount"], 1)
            self.assertEqual(manifest["overview"]["nodeCount"], 1)
            self.assertEqual(manifest["overview"]["edgeCount"], 0)
            self.assertEqual([shard["id"] for shard in manifest["shards"]], ["valid"])
            self.assertTrue(any("broken.json" in warning for warning in manifest["warnings"]))

    def write_json(self, path, value):
        path.write_text(json.dumps(value), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
