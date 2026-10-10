/**
 * Creates a paused, seven-day US Search campaign for hosted containers and sandboxes.
 * Paste into Google Ads: Tools > Bulk actions > Scripts > New script.
 * Authorize, Preview, then Run. Run creates the campaign PAUSED.
 * Dates begin tomorrow in the account time zone; total budget is $350 USD.
 * No separate Google Cloud API access application is needed.
 */
const PLAN = {
  expectedCustomerId: '3086077433',
  campaignName: 'Mainbrella | Cloudflare Sandboxes | US | 7 days',
  currencyCode: 'USD',
  totalBudgetMicros: '350000000',
  budgetPeriod: 'CUSTOM_PERIOD',
  explicitlyShared: false,
  cpcBidCeilingMicros: '3000000',
  landingPage: 'https://mainbrella.com/cloudflare-sandbox/',
  finalUrlSuffixBase: 'utm_source=google&utm_medium=cpc&utm_campaign=cloudflare_sandbox_us_7d',
  negatives: [
    'domain registration', 'domain transfer', 'dns lookup', 'dns checker',
    'dns propagation', 'ddos protection', 'ddos attack', 'cdn pricing',
    'warp vpn', 'speed test', 'jobs', 'careers', 'salary', 'salaries'
  ],
  groups: [
    {
      name: 'Cloudflare Containers',
      contentTag: 'containers',
      exact: [
        'cloudflare containers',
        'cloudflare container',
        'cloudflare container hosting',
        'cloudflare containers pricing',
        'cloudflare workers containers'
      ],
      phrase: [
        'cloudflare containers',
        'cloudflare container hosting',
        'cloudflare containers pricing'
      ],
      headlines: [
        'Hosted Containers From $5/mo',
        'Mainbrella Hosted Containers',
        'Skip Building A Control Plane',
        'No Worker Deployment Needed',
        'Run Commands By API',
        'SSH And Browser Terminals',
        'Python And JavaScript SDKs',
        'Custom Container Images',
        'Fixed Plans With Clear Limits',
        'Open Web Previews',
        'Account And API Controls',
        'Machine Controls By API'
      ],
      descriptions: [
        'Mainbrella hosts containers with API commands, SSH, browser terminals, and web previews.',
        'Plans start at $5/month with a defined compute allowance and fixed monthly pricing.',
        'Manage containers through Python or JavaScript SDKs; no Worker deployment is needed.',
        'Use custom images and machine controls from your Mainbrella account.'
      ]
    },
    {
      name: 'Cloudflare Sandboxes',
      contentTag: 'sandboxes',
      exact: [
        'cloudflare sandbox',
        'cloudflare sandboxes',
        'cloudflare sandbox pricing',
        'cloudflare sandbox alternative',
        'cloudflare sandbox sdk',
        'cloudflare ai sandbox',
        'cloudflare agent sandbox'
      ],
      phrase: [
        'cloudflare sandbox',
        'cloudflare sandbox alternative',
        'cloudflare ai sandbox',
        'cloudflare agent sandbox'
      ],
      headlines: [
        'Mainbrella Agent Sandboxes',
        'AI Agent Sandboxes From $5/mo',
        'Linux Computers For AI Agents',
        'Hosted Sandboxes Ready To Use',
        'SSH And Browser Terminals',
        'Run Commands By API',
        'API Keys And Machine Controls',
        'Python And JavaScript SDKs',
        'Custom Container Images',
        'Fixed Plans With Clear Limits',
        'Open Web Previews',
        'Start With Mainbrella'
      ],
      descriptions: [
        'Mainbrella hosts Linux sandboxes with API commands, SSH, and web previews.',
        '$5/month plans include a defined compute allowance; review limits before choosing.',
        'Create sandboxes with Python or JavaScript SDKs, custom images, and machine controls.',
        'Use hosted sandboxes without deploying Workers or setting up an infrastructure account.'
      ]
    }
  ],
  callouts: [
    'SSH Access',
    'Fixed Monthly Plans',
    'API Commands And Files',
    'No Worker Setup Needed'
  ]
};

function normalizeCustomerId(value) {
  return String(value).replace(/-/g, '');
}

function addDateOnlyDays(dateOnly, days) {
  var parts = dateOnly.split('-').map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.toISOString().slice(0, 10);
}

function buildDateRange(now, accountTimeZone) {
  var accountToday = Utilities.formatDate(now, accountTimeZone, 'yyyy-MM-dd');
  var startDate = addDateOnlyDays(accountToday, 1);
  var endDate = addDateOnlyDays(startDate, 6);
  return {
    startDateTime: startDate + ' 00:00:00',
    endDateTime: endDate + ' 23:59:59'
  };
}

function keywordSlug(keyword) {
  return keyword.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function keywordSuffix(contentTag, keyword, matchType) {
  return PLAN.finalUrlSuffixBase +
    '&utm_content=' + contentTag +
    '&utm_term=' + keywordSlug(keyword) + '_' + matchType.toLowerCase() +
    '&mb_keyword_id={targetid}&mb_matchtype={matchtype}&mb_device={device}';
}

function groupSuffix(contentTag) {
  return PLAN.finalUrlSuffixBase + '&utm_content=' + contentTag +
    '&mb_keyword_id={targetid}&mb_matchtype={matchtype}&mb_device={device}';
}

function keywordCreate(group, adGroupResource, keyword, matchType) {
  return {
    adGroup: adGroupResource,
    status: 'ENABLED',
    keyword: { text: keyword, matchType: matchType },
    // Google requires a final URL on the same criterion as its URL suffix.
    finalUrls: [PLAN.landingPage],
    finalUrlSuffix: keywordSuffix(group.contentTag, keyword, matchType)
  };
}

function validateCopy() {
  PLAN.groups.forEach(function (group) {
    if (group.headlines.length > 15 || group.descriptions.length > 4) {
      throw new Error('RSA copy exceeds Google Ads asset count limits.');
    }
    group.headlines.forEach(function (headline) {
      if (headline.length > 30) {
        throw new Error('RSA headline exceeds 30 characters: ' + headline);
      }
    });
    group.descriptions.forEach(function (description) {
      if (description.length > 90) {
        throw new Error('RSA description exceeds 90 characters.');
      }
    });
  });
  PLAN.callouts.forEach(function (callout) {
    if (callout.length > 25) {
      throw new Error('Callout exceeds 25 characters: ' + callout);
    }
  });
}

function buildOperations(now, accountTimeZone) {
  validateCopy();
  var dates = buildDateRange(now, accountTimeZone);
  var customer = 'customers/' + PLAN.expectedCustomerId;
  var budgetResource = customer + '/campaignBudgets/-1';
  var campaignResource = customer + '/campaigns/-2';
  var operations = [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budgetResource,
          name: PLAN.campaignName + ' | Budget',
          totalAmountMicros: PLAN.totalBudgetMicros,
          period: PLAN.budgetPeriod,
          explicitlyShared: PLAN.explicitlyShared
        }
      }
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaignResource,
          name: PLAN.campaignName,
          status: 'PAUSED',
          advertisingChannelType: 'SEARCH',
          campaignBudget: budgetResource,
          startDateTime: dates.startDateTime,
          endDateTime: dates.endDateTime,
          targetSpend: { cpcBidCeilingMicros: PLAN.cpcBidCeilingMicros },
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetPartnerSearchNetwork: false,
            targetContentNetwork: false
          },
          geoTargetTypeSetting: {
            positiveGeoTargetType: 'PRESENCE',
            negativeGeoTargetType: 'PRESENCE'
          },
          aiMaxSetting: { enableAiMax: false },
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'
        }
      }
    },
    {
      campaignCriterionOperation: {
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: 'geoTargetConstants/2840' },
          negative: false
        }
      }
    },
    {
      campaignCriterionOperation: {
        create: {
          campaign: campaignResource,
          language: { languageConstant: 'languageConstants/1000' },
          negative: false
        }
      }
    }
  ];

  PLAN.negatives.forEach(function (keyword) {
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign: campaignResource,
          keyword: { text: keyword, matchType: 'PHRASE' },
          negative: true
        }
      }
    });
  });

  PLAN.groups.forEach(function (group, groupIndex) {
    var adGroupId = -3 - groupIndex;
    var adGroupResource = customer + '/adGroups/' + adGroupId;
    operations.push({
      adGroupOperation: {
        create: {
          resourceName: adGroupResource,
          campaign: campaignResource,
          name: group.name,
          type: 'SEARCH_STANDARD',
          status: 'ENABLED',
          finalUrlSuffix: groupSuffix(group.contentTag)
        }
      }
    });

    [['EXACT', group.exact], ['PHRASE', group.phrase]].forEach(function (matchSet) {
      var matchType = matchSet[0];
      matchSet[1].forEach(function (keyword) {
        operations.push({
          adGroupCriterionOperation: {
            create: keywordCreate(group, adGroupResource, keyword, matchType)
          }
        });
      });
    });

    operations.push({
      adGroupAdOperation: {
        create: {
          adGroup: adGroupResource,
          status: 'ENABLED',
          ad: {
            finalUrls: [PLAN.landingPage],
            responsiveSearchAd: {
              headlines: group.headlines.map(function (text) { return { text: text }; }),
              descriptions: group.descriptions.map(function (text) { return { text: text }; }),
              path1: 'ai-agents',
              path2: 'sandboxes'
            }
          }
        }
      }
    });
  });

  PLAN.callouts.forEach(function (callout, index) {
    var assetResource = customer + '/assets/' + (-10 - index);
    operations.push({
      assetOperation: {
        create: {
          resourceName: assetResource,
          calloutAsset: { calloutText: callout }
        }
      }
    });
    operations.push({
      campaignAssetOperation: {
        create: {
          asset: assetResource,
          campaign: campaignResource,
          fieldType: 'CALLOUT'
        }
      }
    });
  });

  return operations;
}

function buildKeywordRepairOperations(adGroups, criteria) {
  var operations = [];
  PLAN.groups.forEach(function (group) {
    var matches = adGroups.filter(function (adGroup) { return adGroup.name === group.name; });
    if (matches.length !== 1) {
      throw new Error('Expected one existing ad group named ' + group.name + '; no changes submitted.');
    }
    var adGroupResource = matches[0].resourceName;
    [['EXACT', group.exact], ['PHRASE', group.phrase]].forEach(function (matchSet) {
      matchSet[1].forEach(function (keyword) {
        var desired = keywordCreate(group, adGroupResource, keyword, matchSet[0]);
        var found = criteria.filter(function (criterion) {
          return criterion.adGroup === adGroupResource &&
            criterion.keyword.text.toLowerCase() === keyword &&
            criterion.keyword.matchType === matchSet[0];
        });
        if (found.length > 1) {
          throw new Error('Duplicate existing keyword: ' + keyword + '; no changes submitted.');
        }
        if (!found.length) {
          operations.push({ adGroupCriterionOperation: { create: desired } });
        } else if (found[0].finalUrlSuffix !== desired.finalUrlSuffix ||
                   JSON.stringify(found[0].finalUrls || []) !== JSON.stringify(desired.finalUrls)) {
          operations.push({
            adGroupCriterionOperation: {
              update: {
                resourceName: found[0].resourceName,
                finalUrls: desired.finalUrls,
                finalUrlSuffix: desired.finalUrlSuffix
              },
              updateMask: 'finalUrls,finalUrlSuffix'
            }
          });
        }
      });
    });
  });
  return operations;
}

function readRows(query) {
  var iterator = AdsApp.search(query);
  var rows = [];
  while (iterator.hasNext()) rows.push(iterator.next());
  return rows;
}

function repairKeywords(campaign) {
  if (campaign.status !== 'PAUSED') {
    throw new Error('Existing campaign must be paused before repairing its keywords.');
  }
  var filter = " WHERE campaign.resource_name = '" + campaign.resourceName + "'";
  var adGroups = readRows(
    'SELECT ad_group.resource_name, ad_group.name FROM ad_group' + filter +
    ' AND ad_group.status != REMOVED'
  ).map(function (row) { return row.adGroup; });
  var criteria = readRows(
    'SELECT ad_group_criterion.resource_name, ad_group_criterion.ad_group, ' +
    'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
    'ad_group_criterion.final_urls, ad_group_criterion.final_url_suffix ' +
    'FROM ad_group_criterion' + filter +
    ' AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE' +
    ' AND ad_group_criterion.status != REMOVED'
  ).map(function (row) { return row.adGroupCriterion; });
  var operations = buildKeywordRepairOperations(adGroups, criteria);
  if (!operations.length) {
    Logger.log('All planned keywords already have the correct final URL and tracking; no changes made.');
    return;
  }
  Logger.log('Repairing ' + operations.length + ' keyword URLs or missing keywords on ' + campaign.resourceName);
  var results = AdsApp.mutateAll(operations, { apiVersion: 'V25', partialFailure: false });
  assertMutationResults(results, operations.length);
  Logger.log(AdsApp.getExecutionInfo().isPreview()
    ? 'Keyword repair preview completed; no changes saved.'
    : 'Keyword repair completed. Campaign remains paused; budget and dates were preserved.');
}

function assertMutationResults(results, expectedCount) {
  if (!Array.isArray(results) || results.length !== expectedCount) {
    throw new Error('Google Ads returned an incomplete mutation result set.');
  }
  results.forEach(function (result, index) {
    if (!result) {
      throw new Error('Google Ads mutation ' + (index + 1) + ' returned no result.');
    }
    if (typeof result.isSuccessful !== 'function' || typeof result.getErrorMessages !== 'function') {
      throw new Error('Google Ads returned an unrecognized mutation result.');
    }
    var errors = result.getErrorMessages() || [];
    if (!result.isSuccessful() || errors.length) {
      throw new Error('Google Ads mutation ' + (index + 1) + ' failed: ' + errors.join('; '));
    }
  });
}

function main() {
  validateCopy();
  var account = AdsApp.currentAccount();
  var actualCustomerId = normalizeCustomerId(account.getCustomerId());
  if (actualCustomerId !== PLAN.expectedCustomerId) {
    throw new Error('Wrong Google Ads account. Expected ' + PLAN.expectedCustomerId + '.');
  }
  if (account.getCurrencyCode() !== PLAN.currencyCode) {
    throw new Error('Campaign budget is in USD; the selected account must use USD.');
  }

  var existing = readRows(
    "SELECT campaign.resource_name, campaign.status FROM campaign WHERE campaign.name = '" +
    PLAN.campaignName.replace(/'/g, "\\'") +
    "' AND campaign.status != REMOVED LIMIT 2"
  );
  if (existing.length > 1) {
    throw new Error('Multiple campaigns have the setup name; no changes submitted.');
  }
  if (existing.length === 1) {
    repairKeywords(existing[0].campaign);
    return;
  }

  var timezone = account.getTimeZone();
  var now = new Date();
  var operations = buildOperations(now, timezone);
  var dateRange = buildDateRange(now, timezone);
  Logger.log('Campaign plan: PAUSED campaign with enabled new ad groups, keywords, and ads.');
  Logger.log('Name: ' + PLAN.campaignName);
  Logger.log('Budget: $350 USD total for ' + dateRange.startDateTime + ' through ' + dateRange.endDateTime + ' (' + timezone + ')');
  var positiveCount = PLAN.groups.reduce(function (total, group) { return total + group.exact.length + group.phrase.length; }, 0);
  Logger.log('Search only; US, English; ' + PLAN.groups.length + ' ad groups; ' + positiveCount + ' positive keywords; ' + PLAN.negatives.length + ' phrase negatives; ' + PLAN.callouts.length + ' callouts.');
  Logger.log('Submitting ' + operations.length + ' operations atomically. Preview mode suppresses writes.');

  var preview = AdsApp.getExecutionInfo().isPreview();
  var results = AdsApp.mutateAll(operations, {
    apiVersion: 'V25',
    partialFailure: false
  });
  assertMutationResults(results, operations.length);
  if (preview) {
    Logger.log('Preview completed; no campaign or other Ads objects were created.');
  } else {
    Logger.log('Campaign created paused. Review the campaign before enabling it.');
  }
}
