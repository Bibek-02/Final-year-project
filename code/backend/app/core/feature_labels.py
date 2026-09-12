"""
Business-friendly labels for model feature names.

Python port of frontend/src/lib/featureLabels.js — kept behaviourally
identical so a given feature name reads the same in the dashboard and in
any server-generated text (e.g. the agent's Claude prompt).
"""

FEATURE_LABELS = {
    "PromoDays"            : "Promotion activity",
    "OpenDays"             : "Number of open days",
    "SchoolHolidayDays"    : "School holiday period",
    "StateHolidayDays"     : "State holiday period",
    "WeekendDays"          : "Weekend days",
    "MonthStartDays"       : "Month-start timing",
    "MonthEndDays"         : "Month-end timing",
    "days_since_last_promo": "Time since last promotion",
    "sales_lag_1"          : "Previous period sales",
    "sales_lag_2"          : "Sales two periods ago",
    "sales_lag_3"          : "Sales three periods ago",
    "sales_lag_4"          : "Sales four weeks ago",
    "sales_lag_8"          : "Sales eight weeks ago",
    "sales_lag_12"         : "Same period last year",
    "sales_lag_52"         : "Same week last year",
    "rolling_mean_3"       : "Recent 3-period average",
    "rolling_mean_4"       : "Recent 4-week average",
    "rolling_mean_6"       : "Recent 6-period average",
    "rolling_mean_8"       : "Recent 8-week average",
    "rolling_mean_12"      : "Recent 12-week average",
    "EMA_3"                : "Recent 3-period trend",
    "EMA_4"                : "Recent 4-week trend",
    "EMA_6"                : "Recent 6-period trend",
    "EMA_8"                : "Recent 8-week trend",
    "TimeIndex"            : "Time progression",
    "Month"                : "Month of year",
    "WeekOfYear"           : "Week of year",
    "Quarter"              : "Quarter of year",
    "CompetitionDistance"  : "Competition proximity",
    "Promo2"               : "Long-term promotion",
}


def readable_label(feature: str) -> str:
    if feature in FEATURE_LABELS:
        return FEATURE_LABELS[feature]
    if feature.startswith("StoreType_"):
        return f"Store type: {feature.split('_')[1].upper()}"
    if feature.startswith("Assortment_"):
        return f"Assortment: {feature.split('_')[1].upper()}"
    if feature.startswith("PromoInterval_"):
        return f"Promo interval: {feature.replace('PromoInterval_', '')}"
    return feature
