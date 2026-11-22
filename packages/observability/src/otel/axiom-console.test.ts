// @module-tag pure
import { describe, expect, it } from 'vitest';
import { AXIOM_DASHBOARD_UID, AXIOM_ORG_ID, axiomDashboardUrl, axiomMonitorsUrl } from './axiom-console';

describe('AXIOM_ORG_ID', () => {
  it('maps staging to the staging-only org', () => {
    expect(AXIOM_ORG_ID.staging).toBe('artfulbits-it-ab-knm4');
  });

  it('maps production to the production-only org', () => {
    expect(AXIOM_ORG_ID.production).toBe('salir-ab-a5za');
  });
});

describe('axiomDashboardUrl', () => {
  it('resolves the staging dashboard URL under the staging org', () => {
    expect(axiomDashboardUrl('staging')).toBe(
      `https://app.axiom.co/artfulbits-it-ab-knm4/dashboards/${AXIOM_DASHBOARD_UID.staging}`,
    );
  });

  it('resolves the production dashboard URL under the production org', () => {
    expect(axiomDashboardUrl('production')).toBe(
      `https://app.axiom.co/salir-ab-a5za/dashboards/${AXIOM_DASHBOARD_UID.production}`,
    );
  });
});

describe('axiomMonitorsUrl', () => {
  it('resolves the staging monitors list under the staging org', () => {
    expect(axiomMonitorsUrl('staging')).toBe('https://app.axiom.co/artfulbits-it-ab-knm4/monitors');
  });

  it('resolves the production monitors list under the production org', () => {
    expect(axiomMonitorsUrl('production')).toBe('https://app.axiom.co/salir-ab-a5za/monitors');
  });
});
