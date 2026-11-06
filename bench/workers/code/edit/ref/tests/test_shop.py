from shop.api import call
from shop.cart import cart_total
from shop.pricing import unit_price


def test_unit_price():
    assert unit_price("apple", 2) == 200


def test_cart():
    assert cart_total([("apple", 1), ("pear", 2)]) == 400


def test_route():
    assert call("get_price", "pear") == 150
