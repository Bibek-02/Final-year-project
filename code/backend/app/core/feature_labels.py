"""
Business-friendly labels for model feature names.

Python port of frontend/src/lib/featureLabels.js — kept behaviourally
identical so a given feature name reads the same in the dashboard and in
any server-generated text (e.g. the agent's Claude prompt).
"""

FEATURE_LABELS = {
    "PromoDays"               : "Promotion activity",
    "OpenDays"                : "Number of open days",
    "SchoolHolidayDays"       : "School holiday period",
    "StateHolidayDays"        : "State holiday period",
    "WeekendDays"             : "Weekend days",
    "MonthStartDays"          : "Month-start timing",
    "MonthEndDays"            : "Month-end timing",
    "periods_since_last_promo": "Time since last promotion",
    "sales_lag_1"             : "Previous period sales",
    "sales_lag_2"             : "Sales two periods ago",
    "sales_lag_3"             : "Sales three periods ago",
    "sales_lag_4"             : "Sales four weeks ago",
    "sales_lag_8"             : "Sales eight weeks ago",
    "sales_lag_12"            : "Same period last year",
    "sales_lag_52"            : "Same week last year",
    "rolling_mean_3"          : "Average sales over the previous 3 months",
    "rolling_mean_4"          : "Average sales over the previous 4 weeks",
    "rolling_mean_6"          : "Average sales over the previous 6 months",
    "rolling_mean_8"          : "Average sales over the previous 8 weeks",
    "rolling_mean_12"         : "Average sales over the previous 12 weeks",
    "EMA_3"                   : "Recent sales trend over the previous 3 months",
    "EMA_4"                   : "Recent sales trend over the previous 4 weeks",
    "EMA_6"                   : "Recent sales trend over the previous 6 months",
    "EMA_8"                   : "Recent sales trend over the previous 8 weeks",
    "TimeIndex"               : "Time progression",
    "Month"                   : "Month of year",
    "WeekOfYear"              : "Week of year",
    "Quarter"                 : "Quarter of year",
    "CompetitionDistance"     : "Competition proximity",
    "Promo2"                  : "Long-term promotion",
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
