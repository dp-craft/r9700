# Bug report

A user says `rolling_median` gives wrong numbers on a dashboard:

- `rolling_median([1, 2, 3, 4], 2)` should give `[1.5, 2.5, 3.5]`, but `tests/test_movstats.py::test_rolling_median_reported` fails.
- After that call, they say a chart for a different series showed the old series' numbers, with the same window size.

Fix the root causes in `movstats.py`. `rolling_max` works and must not change. Keep the public signature `rolling_median(values, window)` usable with those two arguments.
