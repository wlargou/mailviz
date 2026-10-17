import { describe, it, expect } from 'vitest';
import { createClientReferenceSchema, updateClientReferenceSchema } from './clientReferenceValidator.js';

describe('createClientReferenceSchema', () => {
  it('needs the customer as the letter names it, trimmed before the length check', () => {
    expect(createClientReferenceSchema.safeParse({}).success).toBe(false);
    expect(createClientReferenceSchema.safeParse({ customerName: '   ' }).success).toBe(false);
    expect(createClientReferenceSchema.parse({ customerName: '  CMI ' }).customerName).toBe('CMI');
  });

  it('stores an empty text as nothing', () => {
    const parsed = createClientReferenceSchema.parse({ customerName: 'CMI', projectName: '   ', city: '' });
    expect(parsed.projectName).toBeNull();
    expect(parsed.city).toBeNull();
  });

  it('takes a project date at any precision, and a signature date to the day only', () => {
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', projectStart: '2025', projectEnd: '2025-07' }).success).toBe(true);
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', projectStart: '2025-02-30' }).success).toBe(false);
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', projectStart: '17/09/2026' }).success).toBe(false);
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', signedAt: '2026' }).success).toBe(false);
    expect(createClientReferenceSchema.parse({ customerName: 'X', signedAt: '' }).signedAt).toBeNull();
  });

  it('drops blank lines from the lists', () => {
    const parsed = createClientReferenceSchema.parse({ customerName: 'X', technologies: [' IBM Power 10 ', '', '  '] });
    expect(parsed.technologies).toEqual(['IBM Power 10']);
  });

  it('refuses a signatory with neither name nor role, and an unknown enum value', () => {
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', signatories: [{ name: '', role: ' ' }] }).success).toBe(false);
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', signatories: [{ role: 'DSI' }] }).success).toBe(true);
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', amountType: 'HTVA' }).success).toBe(false);
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', appreciation: 'GREAT' }).success).toBe(false);
    expect(createClientReferenceSchema.safeParse({ customerName: 'X', amount: -1 }).success).toBe(false);
  });
});

describe('updateClientReferenceSchema', () => {
  it('adds nothing the request did not send — no default can overwrite a field on a PATCH', () => {
    expect(updateClientReferenceSchema.parse({ city: 'Rabat' })).toEqual({ city: 'Rabat' });
    expect(updateClientReferenceSchema.parse({})).toEqual({});
  });
});
