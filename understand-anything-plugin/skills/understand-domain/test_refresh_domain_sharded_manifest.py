import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("refresh-domain-sharded-manifest.py")


def load_refresh_manifest():
    spec = importlib.util.spec_from_file_location("refresh_domain_sharded_manifest", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.refresh_manifest


class RefreshDomainShardedManifestTest(unittest.TestCase):
    def test_refresh_manifest_does_not_read_shard_contents(self):
        refresh_manifest = load_refresh_manifest()

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            shard_dir = root / ".understand-anything" / "domain-shards"
            shard_dir.mkdir(parents=True)
            (shard_dir / "home.json").write_text("{not json", encoding="utf-8")
            (shard_dir / "player.json").write_text("[]", encoding="utf-8")

            manifest = refresh_manifest(root)

            manifest_path = root / ".understand-anything" / "domain-graph.json"
            self.assertTrue(manifest_path.exists())
            saved = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["kind"], "domain-sharded")
            self.assertEqual(manifest, saved)
            self.assertEqual(
                saved["shards"],
                [
                    {
                        "id": "home",
                        "path": "domain-shards/home.json",
                        "sourceCodeShard": "shards/home.json",
                    },
                    {
                        "id": "player",
                        "path": "domain-shards/player.json",
                        "sourceCodeShard": "shards/player.json",
                    },
                ],
            )
            self.assertNotIn("nodeCount", saved)

    def test_refresh_manifest_skips_invalid_shard_ids(self):
        refresh_manifest = load_refresh_manifest()

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            shard_dir = root / ".understand-anything" / "domain-shards"
            shard_dir.mkdir(parents=True)
            (shard_dir / "valid.json").write_text("{}", encoding="utf-8")
            (shard_dir / "bad.name.json").write_text("{}", encoding="utf-8")

            manifest = refresh_manifest(root)

            self.assertEqual(
                manifest["shards"],
                [
                    {
                        "id": "valid",
                        "path": "domain-shards/valid.json",
                        "sourceCodeShard": "shards/valid.json",
                    }
                ],
            )
            self.assertTrue(any("bad.name.json" in warning for warning in manifest["warnings"]))


if __name__ == "__main__":
    unittest.main()
