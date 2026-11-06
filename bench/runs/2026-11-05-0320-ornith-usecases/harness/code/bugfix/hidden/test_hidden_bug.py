import inspect
from movstats import _median, rolling_max, rolling_median


def test_reported():
    assert rolling_median([1, 2, 3, 4], 2) == [1.5, 2.5, 3.5]

def test_stale_cache():
    assert rolling_median([1, 2, 3], 2) == [1.5, 2.5]
    assert rolling_median([10, 20, 30], 2) == [15, 25]

def test_odd_window():
    assert rolling_median([5, 1, 3, 2], 3) == [3, 2]

def test_last_window_present():
    assert rolling_median([1, 2, 3], 3) == [2]

def test_window_one():
    assert rolling_median([7, 8], 1) == [7, 8]

def test_too_short():
    assert rolling_median([1], 2) == []

def test_unsorted_even():
    assert rolling_median([4, 1, 3, 2], 4) == [2.5]

def test_median_helper():
    assert _median([1, 2]) == 1.5

def test_no_mutable_cache_default():
    for p in inspect.signature(rolling_median).parameters.values():
        assert not isinstance(p.default, (dict, list))

def test_input_not_changed():
    v = [3, 1, 2]
    rolling_median(v, 2)
    assert v == [3, 1, 2]

def test_max_unchanged():
    assert rolling_max([1, 3, 2], 2) == [3, 3]
