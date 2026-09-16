export const FEATURE_LABELS = {
  PromoDays               : 'Promotion activity',
  OpenDays                : 'Number of open days',
  SchoolHolidayDays       : 'School holiday period',
  StateHolidayDays        : 'State holiday period',
  WeekendDays             : 'Weekend days',
  MonthStartDays          : 'Month-start timing',
  MonthEndDays            : 'Month-end timing',
  periods_since_last_promo: 'Periods since previous promotion',
  sales_lag_1             : 'Previous period sales',
  sales_lag_2             : 'Sales two periods ago',
  sales_lag_3             : 'Sales three periods ago',
  sales_lag_4             : 'Sales four weeks ago',
  sales_lag_8             : 'Sales eight weeks ago',
  sales_lag_12            : 'Sales from the same month last year',
  sales_lag_52            : 'Sales from the same week last year',
  rolling_mean_3          : 'Recent 3-period average',
  rolling_mean_4          : 'Recent 4-week average',
  rolling_mean_6          : 'Recent 6-period average',
  rolling_mean_8          : 'Recent 8-week average',
  rolling_mean_12         : 'Recent 12-week average',
  rolling_std_3           : 'Recent 3-period sales variability',
  rolling_std_4           : 'Recent 4-week sales variability',
  rolling_std_6           : 'Recent 6-period sales variability',
  rolling_std_8           : 'Recent 8-week sales variability',
  rolling_std_12          : 'Recent 12-week sales variability',
  EMA_3                   : 'Recent 3-period weighted trend',
  EMA_4                   : 'Recent 4-week weighted trend',
  EMA_6                   : 'Recent 6-period weighted trend',
  EMA_8                   : 'Recent 8-week weighted trend',
  TimeIndex               : 'Time progression',
  Year                    : 'Calendar year',
  Month                   : 'Month of year',
  WeekOfYear              : 'Week of year',
  Quarter                 : 'Quarter of year',
  CompetitionDistance     : 'Competition proximity',
  CompetitionOpenKnown    : 'Competition opening date availability',
  CompetitionOpenSinceYear: 'Year nearby competitor opened',
  CompetitionOpenSinceMonth: 'Month nearby competitor opened',
  Promo2                  : 'Long-term promotion',
  Promo2SinceYear         : 'Year continuous promotion began',
  Promo2SinceWeek         : 'Week continuous promotion began',
  Store                   : 'Store identifier',
};

export function readableLabel(feature) {
  if (FEATURE_LABELS[feature]) return FEATURE_LABELS[feature];
  if (feature.startsWith('StoreType_'))     return `Store type: ${feature.split('_')[1].toUpperCase()}`;
  if (feature.startsWith('Assortment_'))    return `Assortment: ${feature.split('_')[1].toUpperCase()}`;
  if (feature.startsWith('PromoInterval_')) return `Promo interval: ${feature.replace('PromoInterval_', '')}`;
  return feature;
}

export function capitalize(s) {
  return s && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Prefer the artifact's own precomputed "Readable Feature" text (present on
// both /shap/global and /shap/local rows) when it's actually been humanised
// by the offline pipeline — it covers more features than this file's hand
// -maintained dict/prefix rules and is guaranteed to match the raw Feature
// 1:1. Fall back to readableLabel() only for the handful of engineered
// columns the pipeline itself leaves un-humanised (one-hot dummies, a few
// raw calendar/competition counters), which equal their raw Feature verbatim
// in the artifact — see test_readable_feature_can_equal_raw_feature_for_unmapped_columns.
export function getFeatureLabel(rawFeature, apiReadableFeature) {
  const isHumanized = apiReadableFeature && apiReadableFeature !== rawFeature;
  return capitalize(isHumanized ? apiReadableFeature : readableLabel(rawFeature));
}
