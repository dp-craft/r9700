from movstats import rolling_max, rolling_median


def test_rolling_max():
    assert rolling_max([1, 3, 2], 2) == [3, 3]


def test_rolling_median_reported():
    assert rolling_median([1, 2, 3, 4], 2) == [1.5, 2.5, 3.5]
