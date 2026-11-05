# Change request

1. Rename the function `get_price` in `shop/pricing.py` to `unit_price`, and update every caller, comment, test and doc that refers to it.
2. Add a keyword-only parameter `currency="EUR"` to `unit_price`. It returns the same cents number for "EUR" and raises `ValueError` for any other currency.
3. Add a keyword-only parameter `currency="EUR"` to `line_total` and `cart_total` in `shop/cart.py`, and pass it down to `unit_price`.

Keep these unchanged:
- `get_price_history` is a different function. Do not rename it.
- The route name strings in `shop/api.py` are public. The route `"get_price"` keeps its name and now points at `unit_price`.
- `vendor/` must not be edited.
