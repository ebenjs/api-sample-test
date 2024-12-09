const hubspot = require("@hubspot/api-client");
const { queue } = require("async");
const _ = require("lodash");

const { filterNullValuesFromObject, goal, getHubspotAccount } = require("./helpers/utils");
const Domain = require("./domain/Domain");
const { fetchCompaniesBatch, refreshAccessToken } = require("./api/hubspotClient");

const hubspotClient = new hubspot.Client({ accessToken: "" });
const propertyPrefix = "hubspot__";
let expirationDate;

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
  const limit = 100;

  while (await fetchCompaniesBatch(account, lastPulledDate, now, offsetObject, q));
  account.lastPulledDates.companies = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified contacts as 100 contacts per page
 */
const processContacts = async (domain, hubId, q) => {
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );
  const lastPulledDate = new Date(account.lastPulledDates.contacts);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const lastModifiedDateFilter = generateLastModifiedDateFilter(
      lastModifiedDate,
      now,
      "lastmodifieddate"
    );
    const searchObject = {
      filterGroups: [lastModifiedDateFilter],
      sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
      properties: [
        "firstname",
        "lastname",
        "jobtitle",
        "email",
        "hubspotscore",
        "hs_lead_status",
        "hs_analytics_source",
        "hs_latest_source",
      ],
      limit,
      after: offsetObject.after,
    };

    let searchResult = {};
    let tryCount = 0;
    while (tryCount <= 4) {
      try {
        searchResult = await hubspotClient.crm.contacts.searchApi.doSearch(
          searchObject
        );
        break;
      } catch (err) {
        console.error(err)
        tryCount++;

        if (new Date() > expirationDate)
          await refreshAccessToken(domain, hubId);

        await new Promise((resolve, reject) =>
          setTimeout(resolve, 5000 * Math.pow(2, tryCount))
        );
      }
    }

    if (!searchResult)
      throw new Error("Failed to fetch contacts for the 4th time. Aborting.");

    const data = searchResult.results || [];

    console.log("fetch contact batch");

    offsetObject.after = parseInt(searchResult.paging?.next?.after);
    const contactIds = data.map((contact) => contact.id);

    // contact to company association
    const contactsToAssociate = contactIds;
    const companyAssociationsResults =
      (
        await (
          await hubspotClient.apiRequest({
            method: "post",
            path: "/crm/v3/associations/CONTACTS/COMPANIES/batch/read",
            body: {
              inputs: contactsToAssociate.map((contactId) => ({
                id: contactId,
              })),
            },
          })
        ).json()
      )?.results || [];

    const companyAssociations = Object.fromEntries(
      companyAssociationsResults
        .map((a) => {
          if (a.from) {
            contactsToAssociate.splice(
              contactsToAssociate.indexOf(a.from.id),
              1
            );
            return [a.from.id, a.to[0].id];
          } else return false;
        })
        .filter((x) => x)
    );

    data.forEach((contact) => {
      if (!contact.properties || !contact.properties.email) return;

      const companyId = companyAssociations[contact.id];

      const isCreated = new Date(contact.createdAt) > lastPulledDate;

      const userProperties = {
        company_id: companyId,
        contact_name: (
          (contact.properties.firstname || "") +
          " " +
          (contact.properties.lastname || "")
        ).trim(),
        contact_title: contact.properties.jobtitle,
        contact_source: contact.properties.hs_analytics_source,
        contact_status: contact.properties.hs_lead_status,
        contact_score: parseInt(contact.properties.hubspotscore) || 0,
      };

      const actionTemplate = {
        includeInAnalytics: 0,
        identity: contact.properties.email,
        userProperties: filterNullValuesFromObject(userProperties),
      };

      q.push({
        actionName: isCreated ? "Contact Created" : "Contact Updated",
        actionDate: new Date(isCreated ? contact.createdAt : contact.updatedAt),
        ...actionTemplate,
      });
    });

    if (!offsetObject?.after) {
      hasMore = false;
      break;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(
        data[data.length - 1].updatedAt
      ).valueOf();
    }
  }

  account.lastPulledDates.contacts = now;
  await saveDomain(domain);

  return true;
};

/**
 * Get recently modified meetings
 */
const processMeetings = async (domain, hubId, q) => {
  const account = domain.integrations.hubspot.accounts.find(
    (account) => account.hubId === hubId
  );
  const lastPulledDate = new Date(account.lastPulledDates.meetings);
  const now = new Date();

  let hasMore = true;
  const offsetObject = {};
  const limit = 100;

  while (hasMore) {
    const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
    const lastModifiedDateFilter = generateLastModifiedDateFilter(
      lastModifiedDate,
      now,
      "lastmodifieddate"
    );
    const searchObject = {
      filterGroups: [lastModifiedDateFilter],
      sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
      properties: ["title"],
      // properties: ["title", "hs_meeting_start_time", "hs_meeting_end_time"],
      limit,
      after: offsetObject.after,
    };

    let searchResult = {};

    let tryCount = 0;
    while (tryCount <= 4) {
      try {
        searchResult =
          await hubspotClient.crm.objects.meetings.searchApi.doSearch(
            searchObject
          );
        break;
      } catch (err) {
        console.error(err)
        tryCount++;
        if (new Date() > expirationDate)
          await refreshAccessToken(domain, hubId);
        await new Promise((resolve) =>
          setTimeout(resolve, 5000 * Math.pow(2, tryCount))
        );
      }
    }

    if (!searchResult)
      throw new Error("Failed to fetch meetings for the 4th time. Aborting.");

    const meetings = searchResult.results || [];
    console.log("Fetched meeting batch:", meetings.length);

    // Fetch associated contacts for each meeting
    const associationResults = await (
      await hubspotClient.apiRequest({
        method: "post",
        path: "/crm/v3/associations/MEETINGS/CONTACTS/batch/read",
        body: { inputs: meetings.map((meeting) => ({ id: meeting.id })) },
      })
    ).json();

    const associations = associationResults.results || [];

    // Map meeting ID to associated contact IDs
    const meetingToContactsMap = {};
    associations.forEach((assoc) => {
      if (assoc.from) {
        meetingToContactsMap[assoc.from.id] = assoc.to.map(
          (contact) => contact.id
        );
      }
    });

    for (const meeting of meetings) {
      if (!meeting.properties || !meeting.properties.title) continue;

      const associatedContactIds = meetingToContactsMap[meeting.id] || [];
      const contactEmails = await Promise.all(
        associatedContactIds.map(async (contactId) => {
          const contact = await hubspotClient.crm.contacts.basicApi.getById(
            contactId,
            ["email"]
          );
          return contact.properties.email;
        })
      );

      const isCreated = new Date(meeting.createdAt) > lastPulledDate;

      const meetingProperties = {
        meeting_id: meeting.id,
        meeting_title: meeting.properties.title,
        meeting_start_time: meeting.properties.hs_meeting_start_time,
        meeting_end_time: meeting.properties.hs_meeting_end_time,
        attendees: contactEmails.filter((email) => email),
      };

      const actionTemplate = {
        includeInAnalytics: 0,
        meetingProperties: filterNullValuesFromObject(meetingProperties),
      };

      q.push({
        actionName: isCreated ? "Meeting Created" : "Meeting Updated",
        actionDate: new Date(isCreated ? meeting.createdAt : meeting.updatedAt),
        ...actionTemplate,
      });
    }

    offsetObject.after = parseInt(searchResult?.paging?.next?.after);

    if (!offsetObject?.after) {
      hasMore = false;
    } else if (offsetObject?.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(
        meetings[meetings.length - 1].updatedAt
      ).valueOf();
    }
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

    // try {
    //   await processContacts(domain, account.hubId, q);
    //   console.log("process contacts");
    // } catch (err) {
    //   console.log(err, {
    //     apiKey: domain.apiKey,
    //     metadata: { operation: "processContacts", hubId: account.hubId },
    //   });
    // }

    try {
      await processCompanies(domain, account.hubId, q);
    } catch (err) {
      console.log(err, {
        apiKey: domain.apiKey,
        metadata: { operation: "processCompanies", hubId: account.hubId },
      });
    }

    // try {
    //   await processMeetings(domain, account.hubId, q);
    //   console.log("process meetings");
    // } catch (err) {
    //   console.log(err, {
    //     apiKey: domain.apiKey,
    //     metadata: { operation: "processMeetings", hubId: account.hubId },
    //   });
    // }

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