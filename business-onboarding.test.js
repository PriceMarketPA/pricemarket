'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'business-onboarding.js'), 'utf8');

class FakeElement {
  constructor() {
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.required = false;
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this.listeners = {};
    this.classList = { add() {}, remove() {} };
    this.elements = {};
  }
  append(...children) { this.children.push(...children); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  querySelectorAll() { return []; }
  reportValidity() { return true; }
  reset() {}
  focus() {}
}

function setupSubmission({ enabled }) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new FakeElement());
    return nodes.get(id);
  };
  const form = get('businessProfileForm');
  const hoursEditor = get('hoursEditor');
  const happyFields = [
    'happyHourTitleInput', 'happyHourDescription', 'happyHourDays',
    'happyHourStartTime', 'happyHourEndTime', 'happyHourRestrictions'
  ];
  for (const id of happyFields) get(id).value = '';
  const inputValues = {
    businessNameInput: 'Test Neighborhood Cafe',
    businessCategory: 'Restaurant / Food',
    businessCity: 'Mechanicsburg',
    businessAddress: '10 Market Street',
    businessDescription: 'A friendly local cafe.',
    businessPhone: '717-555-0110',
    businessEmail: 'owner@example.test',
    businessWebsite: 'https://example.test',
    dealTitle: '',
    dealDescription: '',
    heroImage: '',
    logoImage: '',
    imageAlt: '',
    jobTitle: '',
    jobDescription: '',
    happyHourTitleInput: 'After-work special',
    happyHourDescription: 'Half-price appetizers.',
    happyHourDays: 'Monday – Thursday',
    happyHourStartTime: '16:30',
    happyHourEndTime: '18:00',
    happyHourRestrictions: 'Dine-in only.'
  };
  for (const [id, value] of Object.entries(inputValues)) get(id).value = value;
  get('includeHappyHour').checked = enabled;
  get('submissionConfirmation').hidden = true;

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  for (const day of days) {
    form.elements['hoursClosed-' + day] = { checked: false };
    form.elements['hoursOpen-' + day] = { value: '' };
    form.elements['hoursClose-' + day] = { value: '' };
  }

  let submittedPayload;
  const document = {
    getElementById: get,
    createElement: () => new FakeElement()
  };
  const fetch = async (_url, options) => {
    submittedPayload = JSON.parse(options.body);
    return { ok: true };
  };
  vm.runInNewContext(source, { document, fetch, URL, console, window: { initPmDropdowns() {}, validatePmDropdowns() { return true; } } });

  return {
    submit: async () => {
      await form.listeners.submit({ preventDefault() {} });
      return submittedPayload;
    },
    initialHoursRows: () => hoursEditor.children.map(row => row.innerHTML),
    timeOptions: id => get(id).children.map(option => ({ value: option.value, label: option.textContent })),
    confirmationState: () => ({ formHidden: form.hidden, confirmationHidden: get('submissionConfirmation').hidden, status: get('onboardingStatus').textContent })
  };
}

test('Happy Hour time selects offer readable quarter-hour labels with 24-hour values', () => {
  const flow = setupSubmission({ enabled: false });
  for (const id of ['happyHourStartTime', 'happyHourEndTime']) {
    const options = flow.timeOptions(id);
    assert.equal(options.length, 96);
    assert.deepEqual(options[12], { value: '03:00', label: '3:00 AM' });
    assert.deepEqual(options[60], { value: '15:00', label: '3:00 PM' });
    assert.deepEqual(options[72], { value: '18:00', label: '6:00 PM' });
    assert.deepEqual(options.at(-1), { value: '23:45', label: '11:45 PM' });
  }
});

test('Happy Hour submissions send six dedicated fields and retain reusable profileDataJson data', async () => {
  const payload = await setupSubmission({ enabled: true }).submit();
  assert.deepEqual(
    [
      payload.happyHourTitle,
      payload.happyHourDescription,
      payload.happyHourDays,
      payload.happyHourStartTime,
      payload.happyHourEndTime,
      payload.happyHourRestrictions
    ],
    [
      'After-work special',
      'Half-price appetizers.',
      'Monday – Thursday',
      '16:30',
      '18:00',
      'Dine-in only.'
    ]
  );
  const profileData = JSON.parse(payload.profileDataJson);
  assert.deepEqual(profileData.happyHours, [{
    title: 'After-work special',
    description: 'Half-price appetizers.',
    days: 'Monday – Thursday',
    startTime: '16:30',
    endTime: '18:00',
    restrictions: 'Dine-in only.'
  }]);
  assert.equal(payload.reviewStatus, 'Pending review');
  assert.equal(profileData.reviewStatus, 'Pending review');
});

test('Happy Hour-disabled submissions send blank dedicated fields and an empty profile array', async () => {
  const payload = await setupSubmission({ enabled: false }).submit();
  for (const field of [
    'happyHourTitle',
    'happyHourDescription',
    'happyHourDays',
    'happyHourStartTime',
    'happyHourEndTime',
    'happyHourRestrictions'
  ]) assert.equal(payload[field], '');
  assert.deepEqual(JSON.parse(payload.profileDataJson).happyHours, []);
  assert.equal(payload.reviewStatus, 'Pending review');
});

test('successful onboarding submission shows the pending-review confirmation state', async () => {
  const flow = setupSubmission({ enabled: false });
  await flow.submit();
  assert.deepEqual(flow.confirmationState(), {
    formHidden: true,
    confirmationHidden: false,
    status: 'Thanks — your profile submission is pending review. It has not been published.'
  });
});


test('Sunday business hours start open and enabled like the other weekdays', () => {
  const rows = setupSubmission({ enabled: false }).initialHoursRows();
  const sunday = rows.find(row => row.includes('class="hours-day">Sunday</strong>'));
  assert.ok(sunday, 'Sunday hours row is rendered');
  assert.match(sunday, /name="hoursOpen-Sunday" aria-label="Sunday opens at"/);
  assert.match(sunday, /name="hoursClose-Sunday" aria-label="Sunday closes at"/);
  assert.doesNotMatch(sunday, /<input type="time"[^>]*disabled/);
  assert.match(sunday, /name="hoursClosed-Sunday"/);
  assert.doesNotMatch(sunday.match(/name="hoursClosed-Sunday"[^>]*>/)[0], /checked/);
});
