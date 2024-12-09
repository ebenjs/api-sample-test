const {
  generateLastModifiedDateFilter,
} = require("../services/dataProcessors");

const buildCompaniesSearchObject = (lastModifiedDateFilter, offsetObject) => ({
  filterGroups: [lastModifiedDateFilter],
  sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
  properties: [
    "name",
    "domain",
    "country",
    "industry",
    "description",
    "annualrevenue",
    "numberofemployees",
    "hs_lead_status",
  ],
  limit: 100,
  after: offsetObject.after,
});

const buildContactSearchObject = (lastModifiedDateFilter, offsetObject) => ({
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
  limit: 100,
  after: offsetObject.after,
});

const buildMeetingSearchObject = (offsetObject, lastPulledDate, now, limit) => {
  const lastModifiedDate = offsetObject.lastModifiedDate || lastPulledDate;
  const lastModifiedDateFilter = generateLastModifiedDateFilter(
    lastModifiedDate,
    now,
    "lastmodifieddate",
  );

  return {
    filterGroups: [lastModifiedDateFilter],
    sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
    properties: ["title", "hs_meeting_start_time", "hs_meeting_end_time"],
    limit,
    after: offsetObject.after,
  };
};

module.exports = {
  buildCompaniesSearchObject,
  buildContactSearchObject,
  buildMeetingSearchObject,
};
