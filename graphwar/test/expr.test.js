import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, fmt, joinTerms } from '../src/expr.js';

const at = (src, x) => compile(src)(x);

test('arithmetic and precedence', () => {
  assert.equal(at('1+2*3', 0), 7);
  assert.equal(at('(1+2)*3', 0), 9);
  assert.equal(at('2*x', 4), 8);
  assert.equal(at('x/4', 10), 2.5);
});

test('power is right-associative and outranks unary minus', () => {
  assert.equal(at('2^3^2', 0), 512);
  assert.equal(at('-x^2', 3), -9);
  assert.equal(at('(-x)^2', 3), 9);
});

test('functions and constants', () => {
  assert.ok(Math.abs(at('sin(pi/2)', 0) - 1) < 1e-12);
  assert.ok(Math.abs(at('ln(e)', 0) - 1) < 1e-12);
  assert.equal(at('abs(0-x)', 5), 5);
  assert.equal(at('max(x,3)', 1), 3);
  assert.equal(at('tanh(0)', 0), 0);
});

test('scientific notation and decimals', () => {
  assert.equal(at('1e-3*x', 1000), 1);
  assert.equal(at('0.5*x', 3), 1.5);
});

test('rejects nonsense instead of guessing', () => {
  assert.throws(() => compile('2*'), SyntaxError);
  assert.throws(() => compile('foo(x)'), SyntaxError);
  assert.throws(() => compile('x $ 2'), SyntaxError);
  assert.throws(() => compile('sin(x'), SyntaxError);
  assert.throws(() => compile('1 2'), SyntaxError);
});

test('fmt keeps sources typable', () => {
  assert.equal(fmt(0.123456), '0.1235');
  assert.equal(fmt(-0.00001), '0');
  assert.equal(fmt(3), '3');
});

test('joinTerms never doubles a sign', () => {
  assert.equal(joinTerms(['2*x', '-3']), '2*x-3');
  assert.equal(joinTerms(['2*x', '3']), '2*x+3');
  assert.equal(joinTerms(['', '3']), '3');
});
