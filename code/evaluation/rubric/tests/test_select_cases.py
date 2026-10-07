import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import select_cases


def test_select_all_cases_returns_24_balanced_cases(artifacts):
    cases = select_cases.select_all_cases(artifacts)
    assert len(cases) == 24

    by_granularity = cases.groupby("granularity").size()
    assert by_granularity.to_dict() == {"monthly": 12, "weekly": 12}

    cell_counts = cases.groupby(["granularity", "promo", "high_low"]).size()
    assert len(cell_counts) == 8  # 2 granularities x 2 promo x 2 high/low
    assert (cell_counts == 3).all()


def test_select_all_cases_is_reproducible_across_two_runs(artifacts):
    first = select_cases.select_all_cases(artifacts)
    second = select_cases.select_all_cases(artifacts)

    assert sorted(first["case_id"]) == sorted(second["case_id"])
    assert first.sort_values("case_id").reset_index(drop=True).equals(
        second.sort_values("case_id").reset_index(drop=True)
    )


def test_weekly_excludes_the_final_partial_period(artifacts):
    cases = select_cases.select_all_cases(artifacts)
    weekly_periods = set(cases[cases["granularity"] == "weekly"]["period"])
    assert "2015-07-27" not in weekly_periods


def test_weekly_promo_is_literal_zero_vs_nonzero(artifacts):
    cases = select_cases.select_all_cases(artifacts)
    weekly = cases[cases["granularity"] == "weekly"]
    promo_rows = weekly[weekly["promo"] == "promo"]
    no_promo_rows = weekly[weekly["promo"] == "no_promo"]
    assert (promo_rows["promo_days_value"] > 0).all()
    assert (no_promo_rows["promo_days_value"] == 0).all()


def test_monthly_promo_never_has_a_literal_zero(artifacts):
    cases = select_cases.select_all_cases(artifacts)
    monthly = cases[cases["granularity"] == "monthly"]
    assert (monthly["promo_days_value"] > 0).all()
