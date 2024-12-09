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

  const createCompaniesActionTemplate = (company) => ({
    includeInAnalytics: 0,
    companyProperties: {
      company_id: company.id,
      company_domain: company.properties.domain,
      company_industry: company.properties.industry,
    },
  });

  module.exports = {
    processCompanyData
  };