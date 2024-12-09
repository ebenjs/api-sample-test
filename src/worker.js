const { queue } = require("async");
const _ = require("lodash");

const {
  goal,
  getHubspotAccount,
} = require("./helpers/utils");
const Domain = require("./domain/Domain");
const {
  fetchCompaniesBatch,
  refreshAccessToken,
  fetchContactsBatch,
  fetchMeetings,
  fetchMeetingContactAssociations,
} = require("./api/hubspotClient");
const { buildMeetingSearchObject } = require("./helpers/searchQueryBuilder");
const { RequestType } = require("./enums/globalEnums");
const { processMeetingBatch, updateOffsetObject } = require("./services/dataProcessors");

const saveDomain = async (domain) => {
  // disable this for testing purposes
  return;

  domain.markModified("integrations.hubspot.accounts");
  await domain.save();
};

/**
 * Get recently modified companies as 100 companies per page
 */
const processCompanies = async (domain, hubId, q) => {
  const account = getHubspotAccount(domain, hubId);
  const lastPulledDate = new Date(account.lastPulledDates.companies);
  const now = new Date();
  const offsetObject = {};

  while (
    await fetchCompaniesBatch(account, lastPulledDate, now, offsetObject, q)
  );
  account.lastPulledDates.companies = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified contacts as 100 contacts per page
 */
const processContacts = async (domain, hubId, q) => {
  const account = getHubspotAccount(domain, hubId);
  const lastPulledDate = new Date(account.lastPulledDates.contacts);
  const now = new Date();

  const offsetObject = {};

  while (
    await fetchContactsBatch(account, lastPulledDate, now, offsetObject, q)
  );
  account.lastPulledDates.contacts = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified meetings
 */
const processMeetings = async (domain, hubId, q) => {
  const account = getHubspotAccount(domain, hubId);

  const lastPulledDate = new Date(account.lastPulledDates.meetings);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const searchObject = buildMeetingSearchObject(
      offsetObject,
      lastPulledDate,
      now,
      limit,
    );

    const meetings = await fetchMeetings(
      account,
      searchObject,
      RequestType.MEETINGS,
    );

    const meetingToContactsMap =
      await fetchMeetingContactAssociations(meetings);

    await processMeetingBatch(
      meetings,
      meetingToContactsMap,
      lastPulledDate,
      q,
    );

    updateOffsetObject(offsetObject, meetings);

    hasMore = !!offsetObject.after;
  }

  account.lastPulledDates.meetings = now;
  await saveDomain(domain);

  return true;
};

const createQueue = (domain, actions) =>
  queue(async (action, callback) => {
    actions.push(action);

    if (actions.length > 2000) {
      console.log("inserting actions to database", {
        apiKey: domain.apiKey,
        count: actions.length,
      });

      const copyOfActions = _.cloneDeep(actions);
      actions.splice(0, actions.length);

      goal(copyOfActions);
    }

    callback();
  }, 100000000);

const drainQueue = async (domain, actions, q) => {
  if (q.length() > 0) await q.drain();

  if (actions.length > 0) {
    goal(actions);
  }

  return true;
};

const pullDataFromHubspot = async () => {
  console.log("start pulling data from HubSpot");

  const domain = await Domain.findOne({});

  for (const account of domain.integrations.hubspot.accounts) {
    console.log("start processing account");

    try {
      await refreshAccessToken(domain, account.hubId);
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: "refreshAccessToken" },
      });
    }

    const actions = [];
    const q = createQueue(domain, actions);

    try {
      await processContacts(domain, account.hubId, q);
      console.log("process contacts");
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: "processContacts", hubId: account.hubId },
      });
    }

    try {
      await processCompanies(domain, account.hubId, q);
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: "processCompanies", hubId: account.hubId },
      });
    }

    try {
      await processMeetings(domain, account.hubId, q);
      console.log("process meetings");
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: "processMeetings", hubId: account.hubId },
      });
    }

    try {
      await drainQueue(domain, actions, q);
      console.log("drain queue");
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: "drainQueue", hubId: account.hubId },
      });
    }

    await saveDomain(domain);

    console.log("finish processing account");
  }

  process.exit();
};

module.exports = pullDataFromHubspot;
