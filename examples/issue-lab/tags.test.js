import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTags } from './tags.js';

test('normalizes case and whitespace', () => assert.deepEqual(normalizeTags([' React ', 'NODE']), ['react', 'node']));
test('removes empty tags', () => assert.deepEqual(normalizeTags(['', ' ', 'js']), ['js']));
test('deduplicates after normalization, preserving order', () => assert.deepEqual(normalizeTags(['Node', 'react', ' node ', 'REACT']), ['node', 'react']));
test('does not change the input', () => { const tags = ['B', 'a', 'B']; const before = [...tags]; normalizeTags(tags); assert.deepEqual(tags, before); });
