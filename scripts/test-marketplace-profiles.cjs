'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this._textContent = '';
  }
  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }
  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

const html = fs.readFileSync('index.html', 'utf8');
const helpersStart = html.indexOf('function profileCategory(profile)');
const helpersEnd = html.indexOf('\nrenderProfiles();', helpersStart);
assert.notEqual(helpersStart, -1, 'profile rendering helpers should exist in index.html');
assert.notEqual(helpersEnd, -1, 'renderProfiles initialization should exist in index.html');
const renderingCode = html.slice(helpersStart, helpersEnd);

function render(profile) {
  const businessGrid = new MockElement('div');
  const jobGrid = new MockElement('div');
  const context = {
    businessGrid,
    jobGrid,
    window: { priceMarketBusinesses: { sample: profile } },
    document: { createElement: tagName => new MockElement(tagName) }
  };
  vm.runInNewContext(renderingCode + '\nrenderProfiles();', context);
  return { business: businessGrid.children[0], avatar: businessGrid.children[0].children[0], category: businessGrid.children[0].dataset.category, helpers: context };
}

const imageProfile = render({
  name: 'Image Example',
  avatarText: 'IE',
  category: 'Restaurant / Pizza',
  city: 'Harrisburg',
  logoImage: '',
  heroImage: { src: 'assets/example.jpg', alt: 'Example restaurant interior' },
  jobs: []
});
assert.equal(imageProfile.avatar.children.length, 1, 'profile image should remain inside the avatar');
assert.equal(imageProfile.avatar.children[0].tagName, 'img', 'the avatar should contain its image element');
assert.equal(imageProfile.avatar.children[0].src, 'assets/example.jpg');
assert.equal(imageProfile.avatar.textContent, '', 'initials must not replace an available image');
assert.equal(imageProfile.category, 'food', 'known restaurant categories keep the existing Food & drink mapping');

const otherProfile = render({
  name: 'Unmapped Example',
  avatarText: 'UE',
  category: 'Pet Care',
  city: 'Harrisburg',
  logoImage: '',
  heroImage: { src: '' },
  jobs: []
});
assert.equal(otherProfile.category, 'other', 'unmapped categories must use the general category');
assert.notEqual(otherProfile.category, 'food', 'unmapped categories must not be classified as Food & drink');
assert.equal(otherProfile.avatar.textContent, 'UE', 'initials remain the fallback when no image source exists');
assert.match(html, /data-category-filter="other"[^>]*>[^<]*◇ <span>Other local<\/span>/, 'the general category must be available in the marketplace filter controls');

console.log('PASS marketplace profile avatar image preservation and general category fallback.');
