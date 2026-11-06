"""Route table. Route names are public and clients depend on them."""
from .pricing import get_price_history, unit_price

ROUTES = {
    "get_price": unit_price,
    "get_price_history": get_price_history,
}


def call(route, *args, **kwargs):
    return ROUTES[route](*args, **kwargs)
