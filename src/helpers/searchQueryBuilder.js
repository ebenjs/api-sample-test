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

  module.exports = {
    buildCompaniesSearchObject
  };