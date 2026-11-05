import inspect
import pytest
from shop import cart, pricing, report
from shop.api import ROUTES, call


def test_renamed():
    assert hasattr(pricing, "unit_price") and not hasattr(pricing, "get_price")

def test_history_kept():
    assert pricing.get_price_history("apple") == [90, 95, 100]

def test_kwonly():
    p = inspect.signature(pricing.unit_price).parameters["currency"]
    assert p.kind is p.KEYWORD_ONLY and p.default == "EUR"

def test_value():
    assert pricing.unit_price("pear", 2) == 300 and pricing.unit_price("pear", 2, currency="EUR") == 300

def test_bad_currency():
    with pytest.raises(ValueError):
        pricing.unit_price("pear", currency="USD")

def test_cart_passes():
    with pytest.raises(ValueError):
        cart.cart_total([("pear", 1)], currency="USD")
    with pytest.raises(ValueError):
        cart.line_total("pear", 1, currency="USD")

def test_cart_kwonly():
    for f in (cart.line_total, cart.cart_total):
        p = inspect.signature(f).parameters["currency"]
        assert p.kind is p.KEYWORD_ONLY and p.default == "EUR"

def test_routes():
    assert set(ROUTES) == {"get_price", "get_price_history"} and ROUTES["get_price"] is pricing.unit_price
    assert call("get_price", "apple") == 100

def test_report():
    assert report.price_line("apple") == "apple: 100" and report.history_line("pear") == "pear: [150]"
