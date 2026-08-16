// graphwar-ai :: expression parser
// the solver has to simulate the *string* it tells you to type, not some
// internal closure that happens to resemble it. so every candidate is emitted
// as Graphwar-syntax source and compiled back through this parser before it is
// ever traced. what you paste into the game is what was simulated.

const CONSTANTS = { pi: Math.PI, e: Math.E };

const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs,
  sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  ln: Math.log, log: Math.log10,
};

const BINARY_FUNCTIONS = { min: Math.min, max: Math.max, mod: (a, b) => a % b, atan2: Math.atan2 };

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      // scientific notation: 1e-3, 2.5E6
      if (/[eE]/.test(src[j] || '') && /[0-9+-]/.test(src[j + 1] || '')) {
        j += 2;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      const text = src.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new SyntaxError(`bad number "${text}"`);
      out.push({ type: 'num', value });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      out.push({ type: 'name', value: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/^%(),'.includes(c)) { out.push({ type: c }); i++; continue; }
    throw new SyntaxError(`unexpected character "${c}" at ${i}`);
  }
  out.push({ type: 'end' });
  return out;
}

/**
 * Parse Graphwar-flavoured source into a closure of one variable.
 * Grammar: expr := term (('+'|'-') term)* ; term := unary (('*'|'/'|'%') unary)*
 *          unary := ('-'|'+') unary | power ; power := atom ('^' unary)?
 * `^` is right-associative and binds tighter than unary minus, so -x^2 is -(x^2).
 */
export function compile(source) {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (type) => {
    if (tokens[pos].type !== type) throw new SyntaxError(`expected ${type}, got ${tokens[pos].type}`);
    return tokens[pos++];
  };

  function parseExpr() {
    let node = parseTerm();
    for (;;) {
      const t = peek().type;
      if (t !== '+' && t !== '-') return node;
      pos++;
      const rhs = parseTerm();
      const lhs = node;
      node = t === '+' ? (x) => lhs(x) + rhs(x) : (x) => lhs(x) - rhs(x);
    }
  }

  function parseTerm() {
    let node = parseUnary();
    for (;;) {
      const t = peek().type;
      if (t !== '*' && t !== '/' && t !== '%') return node;
      pos++;
      const rhs = parseUnary();
      const lhs = node;
      node = t === '*' ? (x) => lhs(x) * rhs(x)
        : t === '/' ? (x) => lhs(x) / rhs(x)
          : (x) => lhs(x) % rhs(x);
    }
  }

  function parseUnary() {
    const t = peek().type;
    if (t === '-') { pos++; const inner = parseUnary(); return (x) => -inner(x); }
    if (t === '+') { pos++; return parseUnary(); }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (peek().type !== '^') return base;
    pos++;
    const exponent = parseUnary();
    return (x) => Math.pow(base(x), exponent(x));
  }

  function parseAtom() {
    const t = peek();
    if (t.type === 'num') { pos++; return () => t.value; }
    if (t.type === '(') { pos++; const inner = parseExpr(); eat(')'); return inner; }
    if (t.type === 'name') {
      pos++;
      const name = t.value;
      if (name === 'x') return (x) => x;
      if (name in CONSTANTS) return () => CONSTANTS[name];
      if (peek().type === '(') {
        pos++;
        const args = [parseExpr()];
        while (peek().type === ',') { pos++; args.push(parseExpr()); }
        eat(')');
        if (args.length === 1 && name in FUNCTIONS) {
          const fn = FUNCTIONS[name];
          const a = args[0];
          return (x) => fn(a(x));
        }
        if (args.length === 2 && name in BINARY_FUNCTIONS) {
          const fn = BINARY_FUNCTIONS[name];
          const [a, b] = args;
          return (x) => fn(a(x), b(x));
        }
        throw new SyntaxError(`unknown function "${name}" with ${args.length} argument(s)`);
      }
      throw new SyntaxError(`unknown name "${name}"`);
    }
    throw new SyntaxError(`unexpected ${t.type}`);
  }

  const fn = parseExpr();
  eat('end');
  return fn;
}

/** Round to `places` and print without trailing zeros — keeps sources typable. */
export function fmt(n, places = 4) {
  if (!Number.isFinite(n)) return String(n);
  const r = Number(n.toFixed(places));
  return Object.is(r, -0) ? '0' : String(r);
}

/** Round the way fmt() prints, so a coefficient and its printed form agree. */
export function round(n, places = 4) {
  return Number(Number(n).toFixed(places));
}

/** `a` and `+a` / `-a` joined into a term list without doubled signs. */
export function joinTerms(parts) {
  return parts.filter(Boolean).reduce((acc, p) => {
    if (!acc) return p;
    return p.startsWith('-') ? `${acc}${p}` : `${acc}+${p}`;
  }, '');
}
