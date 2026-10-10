const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'campaigns', 'e2b-alternative.js'),
  'utf8'
);

function adsDateUtilities() {
  return {
    formatDate(date, timeZone, pattern) {
      assert.equal(pattern, 'yyyy-MM-dd');
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    }
  };
}

function evaluateBuild(now, timeZone) {
  const context = vm.createContext({ Utilities: adsDateUtilities() });
  const serialized = vm.runInContext(
    `${source}\nJSON.stringify({ plan: PLAN, operations: buildOperations(new Date(${JSON.stringify(now)}), ${JSON.stringify(timeZone)}), dates: buildDateRange(new Date(${JSON.stringify(now)}), ${JSON.stringify(timeZone)}) })`,
    context
  );
  return JSON.parse(serialized);
}

function operationOfType(operations, key) {
  return operations.filter((operation) => operation[key]).map((operation) => operation[key].create);
}

function repairFixture() {
  const { operations } = evaluateBuild('2026-10-06T12:00:00Z', 'Etc/UTC');
  const groups = operationOfType(operations, 'adGroupOperation');
  const criteria = operationOfType(operations, 'adGroupCriterionOperation').map((create, index) => ({
    ...create, resourceName: `customers/3086077433/adGroupCriteria/300~${index + 1}`
  }));
  return { groups, criteria };
}

function setupMain(options = {}) {
  const logs = [];
  const mutations = [];
  const queries = [];
  const account = {
    getCustomerId: () => options.customerId || '308-607-7433',
    getCurrencyCode: () => options.currency || 'USD',
    getTimeZone: () => options.timeZone || 'America/Los_Angeles'
  };
  const sandbox = {
    Utilities: adsDateUtilities(),
    Logger: { log: (message) => logs.push(String(message)) },
    AdsApp: {
      currentAccount: () => account,
      search: (query) => {
        queries.push(query);
        let rows = [];
        if (query.includes('FROM campaign')) rows = options.campaigns || [];
        else if (query.includes('FROM ad_group_criterion')) {
          rows = (options.criteria || []).map((adGroupCriterion) => ({ adGroupCriterion }));
        } else if (query.includes('FROM ad_group')) {
          rows = (options.groups || []).map((adGroup) => ({ adGroup }));
        } else throw new Error('Unexpected query: ' + query);
        let index = 0;
        return { hasNext: () => index < rows.length, next: () => rows[index++] };
      },
      getExecutionInfo: () => ({ isPreview: () => Boolean(options.preview) }),
      mutateAll: (operations, requestOptions) => {
        mutations.push({ operations, requestOptions });
        return operations.map((_, index) => ({
          isSuccessful: () => options.failedIndex !== index,
          getErrorMessages: () => options.failedIndex === index ? ['simulated mutation failure'] : []
        }));
      }
    }
  };
  return { context: vm.createContext(sandbox), logs, mutations, queries };
}

test('builds the seven-day schedule using account dates across DST and year boundaries', () => {
  const dst = evaluateBuild('2026-03-07T12:00:00Z', 'America/Los_Angeles');
  assert.deepEqual(dst.dates, {
    startDateTime: '2026-03-08 00:00:00',
    endDateTime: '2026-03-14 23:59:59'
  });
  const yearEnd = evaluateBuild('2026-12-31T18:00:00Z', 'Etc/UTC');
  assert.deepEqual(yearEnd.dates, {
    startDateTime: '2027-01-01 00:00:00',
    endDateTime: '2027-01-07 23:59:59'
  });
});

test('builds a paused US Search campaign with budget, targeting, keywords and assets', () => {
  const { plan, operations } = evaluateBuild('2026-10-06T12:00:00Z', 'America/Los_Angeles');
  const budget = operationOfType(operations, 'campaignBudgetOperation')[0];
  const campaign = operationOfType(operations, 'campaignOperation')[0];
  const adGroups = operationOfType(operations, 'adGroupOperation');
  const positiveKeywords = operationOfType(operations, 'adGroupCriterionOperation');
  const campaignCriteria = operationOfType(operations, 'campaignCriterionOperation');
  const assets = operationOfType(operations, 'assetOperation');
  const campaignAssets = operationOfType(operations, 'campaignAssetOperation');

  assert.equal(plan.expectedCustomerId, '3086077433');
  assert.equal(plan.campaignName, 'Mainbrella | E2B Alternatives | US | 7 days');
  assert.equal(plan.landingPage, 'https://mainbrella.com/e2b-alternative/');
  assert.ok(plan.finalUrlSuffixBase.includes('utm_campaign=e2b_alternative_us_7d'));
  assert.equal(budget.totalAmountMicros, '350000000');
  assert.equal(budget.period, 'CUSTOM_PERIOD');
  assert.equal(budget.explicitlyShared, false);
  assert.equal(campaign.status, 'PAUSED');
  assert.equal(campaign.advertisingChannelType, 'SEARCH');
  assert.equal(campaign.startDateTime, '2026-10-07 00:00:00');
  assert.equal(campaign.endDateTime, '2026-10-13 23:59:59');
  assert.equal(campaign.targetSpend.cpcBidCeilingMicros, '3000000');
  assert.deepEqual(campaign.networkSettings, {
    targetGoogleSearch: true,
    targetSearchNetwork: true,
    targetPartnerSearchNetwork: false,
    targetContentNetwork: false
  });
  assert.deepEqual(campaign.geoTargetTypeSetting, {
    positiveGeoTargetType: 'PRESENCE',
    negativeGeoTargetType: 'PRESENCE'
  });
  assert.equal(campaign.aiMaxSetting.enableAiMax, false);
  assert.equal(campaign.containsEuPoliticalAdvertising, 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING');
  assert.equal(adGroups.length, 2);
  assert.equal(positiveKeywords.length, 18);
  assert.equal(campaignCriteria.filter((criterion) => criterion.location).length, 1);
  assert.equal(campaignCriteria.filter((criterion) => criterion.language).length, 1);
  const negativeKeywords = campaignCriteria.filter((criterion) => criterion.negative);
  assert.equal(negativeKeywords.length, 18);
  assert.deepEqual(negativeKeywords.map((criterion) => criterion.keyword.text), plan.negatives);
  assert.ok(negativeKeywords.every((criterion) => criterion.keyword.matchType === 'PHRASE'));
  assert.ok(!plan.negatives.some((keyword) => ['beach', 'beaches', 'car', 'cars', 'motorcycle', 'hotel', 'ticket', 'concert'].includes(keyword)));
  assert.equal(assets.length, 4);
  assert.equal(campaignAssets.length, 4);
  assert.ok(positiveKeywords.every((criterion) => criterion.finalUrlSuffix.includes('utm_term=')));
  // Keyword tracking overrides require their own final URL, even when the ad has one.
  assert.ok(positiveKeywords.every((criterion) =>
    criterion.finalUrls.length === 1 && criterion.finalUrls[0] === plan.landingPage));
  assert.ok(positiveKeywords.every((criterion) => criterion.finalUrlSuffix.includes('mb_matchtype={matchtype}')));
  assert.ok(positiveKeywords.every((criterion) => criterion.finalUrlSuffix.includes('utm_campaign=e2b_alternative_us_7d')));
  assert.ok(positiveKeywords.every((criterion) => !criterion.finalUrlSuffix.includes('daytona')));
  assert.ok(positiveKeywords.every((criterion) => !criterion.keyword.text.toLowerCase().includes('daytona')));
  assert.ok(!positiveKeywords.some((criterion) => criterion.keyword.text.toLowerCase() === 'e2b'));
  assert.ok(adGroups.every((group) => !group.finalUrlSuffix.includes('utm_term=')));
  assert.ok(positiveKeywords.every((criterion) => ['EXACT', 'PHRASE'].includes(criterion.keyword.matchType)));
  assert.ok(positiveKeywords.every((criterion) => {
    const parameters = new URLSearchParams(criterion.finalUrlSuffix);
    return /^[a-zA-Z0-9_-]{1,80}$/.test(parameters.get('utm_term'));
  }));
});

test('keeps all search copy and callouts within platform limits', () => {
  const { plan } = evaluateBuild('2026-10-06T12:00:00Z', 'Etc/UTC');
  for (const group of plan.groups) {
    assert.ok(group.headlines.length <= 15);
    assert.ok(group.headlines.every((headline) => headline.length <= 30));
    assert.ok(group.descriptions.length <= 4);
    assert.ok(group.descriptions.every((description) => description.length <= 90));
  }
  assert.ok(plan.callouts.every((callout) => callout.length <= 25));
});

test('refuses the wrong account or currency before searching or mutating', () => {
  for (const overrides of [
    { customerId: '999-111-2222' },
    { currency: 'CAD' }
  ]) {
    const { context, mutations } = setupMain(overrides);
    assert.throws(() => vm.runInContext(`${source}\nmain()`, context));
    assert.equal(mutations.length, 0);
  }
});

test('does not recreate a campaign whose keywords are already correct', () => {
  const fixture = repairFixture();
  const { context, logs, mutations, queries } = setupMain({
    campaigns: [{ campaign: { resourceName: 'customers/3086077433/campaigns/200', status: 'PAUSED' } }],
    groups: fixture.groups, criteria: fixture.criteria
  });
  vm.runInContext(`${source}\nmain()`, context);
  assert.equal(mutations.length, 0);
  assert.ok(logs.some((line) => line.includes('already have the correct final URL')));
  assert.ok(queries[0].includes('Mainbrella | E2B Alternatives | US | 7 days'));
  assert.ok(!queries[0].includes('Daytona'));
});

test('repairs all 18 missing keywords without recreating campaign, ads or budget', () => {
  const fixture = repairFixture();
  const { context, logs, mutations } = setupMain({
    campaigns: [{ campaign: { resourceName: 'customers/3086077433/campaigns/200', status: 'PAUSED' } }],
    groups: fixture.groups
  });
  vm.runInContext(`${source}\nmain()`, context);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].operations.length, 18);
  assert.ok(mutations[0].operations.every((operation) =>
    operation.adGroupCriterionOperation.create.finalUrls[0] === 'https://mainbrella.com/e2b-alternative/'));
  assert.equal(mutations[0].requestOptions.partialFailure, false);
  assert.ok(mutations[0].operations.every((operation) =>
    operation.adGroupCriterionOperation.create.finalUrlSuffix.includes('utm_campaign=e2b_alternative_us_7d')));
  assert.ok(logs.some((line) => line.includes('Campaign remains paused')));
});

test('repair updates broken keyword URLs, adds missing keywords, and skips correct ones', () => {
  const { groups, criteria } = repairFixture();
  const existing = criteria.slice(0, 9);
  delete existing[0].finalUrls;
  const context = vm.createContext({ groups, criteria: existing });
  const operations = JSON.parse(vm.runInContext(
    source + '\nJSON.stringify(buildKeywordRepairOperations(groups, criteria))', context));
  assert.equal(operations.length, 10);
  const update = operations[0].adGroupCriterionOperation;
  assert.equal(update.update.resourceName, existing[0].resourceName);
  assert.equal(update.updateMask, 'finalUrls,finalUrlSuffix');
  assert.deepEqual(Object.keys(update.update).sort(), ['finalUrlSuffix', 'finalUrls', 'resourceName']);
  const creates = operationOfType(operations, 'adGroupCriterionOperation').filter(Boolean);
  assert.equal(creates.length, 9);
  assert.ok(creates.every((create) => create.finalUrls[0] === 'https://mainbrella.com/e2b-alternative/'));
  assert.ok(creates.every((create) => create.finalUrlSuffix.includes('utm_campaign=e2b_alternative_us_7d')));
});

test('refuses repair of an active campaign or ambiguous campaign names', () => {
  for (const campaigns of [
    [{ campaign: { resourceName: 'customers/3086077433/campaigns/200', status: 'ENABLED' } }],
    [{ campaign: {} }, { campaign: {} }]
  ]) {
    const { context, mutations } = setupMain({ campaigns });
    assert.throws(() => vm.runInContext(source + '\nmain()', context));
    assert.equal(mutations.length, 0);
  }
});

test('refuses incomplete or ambiguous existing ad groups before any repair writes', () => {
  const fixture = repairFixture();
  for (const groups of [fixture.groups.slice(0, 1), [...fixture.groups, fixture.groups[0]]]) {
    const { context, mutations } = setupMain({
      campaigns: [{ campaign: { resourceName: 'customers/3086077433/campaigns/200', status: 'PAUSED' } }],
      groups
    });
    assert.throws(() => vm.runInContext(source + '\nmain()', context), /Expected one existing ad group/);
    assert.equal(mutations.length, 0);
  }
});

test('submits one atomic V25 mutateAll request and reports preview without claiming creation', () => {
  const { context, logs, mutations } = setupMain({ preview: true });
  vm.runInContext(`${source}\nmain()`, context);
  assert.equal(mutations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(mutations[0].requestOptions)), {
    apiVersion: 'V25',
    partialFailure: false
  });
  assert.ok(logs.some((line) => line.includes('Preview completed')));
  assert.ok(!logs.some((line) => line.includes('Campaign created')));
});

test('throws on any failed mutation result and never logs successful creation', () => {
  const { context, logs, mutations } = setupMain({ failedIndex: 4 });
  assert.throws(() => vm.runInContext(`${source}\nmain()`, context), /simulated mutation failure/);
  assert.equal(mutations.length, 1);
  assert.ok(!logs.some((line) => line.includes('Campaign created')));
});

test('rejects missing or unfamiliar mutation results instead of claiming success', () => {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  for (const results of [[], [null], [{}], [{ success: true }]]) {
    context.results = results;
    assert.throws(() => vm.runInContext('assertMutationResults(results, 1)', context));
  }
});
