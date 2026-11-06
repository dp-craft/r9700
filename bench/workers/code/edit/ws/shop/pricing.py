"""Price lookups."""
PRICES = {"apple": 100, "pear": 150}
HISTORY = {"apple": [90, 95, 100], "pear": [150]}


def get_price(sku, qty=1):
    """Return the total price of qty units of sku, in cents."""
    return PRICES[sku] * qty


def get_price_history(sku):
    """Return past unit prices of sku, oldest first."""
    return list(HISTORY[sku])
