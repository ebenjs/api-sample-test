const hubspot = require("@hubspot/api-client");
const {
  buildCompaniesSearchObject,
  buildContactSearchObject,
} = require("../helpers/searchQueryBuilder");
const { RequestType } = require("../enums/globalEnums");
const {
  processCompanyData,
  processContactData,
  generateLastModifiedDateFilter,
} = require("../services/dataProcessors");

const hubspotClient = new hubspot.Client({ accessToken: "" });
let expirationDate;

const refreshAccessToken = async (domain, hubId) => {
  const { HUBSPOT_CID, HUBSPOT_CS } = process.env;
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId,
  );
  const { accessToken, refreshToken } = account;

  return hubspotClient.oauth.tokensApi
    .createToken(
      "refresh_token",
      undefined,
      undefined,
      HUBSPOT_CID,
      HUBSPOT_CS,
      refreshToken,
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
  q,
) => {
  const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
  const lastModifiedDateFilter = generateLastModifiedDateFilter(
    lastModifiedDate,
    now,
  );

  const searchObject = buildCompaniesSearchObject(
    lastModifiedDateFilter,
    offsetObject,
  );
  const searchResult = await retryHubspotSearch(
    account,
    searchObject,
    RequestType.COMPANIES,
  );

  if (!searchResult) {
    throw new Error(
      "Failed to fetch companies after multiple attempts. Aborting.",
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
      data[data.length - 1].updatedAt,
    ).valueOf();
  }

  return true;
};

const fetchContactsBatch = async (
  account,
  lastPulledDate,
  now,
  offsetObject,
  queue,
) => {
  const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
  const lastModifiedDateFilter = generateLastModifiedDateFilter(
    lastModifiedDate,
    now,
    "lastmodifieddate",
  );

  const searchObject = buildContactSearchObject(
    lastModifiedDateFilter,
    offsetObject,
  );
  const searchResult = await retryHubspotSearch(
    account,
    searchObject,
    RequestType.CONTACTS,
  );

  if (!searchResult) {
    throw new Error(
      "Failed to fetch contacts after multiple attempts. Aborting.",
    );
  }

  const data = searchResult.results || [];
  offsetObject.after = parseInt(searchResult?.paging?.next?.after);

  console.log("fetch contact batch");

  const companyAssociations = await fetchContactCompanyAssociations(data);
  processContactData(data, companyAssociations, lastPulledDate, queue);

  if (!offsetObject?.after) {
    return false;
  }

  if (offsetObject?.after >= 9900) {
    offsetObject.after = 0;
    offsetObject.lastModifiedDate = new Date(
      data[data.length - 1].updatedAt,
    ).valueOf();
  }

  return true;
};

const fetchContactCompanyAssociations = async (contacts) => {
  const contactIds = contacts.map((contact) => contact.id);

  const response = await hubspotClient.apiRequest({
    method: "post",
    path: "/crm/v3/associations/CONTACTS/COMPANIES/batch/read",
    body: { inputs: contactIds.map((id) => ({ id })) },
  });
  const results = (await response.json())?.results || [];

  const associations = Object.fromEntries(
    results
      .map((assoc) => assoc.from && [assoc.from.id, assoc.to[0]?.id])
      .filter(Boolean),
  );

  return associations;
};

const fetchMeetings = async (account, searchObject, requestType) => {
  const searchResult = await retryHubspotSearch(
    account,
    searchObject,
    requestType,
  );

  if (!searchResult)
    throw new Error("Failed to fetch meetings after 4 attempts.");

  console.log("Fetched meeting batch:", searchResult.results?.length || 0);

  return searchResult.results || [];
};

const fetchMeetingContactAssociations = async (meetings) => {
  const associationResults = await (
    await hubspotClient.apiRequest({
      method: "post",
      path: "/crm/v3/associations/MEETINGS/CONTACTS/batch/read",
      body: { inputs: meetings.map((meeting) => ({ id: meeting.id })) },
    })
  ).json();

  const associations = associationResults.results || [];
  const meetingToContactsMap = {};

  associations.forEach((assoc) => {
    if (assoc.from) {
      meetingToContactsMap[assoc.from.id] = assoc.to.map(
        (contact) => contact.id,
      );
    }
  });

  return meetingToContactsMap;
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
      return hubspotClient.crm.objects.meetings.searchApi;
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

module.exports = {
  refreshAccessToken,
  fetchCompaniesBatch,
  fetchContactsBatch,
  fetchMeetings,
  fetchMeetingContactAssociations
};
