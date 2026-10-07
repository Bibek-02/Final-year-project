"""
Select 24 deterministic test cases (12 weekly + 12 monthly) for the
recommendation-quality rubric described in thesis Section 3.6.5 / Appendix C.

Stratification: within each granularity, cases are balanced across two binary
splits:

  - high/low: "Predicted Sales" >= median of that granularity's *eligible*
    test forecasts (median computed after excluding incomplete periods and
    rows missing SHAP, below) -> high; otherwise low.

  - promo/no-promo: value of the "PromoDays" SHAP feature. dss_forecast_output.csv
    has no promo column, so this is read from the "Feature Value" of the
    Feature=="PromoDays" row in that case's local-SHAP explanation.
      * Weekly: PromoDays has genuine zeros (no promotion ran that week) for
        ~46% of rows, so promo := PromoDays > 0, no_promo := PromoDays == 0.
      * Monthly: PromoDays is NEVER zero in this dataset (min=3 of ~28-31
        days/month) -- a literal zero/non-zero split leaves 0 eligible
        "no-promo" monthly cases, below the required 3. Per explicit user
        decision (2026-10-07, asked because this is a methodological call
        affecting thesis rigor, not a silent substitution), monthly instead
        uses a *relative* median split: promo := PromoDays >= median(eligible
        monthly PromoDays), no_promo := PromoDays < median. This is a
        promo-intensity split for monthly, not literal promo-absence --
        rubric_anchors.md and the thesis text must describe it this way, not
        as "stores running zero promotion."

Incomplete-period exclusion: a period is incomplete if the most "OpenDays"
any store reached in it falls short of that period's full calendar length
(7 days for weekly; the calendar month length for monthly, via
calendar.monthrange) -- i.e. the dataset's last real day cuts the period
short, as opposed to a naturally shorter calendar month (e.g. a 30-day June
is NOT incomplete). This is computed from the artifact, not hardcoded to a
specific date, and currently flags exactly the final weekly period
(2015-07-27, every store capped at 5 open days) while finding no incomplete
monthly periods.

3 cases are drawn per (granularity x promo x high/low) cell = 12 per
granularity, 24 total, random_state=42. Within each cell, candidates are
sorted by Store id (then Period) ascending before sampling, so the sample is
fully reproducible regardless of the artifact CSV's own row order. If any
cell has fewer than 3 eligible candidates, this script raises rather than
substituting silently.
"""
import calendar
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

RANDOM_STATE = 42
N_PER_CELL = 3

GRANULARITIES = [
    {"label": "Weekly", "key": "weekly"},
    {"label": "Monthly", "key": "monthly"},
]

OUTPUT_COLUMNS = [
    "case_id", "granularity", "store_id", "period", "promo", "high_low",
    "predicted_sales", "promo_days_value",
]


def _period_length_days(period_str: str, granularity_key: str) -> int:
    d = date.fromisoformat(period_str)
    if granularity_key == "weekly":
        return 7
    return calendar.monthrange(d.year, d.month)[1]


def _incomplete_periods(max_open_by_period: pd.Series, granularity_key: str) -> list:
    return [
        period
        for period, max_open in max_open_by_period.items()
        if max_open < _period_length_days(period, granularity_key)
    ]


def select_cases_for_granularity(store, label: str, key: str) -> pd.DataFrame:
    dss = store.dss_output
    sub = dss[dss["Forecast Type"] == label].copy()
    if sub.empty:
        raise RuntimeError(f"[{label}] no rows in dss_forecast_output.csv for Forecast Type == {label!r}.")

    shap_df = store.weekly_shap_local if key == "weekly" else store.monthly_shap_local

    open_days = shap_df[shap_df["Feature"] == "OpenDays"]
    max_open_by_period = open_days.groupby("Period")["Feature Value"].max()
    incomplete = set(_incomplete_periods(max_open_by_period, key))
    if incomplete:
        print(f"  [{label}] excluding incomplete period(s): {sorted(incomplete)}")

    eligible_periods = set(sub["Period"].unique()) - incomplete
    sub = sub[sub["Period"].isin(eligible_periods)]

    promo_df = shap_df[shap_df["Feature"] == "PromoDays"][["Store", "Period", "Feature Value"]]
    promo_df = promo_df.rename(columns={"Feature Value": "PromoDays"})
    if promo_df.empty:
        raise RuntimeError(
            f"[{label}] could not read the 'PromoDays' feature from the local SHAP explanation — aborting."
        )

    before = len(sub)
    merged = sub.merge(promo_df, on=["Store", "Period"], how="inner")
    missing = before - len(merged)
    if missing:
        print(f"  [{label}] excluding {missing} forecast row(s) with no matching local-SHAP PromoDays row")

    if merged["PromoDays"].isna().any():
        raise RuntimeError(f"[{label}] PromoDays value missing for some eligible rows — aborting.")

    median_sales = merged["Predicted Sales"].median()
    merged["high_low"] = np.where(merged["Predicted Sales"] >= median_sales, "high", "low")
    print(f"  [{label}] eligible test forecasts: {len(merged)}, median Predicted Sales: {median_sales:,.2f}")

    if key == "weekly":
        merged["promo"] = np.where(merged["PromoDays"] > 0, "promo", "no_promo")
    else:
        median_promo = merged["PromoDays"].median()
        merged["promo"] = np.where(merged["PromoDays"] >= median_promo, "promo", "no_promo")
        print(
            f"  [{label}] PromoDays never 0 in this dataset (min={merged['PromoDays'].min():.0f}) - "
            f"using median split at PromoDays >= {median_promo:.1f} as a promo-intensity proxy (see module docstring)."
        )

    picks = []
    shortfall = []
    for promo_val in ("promo", "no_promo"):
        for hl_val in ("high", "low"):
            cell = merged[(merged["promo"] == promo_val) & (merged["high_low"] == hl_val)]
            cell = cell.sort_values(["Store", "Period"]).reset_index(drop=True)
            if len(cell) < N_PER_CELL:
                shortfall.append((promo_val, hl_val, len(cell)))
                continue
            sampled = cell.sample(n=N_PER_CELL, random_state=RANDOM_STATE)
            picks.append(sampled)

    if shortfall:
        detail = "; ".join(f"{p}/{h}: {n} eligible (need {N_PER_CELL})" for p, h, n in shortfall)
        raise RuntimeError(
            f"[{label}] insufficient eligible rows in cell(s): {detail}. "
            f"Stopping — never silently substituting a different cell."
        )

    result = pd.concat(picks, ignore_index=True)
    result["granularity"] = key
    result["case_id"] = result.apply(lambda r: f"{key}_{int(r['Store'])}_{r['Period']}", axis=1)
    result = result.rename(columns={
        "Store": "store_id", "Period": "period", "Predicted Sales": "predicted_sales",
        "PromoDays": "promo_days_value",
    })
    return result[OUTPUT_COLUMNS].sort_values(["store_id", "period"]).reset_index(drop=True)


def select_all_cases(store=None) -> pd.DataFrame:
    store = store or common.ensure_artifacts_loaded()
    frames = [select_cases_for_granularity(store, g["label"], g["key"]) for g in GRANULARITIES]
    return pd.concat(frames, ignore_index=True)


def main():
    cases = select_all_cases()
    out_dir = common.ensure_output_dir()
    out_path = os.path.join(out_dir, "cases.csv")
    cases.to_csv(out_path, index=False)
    print(f"Wrote {len(cases)} cases to {out_path}")
    print(cases.groupby(["granularity", "promo", "high_low"]).size())
    return cases


if __name__ == "__main__":
    main()
