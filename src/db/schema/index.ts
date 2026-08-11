// Barrel for all Drizzle table definitions. One file per aggregate.
// As the domain grows, add: portal-specific tables.
// Current: orgs, templates, programs, unitStages, requirements, participants, accessTokens, evidence, clients.
export * from "./orgs";
export * from "./templates";
export * from "./programs";
export * from "./participants";
export * from "./evidence";
export * from "./clients";
