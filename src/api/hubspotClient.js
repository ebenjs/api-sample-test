const hubspot = require('@hubspot/api-client');

const hubspotClient = new hubspot.Client({ accessToken: '' });
let expirationDate;

const refreshAccessToken = async (domain, hubId) => {
  const { HUBSPOT_CID, HUBSPOT_CS } = process.env;
  const account = domain.integrations.hubspot.accounts.find(account => account.hubId === hubId);
  const { accessToken, refreshToken } = account;

  return hubspotClient.oauth.tokensApi
    .createToken('refresh_token', undefined, undefined, HUBSPOT_CID, HUBSPOT_CS, refreshToken)
    .then(async result => {
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

const fetchHubSpotCompaniesData = async (searchObject, retryCount = 4) => {
  let searchResult = {};
  let tryCount = 0;

  while (tryCount <= retryCount) {
    try {
      searchResult = await hubspotClient.crm.companies.searchApi.doSearch(searchObject);
      return searchResult;
    } catch (err) {
      tryCount++;
      if (new Date() > expirationDate) await refreshAccessToken(domain, hubId);
      await new Promise(resolve => setTimeout(resolve, 5000 * Math.pow(2, tryCount)));
    }
  }

  throw new Error('Failed to fetch data from HubSpot after multiple attempts.');
};

module.exports = { refreshAccessToken, fetchHubSpotData };
