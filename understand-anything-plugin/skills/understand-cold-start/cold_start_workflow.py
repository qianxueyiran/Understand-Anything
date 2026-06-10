#!/usr/bin/env python3
"""Import-compatible wrapper for cold-start-workflow.py."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


_SCRIPT_PATH = Path(__file__).with_name("cold-start-workflow.py")
_SPEC = importlib.util.spec_from_file_location("_cold_start_workflow_impl", _SCRIPT_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"Cannot load cold-start workflow implementation: {_SCRIPT_PATH}")

_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)

for _name, _value in vars(_MODULE).items():
    if _name.startswith("__"):
        continue
    globals()[_name] = _value


def __getattr__(name: str) -> Any:
    return getattr(_MODULE, name)


if __name__ == "__main__":
    raise SystemExit(_MODULE.main(sys.argv))
