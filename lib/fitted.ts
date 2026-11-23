// The fitted parameter set and the validation record behind it, written by tools/validate.mjs
// from the sealed snapshot (as of 2026-11-14, 128 traded protocols). Reproduce with:
//   node tools/validate.mjs <snapshot.json> --fitted lib/fitted.ts
// Every term below was fitted on a training half and kept only if it cut the held-out half's
// median absolute log error by at least 0.5% on BOTH splits; each shipped variant is
// the one with the lowest combined held-out error across the two splits. Per term:
//   category: kept on both splits (split A fitted "category medians, shrinkage K=5", held-out 1.4328 -> 1.3912; split B fitted "category medians, shrinkage K=3", held-out 1.6694 -> 1.6495)
//   winsorise: dropped (split A fitted "ratios clamped to [0.01, 5]", held-out 1.3912 -> 1.3912; split B fitted "ratios clamped to [0.01, 5]", held-out 1.6495 -> 1.6495)
//   scale: kept on both splits (split A fitted "elasticity 0.95", held-out 1.3912 -> 1.3308; split B fitted "elasticity 0.9", held-out 1.6495 -> 1.5508)
//   momentum: kept on both splits (split A fitted "growth weight 0.3", held-out 1.3308 -> 1.3134; split B fitted "growth weight 0.3", held-out 1.5508 -> 1.5234)
//   maturity: dropped (split A fitted "base 0.88, span 0.24", held-out 1.3134 -> 1.3195; split B fitted "base 0.88, span 0.24", held-out 1.5234 -> 1.4776)
//   breadth: dropped (split A fitted "+1.5% per extra chain", held-out 1.3134 -> 1.2984; split B fitted "+1.5% per extra chain", held-out 1.4776 -> 1.4776)
// Per split:
//   A: hash split (slug coin flip): train 59, test 69; base MdALE 1.4328, selected MdALE 1.2984, launch-radar-2 MdALE 1.3442; the shipped form re-fitted on this split's train scores MdALE 1.2086 held-out.
//   B: time split (fit the past, test the future): train 48, test 47; base MdALE 1.6694, selected MdALE 1.4776, launch-radar-2 MdALE 1.6101; the shipped form re-fitted on this split's train scores MdALE 1.4953 held-out.

import type { ModelParams, ValidationReport } from './model.ts';

/** The shipped model's parameters: launch-radar-2's hand-set constants, replaced by fitted ones. */
export const FITTED_PARAMS: ModelParams = {
  "ratio_floor": 0.001,
  "ratio_cap": 50,
  "shrinkage_k": 3,
  "min_category_samples": 3,
  "use_category": true,
  "elasticity": 0.9,
  "elasticity_ref_tvl": 100000000,
  "growth_floor_pct": -40,
  "growth_cap_pct": 60,
  "growth_weight": 0.6,
  "maturity_base": 1,
  "maturity_span": 0,
  "maturity_window_days": 1825,
  "unknown_age_maturity": 1,
  "breadth_per_chain": 0,
  "breadth_max_chains": 7
};

/** The validation record the dashboard's method view renders: verdicts with their numbers. */
export const VALIDATION: ValidationReport = {
  "as_of": "2026-11-14",
  "traded_n": 128,
  "keep_margin": 0.005,
  "splits": [
    {
      "name": "A: hash split (slug coin flip)",
      "train_n": 59,
      "test_n": 69,
      "base_mdale": 1.4328357645638476,
      "selected_mdale": 1.298441219727529,
      "v2_mdale": 1.3442454377929387,
      "shipped_mdale": 1.2086239416369615,
      "base_within_2x": 0.21739130434782608,
      "selected_within_2x": 0.2898550724637681,
      "steps": [
        {
          "term": "category",
          "label": "Category multiples (shrunk toward the global median)",
          "fitted_variant": "category medians, shrinkage K=5",
          "heldout_before": 1.4328357645638476,
          "heldout_after": 1.3912480364166449,
          "kept": true
        },
        {
          "term": "winsorise",
          "label": "Winsorised comparable ratios",
          "fitted_variant": "ratios clamped to [0.01, 5]",
          "heldout_before": 1.3912480364166449,
          "heldout_after": 1.3912480364166449,
          "kept": false
        },
        {
          "term": "scale",
          "label": "TVL elasticity (value scales as TVL^elasticity around $100M)",
          "fitted_variant": "elasticity 0.95",
          "heldout_before": 1.3912480364166449,
          "heldout_after": 1.3307919056519104,
          "kept": true
        },
        {
          "term": "momentum",
          "label": "Momentum (7-day TVL change)",
          "fitted_variant": "growth weight 0.3",
          "heldout_before": 1.3307919056519104,
          "heldout_after": 1.3134073856085067,
          "kept": true
        },
        {
          "term": "maturity",
          "label": "Maturity (time running with no token)",
          "fitted_variant": "base 0.88, span 0.24",
          "heldout_before": 1.3134073856085067,
          "heldout_after": 1.3195034178419505,
          "kept": false
        },
        {
          "term": "breadth",
          "label": "Breadth (chains served)",
          "fitted_variant": "+1.5% per extra chain",
          "heldout_before": 1.3134073856085067,
          "heldout_after": 1.298441219727529,
          "kept": true
        }
      ]
    },
    {
      "name": "B: time split (fit the past, test the future)",
      "train_n": 48,
      "test_n": 47,
      "excluded_n": 33,
      "base_mdale": 1.6694375973199822,
      "selected_mdale": 1.4776217085189352,
      "v2_mdale": 1.6100910282605714,
      "shipped_mdale": 1.4952714794339883,
      "base_within_2x": 0.2127659574468085,
      "selected_within_2x": 0.19148936170212766,
      "steps": [
        {
          "term": "category",
          "label": "Category multiples (shrunk toward the global median)",
          "fitted_variant": "category medians, shrinkage K=3",
          "heldout_before": 1.6694375973199822,
          "heldout_after": 1.6495118726192128,
          "kept": true
        },
        {
          "term": "winsorise",
          "label": "Winsorised comparable ratios",
          "fitted_variant": "ratios clamped to [0.01, 5]",
          "heldout_before": 1.6495118726192128,
          "heldout_after": 1.6495118726192128,
          "kept": false
        },
        {
          "term": "scale",
          "label": "TVL elasticity (value scales as TVL^elasticity around $100M)",
          "fitted_variant": "elasticity 0.9",
          "heldout_before": 1.6495118726192128,
          "heldout_after": 1.550810828196859,
          "kept": true
        },
        {
          "term": "momentum",
          "label": "Momentum (7-day TVL change)",
          "fitted_variant": "growth weight 0.3",
          "heldout_before": 1.550810828196859,
          "heldout_after": 1.5234266816765931,
          "kept": true
        },
        {
          "term": "maturity",
          "label": "Maturity (time running with no token)",
          "fitted_variant": "base 0.88, span 0.24",
          "heldout_before": 1.5234266816765931,
          "heldout_after": 1.4776217085189352,
          "kept": true
        },
        {
          "term": "breadth",
          "label": "Breadth (chains served)",
          "fitted_variant": "+1.5% per extra chain",
          "heldout_before": 1.4776217085189352,
          "heldout_after": 1.4776217085189352,
          "kept": false
        }
      ]
    }
  ],
  "shipped_terms": [
    "category",
    "scale",
    "momentum"
  ],
  "dropped_terms": [
    "winsorise",
    "maturity",
    "breadth"
  ],
  "refit": [
    {
      "term": "category",
      "variant": "category medians, shrinkage K=3",
      "combined_heldout_mdale": 2.934961820437678
    },
    {
      "term": "scale",
      "variant": "elasticity 0.9",
      "combined_heldout_mdale": 2.8498010183588782
    },
    {
      "term": "momentum",
      "variant": "growth weight 0.6",
      "combined_heldout_mdale": 2.8301529592787986
    }
  ],
  "full_fit_shipped_mdale": 1.2143453955245178,
  "full_fit_v2_mdale": 1.342837583965503
};
