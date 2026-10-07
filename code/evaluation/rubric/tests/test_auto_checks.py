import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import auto_checks


def _clean_output():
    rec = {
        "recommendation": "Consider reviewing weekend staffing cover.",
        "detail": "The modelled contribution from weekend days (ref: shap:WeekendDays) suggests this may be worth checking.",
        "evidence_refs": ["shap:WeekendDays", "predicted_sales"],
        "caution": "This is a decision-support suggestion, not a directive to act.",
    }
    return {
        "staffing": dict(rec), "stock": dict(rec), "promotions": dict(rec),
        "summary": "Predicted sales of 29,503 are modestly above the recent average.",
        "limitations": ["No stock-level data available."],
    }


def _record(output, error=None):
    return {
        "case_id": "weekly_1_2015-05-04",
        "error": error,
        "output": output,
        "inputs": {
            "allowed_evidence_ids": ["predicted_sales", "positive_factors", "negative_factors", "shap:WeekendDays"],
            "user_prompt": "Predicted Sales (ref: predicted_sales): 29,503 units\nWeekendDays SHAP=6.6218 (value=1.00)",
        },
    }


def test_clean_case_passes_everything():
    rows = auto_checks.run_checks_for_record(_record(_clean_output()))
    failed = [r for r in rows if not r["passed"]]
    assert failed == [], failed


def test_planted_fake_reference_is_caught():
    output = _clean_output()
    output["staffing"]["evidence_refs"] = ["made_up_ref_not_in_allowlist"]
    rows = auto_checks.run_checks_for_record(_record(output))
    share_row = next(r for r in rows if r["check"] == "evidence_refs_allowlist_share")
    assert share_row["passed"] is False


def test_planted_actual_sales_mention_is_caught():
    output = _clean_output()
    output["staffing"]["detail"] += " Actual sales for this period were higher than predicted."
    rows = auto_checks.run_checks_for_record(_record(output))
    leak_row = next(r for r in rows if r["check"] == "flag_realised_data_mentions")
    assert leak_row["passed"] is False
    assert "actual sales" in leak_row["detail"]


def test_planted_guarantee_phrase_is_caught():
    output = _clean_output()
    output["staffing"]["recommendation"] = "We guarantee this will improve sales."
    rows = auto_checks.run_checks_for_record(_record(output))
    guarantee_row = next(r for r in rows if r["check"] == "flag_guarantee_language")
    assert guarantee_row["passed"] is False


def test_failed_generation_is_recorded_not_dropped():
    rows = auto_checks.run_checks_for_record(_record(None, error="HTTP 502: Agent API error"))
    assert len(rows) == 1
    assert rows[0]["check"] == "generation_succeeded"
    assert rows[0]["passed"] is False
    assert "502" in rows[0]["detail"]


def test_empty_promotions_refs_passes_when_no_promo_evidence_available():
    output = _clean_output()
    output["promotions"]["evidence_refs"] = []
    record = _record(output)
    # No "shap:Promo*" id in the allowed evidence for this case — correct
    # behaviour is to say promotion-specific action isn't supported, so an
    # empty evidence_refs list here must not be scored as a failure.
    assert not any(r.startswith("shap:") and "promo" in r.lower() for r in record["inputs"]["allowed_evidence_ids"])

    rows = auto_checks.run_checks_for_record(record)
    nonempty_row = next(r for r in rows if r["check"] == "evidence_refs_nonempty")
    assert nonempty_row["passed"] is True
    assert nonempty_row["detail"] == "promotion driver absent"


def test_empty_promotions_refs_fails_when_promo_evidence_was_available():
    output = _clean_output()
    output["promotions"]["evidence_refs"] = []
    record = _record(output)
    record["inputs"]["allowed_evidence_ids"].append("shap:PromoDays")

    rows = auto_checks.run_checks_for_record(record)
    nonempty_row = next(r for r in rows if r["check"] == "evidence_refs_nonempty")
    assert nonempty_row["passed"] is False
    assert "promotions" in nonempty_row["detail"]


def test_empty_staffing_refs_still_fails_even_with_no_promo_evidence():
    output = _clean_output()
    output["staffing"]["evidence_refs"] = []
    output["promotions"]["evidence_refs"] = []
    record = _record(output)

    rows = auto_checks.run_checks_for_record(record)
    nonempty_row = next(r for r in rows if r["check"] == "evidence_refs_nonempty")
    assert nonempty_row["passed"] is False
    assert "staffing" in nonempty_row["detail"]
    assert "promotions" not in nonempty_row["detail"].split("(")[0]  # not blamed for the failure itself


def test_flag_checks_report_flagged_rate_not_pass_rate():
    output = _clean_output()
    output["staffing"]["recommendation"] = "We guarantee this will improve sales."
    df = auto_checks.run_checks([_record(output), _record(_clean_output())])

    rates = auto_checks.summarise_rates(df)
    guarantee_row = rates[rates["check"] == "flag_guarantee_language"].iloc[0]
    assert guarantee_row["metric"] == "flagged_rate"
    assert guarantee_row["value"] == 0.5  # 1 of 2 cases flagged

    structural_row = rates[rates["check"] == "sections_present"].iloc[0]
    assert structural_row["metric"] == "pass_rate"
    assert structural_row["value"] == 1.0
