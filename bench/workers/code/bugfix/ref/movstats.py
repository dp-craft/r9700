"""Rolling statistics over a list of numbers."""


def _median(window):
    s = sorted(window)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def rolling_median(values, window):
    """Median of each full window. Returns one number per window, oldest first."""
    if window < 1:
        raise ValueError("window must be >= 1")
    out = []
    for i in range(len(values) - window + 1):
        out.append(_median(values[i : i + window]))
    return out


def rolling_max(values, window):
    """Largest number of each full window, oldest first."""
    if window < 1:
        raise ValueError("window must be >= 1")
    return [max(values[i : i + window]) for i in range(len(values) - window + 1)]
