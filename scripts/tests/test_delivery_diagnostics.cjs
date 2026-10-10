const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'campaigns', 'diagnose-delivery.js'),
  'utf8'
);
const expectedNames = [
  'Mainbrella | Cloudflare Sandboxes | US | 7 days',
  'Mainbrella | E2B Alternatives | US | 7 days',
  'Mainbrella | Daytona Alternatives | US | 7 days',
  'Mainbrella | Open Source Sandboxes | US | 7 days'
];

function setup(options = {}) {
  const queries = [];
  const logs = [];
  const rowsFor = (query) => {
    if (query.includes('FROM campaign') && query.includes('metrics.impressions')) {
      return (options.metrics || []).map((metrics) => ({ campaign: { id: metrics.id, name: metrics.name }, metrics }));
    }
    if (query.includes('FROM campaign')) return (options.campaigns || []).map((campaign) => ({ campaign }));
    if (query.includes('FROM ad_group_ad')) return (options.ads || []);
    throw new Error('Unexpected query: ' + query);
  };
  const context = vm.createContext({
    AdsApp: {
      currentAccount: () => ({
        getCustomerId: () => options.customerId || '308-607-7433',
        getCurrencyCode: () => 'USD',
        getTimeZone: () => 'America/Los_Angeles'
      }),
      search: (query, options) => {
        assert.equal(options.apiVersion, 'v25');
        queries.push(query);
        const values = rowsFor(query);
        let index = 0;
        return { hasNext: () => index < values.length, next: () => values[index++] };
      }
    },
    Logger: { log: (value) => logs.push(String(value)) }
  });
  return { context, queries, logs };
}

test('refuses another account before any report query', () => {
  const { context, queries } = setup({ customerId: '123-456-7890' });
  assert.throws(() => vm.runInContext(source + '\nmain()', context), /Wrong Google Ads account/);
  assert.equal(queries.length, 0);
});

test("reports campaign status, today's metrics, RSA policy, missing rows, and read-only queries", () => {
  const campaigns = expectedNames.slice(0, 3).map((name, index) => ({
    id: String(24320000000 + index),
    name,
    status: 'ENABLED',
    primaryStatus: index ? 'LIMITED' : 'ELIGIBLE',
    primaryStatusReasons: index ? ['POLICY'] : [],
    servingStatus: index ? 'NOT_SERVING' : 'SERVING',
    biddingStrategyType: 'TARGET_SPEND',
    targetSpend: { cpcBidCeilingMicros: '3000000' }
  }));
  campaigns[1].targetSpend = {};
  const ads = [{
    campaign: { id: campaigns[0].id },
    adGroup: { name: 'Cloudflare Sandboxes', status: 'ENABLED' },
    adGroupAd: {
      ad: { id: '555', type: 'RESPONSIVE_SEARCH_AD' },
      status: 'ENABLED',
      primaryStatus: 'ELIGIBLE',
      primaryStatusReasons: [],
      policySummary: {
        reviewStatus: 'REVIEWED',
        approvalStatus: 'APPROVED',
        policyTopicEntries: [{ topic: 'TRADEMARKS', type: 'LIMITED' }]
      }
    }
  }];
  const { context, queries, logs } = setup({
    campaigns,
    metrics: [{ id: campaigns[0].id, name: campaigns[0].name, impressions: 0, clicks: 0, costMicros: '0' }],
    ads
  });
  vm.runInContext(source + '\nmain()', context);

  assert.equal(queries.length, 3);
  assert.ok(queries[0].includes('campaign.primary_status_reasons'));
  assert.ok(queries[1].includes('segments.date DURING TODAY'));
  assert.ok(queries[2].includes('ad_group_ad.policy_summary.policy_topic_entries'));
  assert.ok(queries.every((query) => query.includes('FROM ')));
  assert.ok(queries.every((query) => /^SELECT /i.test(query)));
  const report = JSON.parse(logs[0]);
  assert.equal(report.customerId, '3086077433');
  assert.equal(report.currency, 'USD');
  assert.equal(report.campaigns.length, 4);
  assert.equal(report.campaigns[0].today.impressions, 0);
  assert.equal(report.campaigns[0].responsiveSearchAds[0].policyApprovalStatus, 'APPROVED');
  assert.equal(report.campaigns[0].responsiveSearchAds[0].adGroupStatus, 'ENABLED');
  assert.deepEqual(report.campaigns[0].responsiveSearchAds[0].policyTopicEntries, [{ topic: 'TRADEMARKS', type: 'LIMITED' }]);
  assert.equal(report.campaigns[0].warning, 'NO_IMPRESSIONS_TODAY');
  assert.equal(report.campaigns[1].today.impressions, 0);
  assert.equal(report.campaigns[1].cpcBidCeilingMicros, null);
  assert.equal(report.campaigns[1].warning, 'NO_NONREMOVED_RESPONSIVE_SEARCH_ADS_FOUND');
  assert.equal(report.campaigns[3].issue, 'NOT_FOUND');
  assert.ok(!('mutate' in context.AdsApp));
  assert.ok(!('mutateAll' in context.AdsApp));
});

test('reports ambiguous exact campaign names instead of merging results', () => {
  const duplicate = { id: '900', name: expectedNames[0], status: 'PAUSED' };
  const { context, logs } = setup({ campaigns: [duplicate, { ...duplicate, id: '901' }] });
  vm.runInContext(source + '\nmain()', context);
  const report = JSON.parse(logs[0]);
  assert.deepEqual(report.campaigns[0], { name: expectedNames[0], issue: 'AMBIGUOUS_NAME' });
});
