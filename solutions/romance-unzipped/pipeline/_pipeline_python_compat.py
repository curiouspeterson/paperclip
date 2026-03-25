#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import runpy
import sys
from pathlib import Path
from typing import Any, MutableMapping


def _resolve_root_target(wrapper_file: str) -> Path:
    wrapper_path = Path(wrapper_file).resolve()
    repo_root = wrapper_path.parents[3]
    target = repo_root / "bin" / wrapper_path.name
    if not target.is_file():
        raise SystemExit(f"Romance Unzipped solution wrapper could not find root pipeline entrypoint: {target}")
    return target


def _prepend_target_parent(target: Path) -> None:
    target_parent = str(target.parent)
    if target_parent not in sys.path:
        sys.path.insert(0, target_parent)


def run_root_script(wrapper_file: str) -> None:
    target = _resolve_root_target(wrapper_file)
    _prepend_target_parent(target)
    sys.argv[0] = str(target)
    runpy.run_path(str(target), run_name="__main__")


def export_root_module(wrapper_file: str, namespace: MutableMapping[str, Any]) -> None:
    target = _resolve_root_target(wrapper_file)
    _prepend_target_parent(target)
    module_name = f"_paperclip_solution_wrapper_{target.stem.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, target)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Romance Unzipped solution wrapper could not load root module: {target}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    for key, value in module.__dict__.items():
        if key in {"__builtins__", "__cached__", "__file__", "__loader__", "__name__", "__package__", "__spec__"}:
            continue
        namespace[key] = value

