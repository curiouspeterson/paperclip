#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import runpy
import sys


def main() -> None:
    wrapper_name = Path(sys.argv[0]).name
    repo_root = Path(__file__).resolve().parents[2]
    target = repo_root / "bin" / wrapper_name
    if not target.is_file():
        raise SystemExit(f"Romance Unzipped legacy wrapper could not find root pipeline entrypoint: {target}")
    sys.path.insert(0, str(target.parent))
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
