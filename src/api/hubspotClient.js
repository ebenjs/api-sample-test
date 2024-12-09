const hubspot = require("@hubspot/api-client");
const { buildCompaniesSearchObject } = require("../helpers/searchQueryBuilder");
const { RequestType } = require("../enums/globalEnums");
const { processCompanyData } = require("../services/dataProcessors");

const hubspotClient = new hubspot.Client({ accessToken: "" });
let expirationDate;

const refreshAccessToken = async (domain, hubId, tryCount) => {
  const { HUBSPOT_CID, HUBSPOT_CS } = process.env;
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );
  const { accessToken, refreshToken } = account;

  return hubspotClient.oauth.tokensApi
    .createToken(
      "refresh_token",
      undefined,
      undefined,
      HUBSPOT_CID,
      HUBSPOT_CS,
      refreshToken
    )
    .then(async (result) => {
      const body = result.body ? result.body : result;

      const newAccessToken = body.accessToken;
      expirationDate = new Date(body.expiresIn * 1000 + new Date().getTime());

      hubspotClient.setAccessToken(newAccessToken);
      if (newAccessToken !== accessToken) {
        account.accessToken = newAccessToken;
      }

      return true;
    });
};

const fetchCompaniesBatch = async (
  account,
  lastPulledDate,
  now,
  offsetObject,
  q
) => {
  const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
  const lastModifiedDateFilter = generateLastModifiedDateFilter(
    lastModifiedDate,
    now
  );

  const searchObject = buildCompaniesSearchObject(lastModifiedDateFilter, offsetObject);
  const searchResult = await retryHubspotSearch(account, searchObject, RequestType.COMPANIES);

  if (!searchResult) {
    throw new Error(
      "Failed to fetch companies after multiple attempts. Aborting."
    );
  }

  const data = searchResult.results || [];
  offsetObject.after = parseInt(searchResult?.paging?.next?.after);

  processCompanyData(data, lastPulledDate, q);

  if (!offsetObject?.after) {
    return false;
  }

  if (offsetObject?.after >= 9900) {
    offsetObject.after = 0;
    offsetObject.lastModifiedDate = new Date(
      data[data.length - 1].updatedAt
    ).valueOf();
  }

  return true;
};

const generateLastModifiedDateFilter = (
  date,
  nowDate,
  propertyName = "hs_lastmodifieddate"
) => {
  const lastModifiedDateFilter = date
    ? {
        filters: [
          { propertyName, operator: "GTE", value: `${date.valueOf()}` },
          { propertyName, operator: "LTE", value: `${nowDate.valueOf()}` },
        ],
      }
    : {};

  return lastModifiedDateFilter;
};

const retryHubspotSearch = async (account, searchObject, requestType) => {
  let tryCount = 0;

  let properAPI = getProperApiBasedOnRequestType(requestType);

  while (tryCount <= 4) {
    try {
      return await properAPI.doSearch(searchObject);
    } catch (err) {
      tryCount++;
      await handleSearchError(account, err, tryCount);
    }
  }

  return null;
};

const getProperApiBasedOnRequestType = (requestType) => {
  switch (requestType) {
    case "companies":
      return hubspotClient.crm.companies.searchApi;
    case "contacts":
      return hubspotClient.crm.contacts.searchApi;
    case "meetings":
      return hubspotClient.crm.meetings.searchApi;
    default:
      break;
  }
};

const handleSearchError = async (account, err, tryCount) => {
  if (isAccessTokenExpired(err)) {
    await refreshAccessToken(account.domain, account.hubId);
  }
  await waitWithBackoff(tryCount);
};

const isAccessTokenExpired = (err) => {
  return new Date() > expirationDate;
};

const waitWithBackoff = (tryCount) =>
  new Promise((resolve) => setTimeout(resolve, 5000 * Math.pow(2, tryCount)));

module.exports = { refreshAccessToken, fetchCompaniesBatch };
