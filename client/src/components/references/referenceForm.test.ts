import { describe, it, expect } from 'vitest';
import { changedInput, formErrors, toForm, toInput } from './referenceForm';
import { makeReference } from './testFixtures';

describe('the reference form', () => {
  it('sends only what changed', () => {
    const base = toForm(makeReference());
    expect(changedInput({ ...base, city: 'Rabat' }, base)).toEqual({ city: 'Rabat' });
    expect(changedInput(base, base)).toEqual({});
    // Retyping the same amount another way is no change.
    expect(changedInput({ ...base, amount: '16090620' }, base)).toEqual({});
    expect(changedInput({ ...base, amount: '16 090 620,50' }, base)).toEqual({ amount: 16090620.5 });
    expect(changedInput({ ...base, projectEnd: '06/2023' }, base)).toEqual({ projectEnd: '2023-06' });
  });

  it('sends the whole signatory list when one changes, blanks dropped', () => {
    const base = toForm(makeReference());
    const form = { ...base, signatories: [...base.signatories.map((s) => ({ ...s, role: 'Directeur Général' })), { key: 'x', name: ' ', role: '' }] };
    expect(changedInput(form, base)).toEqual({ signatories: [{ name: 'Mikael NACIRI', role: 'Directeur Général' }] });
  });

  it('reads lists one per line, and partners by comma', () => {
    const input = toInput({ ...toForm(makeReference()), technologies: 'IBM Power 10\n\n  HMC  ', partners: 'IBM, Red Hat;VMware' });
    expect(input.technologies).toEqual(['IBM Power 10', 'HMC']);
    expect(input.partners).toEqual(['IBM', 'Red Hat', 'VMware']);
  });

  it('says what is wrong, field by field', () => {
    const base = toForm(makeReference());
    expect(formErrors(base)).toEqual({});
    expect(Object.keys(formErrors({ ...base, customerName: ' ', amount: '12 abc', projectStart: '31/02/2025', signedAt: '12/2023', currency: 'DH' })).sort()).toEqual(
      ['amount', 'currency', 'customerName', 'projectStart', 'signedAt'],
    );
  });
});
