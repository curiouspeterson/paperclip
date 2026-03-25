#!/usr/bin/env python3
from __future__ import annotations

from _pipeline_python_compat import export_root_module, run_root_script

if __name__ == "__main__":
    run_root_script(__file__)
else:
    export_root_module(__file__, globals())
