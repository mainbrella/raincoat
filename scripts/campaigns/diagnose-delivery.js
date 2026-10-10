/**
 * Read-only delivery diagnostics for the four Mainbrella search experiments.
 * Paste into Google Ads Scripts, Preview, then Run. This script never mutates Ads.
 */
var EXPECTED_CUSTOMER_ID = '3086077433';
var CAMPAIGN_NAMES = [
  'Mainbrella | Cloudflare Sandboxes | US | 7 days',
  'Mainbrella | E2B Alternatives | US | 7 days',
  'Mainbrella | Daytona Alternatives | US | 7 days',
  'Mainbrella | Open Source Sandboxes | US | 7 days'
];

function quoteGaql(value) {
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function rows(query) {
  var iterator = AdsApp.search(query, { apiVersion: 'v25' });
  var result = [];
  while (iterator.hasNext()) result.push(iterator.next());
  return result;
}

function jsonValue(value) {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function main() {
  var account = AdsApp.currentAccount();
  var customerId = String(account.getCustomerId()).replace(/-/g, '');
  if (customerId !== EXPECTED_CUSTOMER_ID) {
    throw new Error('Wrong Google Ads account. Expected ' + EXPECTED_CUSTOMER_ID + '.');
  }

  var names = CAMPAIGN_NAMES.map(quoteGaql).join(', ');
  var campaignRows = rows(
    'SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, ' +
    'campaign.primary_status_reasons, campaign.serving_status, campaign.bidding_strategy_type, ' +
    'campaign.start_date_time, campaign.end_date_time, ' +
    'campaign.target_spend.cpc_bid_ceiling_micros ' +
    'FROM campaign WHERE campaign.name IN (' + names + ') AND campaign.status != REMOVED'
  );
  var metricsRows = rows(
    'SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros ' +
    'FROM campaign WHERE campaign.name IN (' + names + ') AND segments.date DURING TODAY'
  );
  var adRows = rows(
    'SELECT campaign.id, campaign.name, ad_group.name, ad_group.status, ad_group_ad.ad.id, ad_group_ad.ad.type, ' +
    'ad_group_ad.status, ad_group_ad.primary_status, ad_group_ad.primary_status_reasons, ' +
    'ad_group_ad.policy_summary.review_status, ad_group_ad.policy_summary.approval_status, ' +
    'ad_group_ad.policy_summary.policy_topic_entries ' +
    'FROM ad_group_ad WHERE campaign.name IN (' + names + ') ' +
    'AND campaign.status != REMOVED AND ad_group_ad.status != REMOVED ' +
    'AND ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD'
  );

  var campaignsByName = {};
  campaignRows.forEach(function (row) {
    var campaign = row.campaign;
    if (!campaignsByName[campaign.name]) campaignsByName[campaign.name] = [];
    campaignsByName[campaign.name].push(campaign);
  });
  var metricsById = {};
  metricsRows.forEach(function (row) { metricsById[String(row.campaign.id)] = row.metrics; });
  var adsById = {};
  adRows.forEach(function (row) {
    var campaignId = String(row.campaign.id);
    if (!adsById[campaignId]) adsById[campaignId] = [];
    var ad = row.adGroupAd;
    var policy = ad.policySummary || {};
    adsById[campaignId].push({
      adGroup: row.adGroup.name,
      adGroupStatus: row.adGroup.status,
      adId: String(ad.ad.id),
      adType: ad.ad.type,
      status: ad.status,
      primaryStatus: ad.primaryStatus,
      primaryStatusReasons: jsonValue(ad.primaryStatusReasons) || [],
      policyReviewStatus: policy.reviewStatus,
      policyApprovalStatus: policy.approvalStatus,
      policyTopicEntries: jsonValue(policy.policyTopicEntries) || []
    });
  });

  var report = {
    customerId: customerId,
    currency: account.getCurrencyCode(),
    timeZone: account.getTimeZone(),
    campaigns: CAMPAIGN_NAMES.map(function (name) {
      var matches = campaignsByName[name] || [];
      if (matches.length !== 1) {
        return { name: name, issue: matches.length ? 'AMBIGUOUS_NAME' : 'NOT_FOUND' };
      }
      var campaign = matches[0];
      var metrics = metricsById[String(campaign.id)] || {};
      var adList = adsById[String(campaign.id)] || [];
      var item = {
        id: String(campaign.id),
        name: campaign.name,
        status: campaign.status,
        primaryStatus: campaign.primaryStatus,
        primaryStatusReasons: jsonValue(campaign.primaryStatusReasons) || [],
        servingStatus: campaign.servingStatus,
        biddingStrategyType: campaign.biddingStrategyType,
        startDateTime: campaign.startDateTime,
        endDateTime: campaign.endDateTime,
        cpcBidCeilingMicros: jsonValue(campaign.targetSpend && campaign.targetSpend.cpcBidCeilingMicros),
        today: {
          impressions: Number(metrics.impressions || 0),
          clicks: Number(metrics.clicks || 0),
          costMicros: String(metrics.costMicros || '0')
        },
        responsiveSearchAds: adList
      };
      if (!adList.length) item.warning = 'NO_NONREMOVED_RESPONSIVE_SEARCH_ADS_FOUND';
      else if (!item.today.impressions) item.warning = 'NO_IMPRESSIONS_TODAY';
      return item;
    })
  };
  Logger.log(JSON.stringify(report));
}
