const processCompanyData = (companies, lastPulledDate, queue) => {
    companies.forEach((company) => {
      if (!company.properties) return;
  
      const actionTemplate = createCompaniesActionTemplate(company);
      const isCreated = !lastPulledDate || new Date(company.createdAt) > lastPulledDate;
  
      queue.push({
        actionName: isCreated ? "Company Created" : "Company Updated",
        actionDate: new Date(isCreated ? company.createdAt : company.updatedAt) - 2000,
        ...actionTemplate,
      });
    });
  };

  const processContactData = (contacts, companyAssociations, lastPulledDate, queue) => {
    contacts.forEach((contact) => {
      if (!contact.properties || !contact.properties.email) return;
  
      const companyId = companyAssociations[contact.id];
      const isCreated = new Date(contact.createdAt) > lastPulledDate;
  
      const userProperties = {
        company_id: companyId,
        contact_name: `${contact.properties.firstname || ""} ${contact.properties.lastname || ""}`.trim(),
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
  
      queue.push({
        actionName: isCreated ? "Contact Created" : "Contact Updated",
        actionDate: new Date(isCreated ? contact.createdAt : contact.updatedAt),
        ...actionTemplate,
      });
    });
  };

  const processMeetingBatch = async (meetings, meetingToContactsMap, lastPulledDate, q) => {
    for (const meeting of meetings) {
      if (!meeting.properties || !meeting.properties.title) continue;
  
      const associatedContactIds = meetingToContactsMap[meeting.id] || [];
      const contactEmails = await Promise.all(
        associatedContactIds.map(async (contactId) => {
          const contact = await hubspotClient.crm.contacts.basicApi.getById(
            contactId,
            ["email"]
          );
          return contact?.properties?.email;
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
  };

  const updateOffsetObject = (offsetObject, meetings) => {
    offsetObject.after = parseInt(meetings?.paging?.next?.after, 10);
  
    if (offsetObject.after >= 9900) {
      offsetObject.after = 0;
      offsetObject.lastModifiedDate = new Date(
        meetings[meetings.length - 1].updatedAt
      ).valueOf();
    }
  };
  
  

  const createCompaniesActionTemplate = (company) => ({
    includeInAnalytics: 0,
    companyProperties: {
      company_id: company.id,
      company_domain: company.properties.domain,
      company_industry: company.properties.industry,
    },
  });

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

  module.exports = {
    processCompanyData,
    processContactData,
    processMeetingBatch,
    updateOffsetObject,
    generateLastModifiedDateFilter
  };