import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import common


@pytest.fixture(scope="session", autouse=True)
def artifacts():
    # Session-scoped: loading model_artifacts/ is the dominant cost of this
    # suite (same reasoning as backend/tests/conftest.py's `client` fixture).
    return common.ensure_artifacts_loaded()
