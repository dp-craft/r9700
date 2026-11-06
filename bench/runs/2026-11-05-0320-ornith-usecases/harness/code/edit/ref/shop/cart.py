"""Cart totals."""
from .pricing import unit_price


def line_total(sku, qty, *, currency="EUR"):
    return unit_price(sku, qty, currency=currency)


def cart_total(items, *, currency="EUR"):
    """items: list of (sku, qty)."""
    return sum(line_total(sku, qty, currency=currency) for sku, qty in items)
