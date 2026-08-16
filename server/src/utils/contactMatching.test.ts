import { describe, it, expect } from 'vitest';
import {
  aliasLocalPartKey,
  exactEmailKey,
  initialFormKey,
  nameKey,
  parseAddress,
} from './contactMatching.js';

/**
 * The matching rules, exercised on addresses taken from the production
 * database. Every "does not match" case below is a pair the rules must keep
 * apart: a wrong merge deletes a contact row irreversibly, so a false positive
 * costs far more than a missed duplicate.
 */

describe('parseAddress', () => {
  it('lowercases and strips header junk', () => {
    expect(parseAddress('  <Ahmed.Bouna@Dell.com> ')).toEqual({
      local: 'ahmed.bouna',
      domain: 'dell.com',
      rootDomain: 'dell.com',
    });
  });

  it('reduces a subdomain to its root', () => {
    expect(parseAddress('dave@m.fontawesome.com')?.rootDomain).toBe('fontawesome.com');
  });

  it('rejects anything that is not an address', () => {
    expect(parseAddress(null)).toBeNull();
    expect(parseAddress('')).toBeNull();
    expect(parseAddress('not-an-address')).toBeNull();
    expect(parseAddress('@dell.com')).toBeNull();
    expect(parseAddress('someone@')).toBeNull();
  });
});

describe('exactEmailKey', () => {
  it('treats case and header junk as the same address', () => {
    expect(exactEmailKey('H.Chaoui@douane.gov.ma')).toBe(exactEmailKey(' <h.chaoui@douane.gov.ma> '));
  });

  it('applies Gmail dot and +tag equivalence', () => {
    expect(exactEmailKey('j.smith+news@gmail.com')).toBe(exactEmailKey('jsmith@googlemail.com'));
  });

  it('does not apply dot equivalence off Gmail', () => {
    // Same person, but not the same mailbox — this is the alias rule's job, and
    // it only fires with a corroborating name.
    expect(exactEmailKey('ahmed.bouna@dell.com')).not.toBe(exactEmailKey('ahmedbouna@dell.com'));
  });

  it('does not strip +tags off Gmail — they identify the sender there', () => {
    // Ariba routes different parties through one address this way.
    expect(exactEmailKey('s4system-prodeu+wafaassurance.doc1@eusmtp.ariba.com')).not.toBe(
      exactEmailKey('s4system-prodeu+744532108.doc2@eusmtp.ariba.com')
    );
  });
});

describe('aliasLocalPartKey', () => {
  it('matches separator variants of one local part', () => {
    expect(aliasLocalPartKey('ahmed.bouna@dell.com')).toBe(aliasLocalPartKey('ahmed_bouna@dell.com'));
    expect(aliasLocalPartKey('y.nadif@dell.com')).toBe(aliasLocalPartKey('y_nadif@dell.com'));
  });

  it('matches a malformed capture against its clean form', () => {
    // Both are in the real data — a stray leading dash and a doubled dot.
    expect(aliasLocalPartKey('-lassaad.jaziri@banquezitouna.com')).toBe(
      aliasLocalPartKey('lassaad.jaziri@banquezitouna.com')
    );
    expect(aliasLocalPartKey('y..idrissi@powerm.ma')).toBe(aliasLocalPartKey('y.idrissi@powerm.ma'));
  });

  it('matches across a mail subdomain', () => {
    expect(aliasLocalPartKey('dave@fontawesome.com')).toBe(aliasLocalPartKey('dave@m.fontawesome.com'));
  });

  it('keeps different root domains apart even for an identical local part', () => {
    // `domainToCompanyName` files intelcom.co.ma and lydec.co.ma under one "CO"
    // company. Without the root-domain guard these two would be one contact.
    expect(aliasLocalPartKey('contact@intelcom.co.ma')).not.toBe(aliasLocalPartKey('contact@lydec.co.ma'));
  });

  it('keeps +tagged senders apart off Gmail', () => {
    expect(aliasLocalPartKey('reminders+clzmtdwf7rt@receivables.freshworks.com')).not.toBe(
      aliasLocalPartKey('reminders+cvq0zntgi@receivables.freshworks.com')
    );
  });
});

describe('initialFormKey', () => {
  it('reduces a spelled-out local part to its initial form', () => {
    expect(initialFormKey('abdessamad.jehouani@gti.co.ma')).toBe(initialFormKey('ajehouani@gti.co.ma'));
    expect(initialFormKey('john.smith@acme.com')).toBe(initialFormKey('jsmith@acme.com'));
    expect(initialFormKey('j.smith@acme.com')).toBe(initialFormKey('john.smith@acme.com'));
  });

  it('does not reach across root domains', () => {
    expect(initialFormKey('john.smith@acme.com')).not.toBe(initialFormKey('jsmith@other.com'));
  });

  it('leaves different surnames alone', () => {
    expect(initialFormKey('john.smith@acme.com')).not.toBe(initialFormKey('john.smyth@acme.com'));
  });
});

describe('nameKey', () => {
  it('ignores word order and punctuation', () => {
    expect(nameKey('Azgaou,', 'Karim')).toBe(nameKey('Karim', 'Azgaou'));
    expect(nameKey('Semlali,', 'Salma')).toBe(nameKey('Salma', 'Semlali'));
  });

  it('folds diacritics and case', () => {
    expect(nameKey('Élodie', 'Château')).toBe(nameKey('elodie', 'chateau'));
  });

  it('is empty when there is nothing to compare', () => {
    expect(nameKey('', '')).toBe('');
    expect(nameKey(null, null)).toBe('');
    expect(nameKey('  ', '-')).toBe('');
  });

  it('separates names that merely overlap', () => {
    expect(nameKey('Google', 'My Business Noreply')).not.toBe(nameKey('Google', 'My Business'));
    expect(nameKey('Barbara', 'Rainho')).not.toBe(nameKey('Marissa', 'Creatore'));
  });
});
