// FILE: impl.ts

export type Result =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string };

type Token = { type: 'number' | 'op' | 'lparen' | 'rparen'; value: string };

function tokenize(expr: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
    } else if ('+-*/'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
    } else if (/\d/.test(ch)) {
      let num = '';
      while (i < expr.length && /\d/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'number', value: num });
    } else {
      return `Unexpected character: ${ch}`;
    }
  }
  return tokens;
}

export function evaluate(expr: string): Result {
  const tokensOrError = tokenize(expr);
  if (typeof tokensOrError === 'string') {
    return { ok: false, error: tokensOrError };
  }

  const tokens = tokensOrError;
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function advance(): Token | undefined {
    return tokens[pos++];
  }

  function expression(): number | string {
    const left = term();
    if (typeof left === 'string') return left;

    let result = left;
    let token = peek();
    while (token && token.type === 'op' && '+-'.includes(token.value)) {
      const op = token.value;
      advance();
      const right = term();
      if (typeof right === 'string') return right;
      result = op === '+' ? result + right : result - right;
      token = peek();
    }
    return result;
  }

  function term(): number | string {
    const left = factor();
    if (typeof left === 'string') return left;

    let result = left;
    let token = peek();
    while (token && token.type === 'op' && '*/'.includes(token.value)) {
      const op = token.value;
      advance();
      const right = factor();
      if (typeof right === 'string') return right;
      if (op === '/' && right === 0) {
        return 'Division by zero';
      }
      result = op === '*' ? result * right : Math.floor(result / right);
      token = peek();
    }
    return result;
  }

  function factor(): number | string {
    const token = peek();
    if (!token) return 'Unexpected end of input';

    if (token.type === 'number') {
      advance();
      return parseInt(token.value, 10);
    }

    if (token.type === 'lparen') {
      advance();
      const result = expression();
      if (typeof result === 'string') return result;
      if (!peek() || peek().type !== 'rparen') {
        return 'Unbalanced parentheses';
      }
      advance();
      return result;
    }

    return 'Expected number or expression';
  }

  const result = expression();
  if (typeof result === 'string') return { ok: false, error: result };
  if (peek()) return { ok: false, error: 'Unexpected token after expression' };

  return { ok: true, value: result };
}
