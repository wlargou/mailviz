import { describe, it, expect } from 'vitest';
import { classifyContactKind } from './contactKind.js';

/**
 * Person / role / automated.
 *
 * The vocabulary came from the real table — local parts repeating across many
 * domains — so the cases below are real addresses from it rather than invented
 * ones. What the tests mostly guard is *precision*: a misfiled person disappears
 * from the contact list, which is worse than a machine left in it.
 */

const kind = (email: string, extra: Partial<{ firstName: string; lastName: string; companyName: string }> = {}) =>
  classifyContactKind({ email, ...extra });

describe('classifyContactKind — automated', () => {
  it.each([
    'no-reply@digicert.com',
    'noreply@oracle.com',
    'donotreply@broadcom.com',
    'do-not-reply@trello.com',
    'firebase-noreply@google.com',
    'notifications@vercel.com',
    'notification@slack.com',
    'postmaster@powerm.ma',
    'mailer-daemon@googlemail.com',
    'newsletter@acme.com',
  ])('%s', (email) => {
    expect(kind(email)).toBe('automated');
  });

  it('beats role when both appear — a noreply billing address is still a machine', () => {
    expect(kind('noreply-billing@acme.com')).toBe('automated');
  });
});

describe('classifyContactKind — role', () => {
  it.each([
    'contact@mail.replit.com',
    'info@powerm.ma',
    'support@kaggle.com',
    'support-netsec@atlascs.ma',
    'rh@corporate-groupe.com',
    'fournisseurs@baridbank.ma',
    'finances@corporate-groupe.com',
    'marketing@siderolabs.com',
    'customerservice-emea@redhat.com',
    'procurement@edbmauritius.org',
    'securite-telecom@eurafric-information.com',
  ])('%s', (email) => {
    expect(kind(email)).toBe('role');
  });

  it('treats a display name identical to a one-word company as a brand', () => {
    expect(
      kind('hey@figma.com', { firstName: 'Figma', lastName: '', companyName: 'Figma' })
    ).toBe('role');
  });
});

describe('classifyContactKind — people, which is the half that matters', () => {
  it.each([
    'd.oulkhabou@powerm.ma',
    'hamid.fahmy@atlascs.ma',
    'abdelhadi.mounib@eurafric-information.com',
    'nada.drissi@ibm.com',
    'kh.elghazali@attijariwafa.com',
    'sahlaoui@cdgbep.ma',
    'y.nadif@lydec.co.ma',
  ])('%s', (email) => {
    expect(kind(email)).toBe('person');
  });

  it('keeps a person whose name happens to be a machine word — REGRESSION', () => {
    // Welcome Mncube is a real person. Matching "welcome" as a word inside a
    // compound filed them as a robot; found by running the classifier over the
    // whole contact table rather than over the fixtures.
    expect(
      kind('welcome.mncube@ibm.com', { firstName: 'Welcome', lastName: 'Mncube', companyName: 'IBM' })
    ).toBe('person');
  });

  it.each([
    ['alexandre.dupont@acme.com', 'alex is a role word only on its own'],
    ['newsome.hall@acme.com', 'news'],
    ['helpman.torres@acme.com', 'help'],
    ['contactos.ruiz@acme.com', 'contact'],
    ['salesbury.jones@acme.com', 'sales'],
  ])('%s stays a person (%s)', (email) => {
    expect(kind(email)).toBe('person');
  });

  it('does not treat a two-word name matching the company as a brand', () => {
    // A real person at a two-word company must not be swallowed by the brand rule.
    expect(
      kind('m.tazi@renault-trucks.com', {
        firstName: 'Renault',
        lastName: 'Trucks',
        companyName: 'Renault Trucks',
      })
    ).toBe('person');
  });
});

describe('classifyContactKind — degenerate input', () => {
  it.each([[''], ['not-an-email'], ['@nolocal.com']])('%s falls back to person', (email) => {
    expect(classifyContactKind({ email })).toBe('person');
  });

  it('handles a null email', () => {
    expect(classifyContactKind({ email: null })).toBe('person');
  });
});
