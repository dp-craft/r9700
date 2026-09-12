"""Make the standalone generate.py importable from the tests directory."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))


def pytest_addoption(parser):
    """Opt-in golden refresh for test_golden.py. Never on by default: the goldens are the
    only record of how the generator behaved BEFORE a change, so overwriting them silently
    would destroy the regression signal they exist to provide."""
    parser.addoption("--regenerate-golden", action="store_true", default=False,
                     help="overwrite tests/golden/* with the current generator output")
