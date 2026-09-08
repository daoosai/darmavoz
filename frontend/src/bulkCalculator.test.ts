import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateBulk, formatBulk } from './bulkCalculator';

const input = { length: '10', width: '10', thickness: '50', thicknessUnit: 'cm' as const, capacity: '20' };
test('volume, mass and loading remainder', () => {
  assert.deepEqual(calculateBulk({ ...input, density: '1,5' }), { volume: 50, mass: 75, capacity: 20, loads: 3, lastLoad: 10 });
  assert.equal(calculateBulk(input).mass, null);
  assert.deepEqual(calculateBulk(input), calculateBulk({ ...input, thickness: '0,5', thicknessUnit: 'm' }));
});
test('exact multiples and positive excess are distinguished', () => {
  assert.equal(calculateBulk({ ...input, thickness: '40' }).loads, 2);
  assert.equal(calculateBulk({ ...input, thickness: '40.00000000000000001' }).loads, 3);
  assert.equal(calculateBulk({ ...input, thickness: '1' }).loads, 1);
  assert.equal(calculateBulk({ ...input, length: '.1', width: '.2', thickness: '30', capacity: '.006' }).loads, 1);
});
test('invalid and overflowing inputs', () => {
  for (const value of ['', ' ', '0', '-1', 'NaN', 'Infinity', 'abc', '1,2.3']) {
    for (const field of ['length', 'width', 'thickness', 'capacity']) assert.throws(() => calculateBulk({ ...input, [field]: value }));
  }
  assert.throws(() => calculateBulk({ ...input, density: '-1' }));
  assert.throws(() => calculateBulk({ ...input, length: '9'.repeat(200), width: '9'.repeat(200) }));
  assert.throws(() => calculateBulk({ ...input, capacity: '0.' + '0'.repeat(30) + '1' }));
});
test('display preserves small positive values', () => {
  assert.equal(formatBulk(0.0001), '< 0,001');
  assert.equal(formatBulk(50), '50');
  assert.equal(formatBulk(1.23456), '1,235');
});
