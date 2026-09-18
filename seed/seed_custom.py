"""Run the repeatable custom-backend fixture seed from the repository root."""
import runpy
import sys
from pathlib import Path

backend = Path(__file__).parents[1] / "custom-backend"
sys.path.insert(0, str(backend))
runpy.run_path(str(backend / "seed.py"), run_name="__main__")
