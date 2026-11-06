"""Cart totals."""
from .pricing import get_price


def line_total(sku, qty):
    return get_price(sku, qty)


def cart_total(items):
    """items: list of (sku, qty)."""
    return sum(line_total(sku, qty) for sku, qty in items)
