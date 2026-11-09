
## Evaluation harness (pytest)

Command:
```
cd evaluation/rubric
python -m pytest tests/ -v
```

Full console output: `evaluation_harness_pytest.txt`.

**Totals:** 24 passed, 0 failed, 0 skipped, 1 warning, in 30.23s.

The single warning is the same XGBoost pickle-serialisation-compatibility `UserWarning` already noted for the backend suite (model pickled under an older XGBoost version than the one used to load it here), triggered when `test_clean_case_passes_everything` loads a saved model artefact.

This confirms "24 passed" in Chapter 4, §4.8 against a real execution log, not just a static test-function count.
