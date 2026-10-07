"""
Shared setup for evaluation/rubric scripts.

The app's config (app/config.py's Settings(env_file=".env")) and artifact
loader (app/core/artifacts.py's ARTIFACT_DIR="model_artifacts") both resolve
relative to the process's current working directory, not relative to the
file that defines them. The real app always runs with CWD=backend/ (uvicorn
is started from there; backend/tests/conftest.py relies on the same thing).
These evaluation scripts are run from the repo root, so without chdir-ing
into backend/ first, settings.anthropic_api_key silently comes back None and
the artifact CSVs fail to resolve. ensure_artifacts_loaded() below does the
same chdir + load_all_artifacts() the app's own startup lifespan does
(app/main.py), so this harness sees exactly the config/data the app sees.
"""
import os
import sys

RUBRIC_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(RUBRIC_DIR, "..", "..", "backend"))
OUTPUT_DIR = os.path.join(RUBRIC_DIR, "outputs")

_artifacts_loaded = False


def setup_backend_path():
    if BACKEND_DIR not in sys.path:
        sys.path.insert(0, BACKEND_DIR)


def ensure_artifacts_loaded():
    """Returns the app's populated ArtifactStore, loading it at most once per process."""
    global _artifacts_loaded
    setup_backend_path()
    os.chdir(BACKEND_DIR)
    from app.core.artifacts import load_all_artifacts, store

    if not _artifacts_loaded:
        load_all_artifacts()
        _artifacts_loaded = True
    return store


def ensure_output_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    return OUTPUT_DIR


def default_results_path():
    """Live results (results.jsonl) take priority over the dry-run file
    (results_dryrun.jsonl) when both exist, since live is the authoritative
    run once Phase B has happened. Falls back to the live path's name (even
    if missing) so a FileNotFoundError names the file a caller would expect."""
    live = os.path.join(OUTPUT_DIR, "results.jsonl")
    dry_run = os.path.join(OUTPUT_DIR, "results_dryrun.jsonl")
    if os.path.exists(live):
        return live
    if os.path.exists(dry_run):
        return dry_run
    return live
