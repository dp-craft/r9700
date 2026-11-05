"""Plain text reports."""
from . import pricing


def price_line(sku):
    # unit_price is in cents; show it as is
    return f"{sku}: {pricing.unit_price(sku)}"


def history_line(sku):
    return f"{sku}: {pricing.get_price_history(sku)}"
