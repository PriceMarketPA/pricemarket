'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatCopyright } = require('../copyright');

test('copyright starts at 2026 and adds the current year from 2027 onward', () => {
  assert.equal(formatCopyright(2026), '© 2026 Price Market LLC. All rights reserved.');
  assert.equal(formatCopyright(2027), '© 2026–2027 Price Market LLC. All rights reserved.');
  assert.equal(formatCopyright(2032), '© 2026–2032 Price Market LLC. All rights reserved.');
});

test('every existing copyright footer uses the shared current-year script', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['index.html', 'business-onboarding.html', 'business-profile.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /data-copyright-year/);
    assert.match(html, /<script src="\/copyright\.js"><\/script>/);
    assert.doesNotMatch(html, /© 2026 Price Market<\/span>/);
  }
});
