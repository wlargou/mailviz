import { describe, it, expect } from 'vitest';
import { canonicalPartners, prestationTagsFor, technologyTagsFor } from './referenceTaxonomy.js';

/**
 * The standard tags are what "Power references" searches on, so a spelling
 * the rules miss is a reference the bid team never sees — and a rule that
 * over-matches puts a Dell server in a Power pack. Every case below is a line
 * from the real attestations.
 */
describe('technologyTagsFor', () => {
  it.each([
    ['BM Power System E1050', ['IBM Power', 'IBM Power 10']],
    ['Serveurs IBM Power1024', ['IBM Power', 'IBM Power 10']],
    ['IBM Power11 S1124', ['IBM Power', 'IBM Power 11']],
    ['Serveurs Entreprise IBM POWER8 E880C', ['IBM Power', 'IBM Power 8']],
    ['IBM Power 9 S922', ['IBM Power', 'IBM Power 9']],
    ['Serveur de bases de données IBM Power7 8205-E6C', ['IBM Power', 'IBM Power 7']],
    ['IBM Power P750 +', ['IBM Power', 'IBM Power 7']],
    ['Acquisition de serveurs Pseries', ['IBM Power']],
    ['Console HMC', ['IBM Power']],
    ['IBM PowerHA SystemMirror Enterprise Edition V7.2', ['AIX & PowerVM']],
    ['IBM AIX 7.3 Base Install', ['AIX & PowerVM']],
  ])('%s → %j', (line, tags) => {
    expect(technologyTagsFor([line])).toEqual(tags);
  });

  it('does not take a Dell PowerEdge or a PowerVault for an IBM Power', () => {
    expect(technologyTagsFor(['DELL EMC PowerEdge R630'])).toEqual(['x86 servers']);
    expect(technologyTagsFor(['Robot de sauvegarde DELL PowerVault TL4000'])).toEqual(['Backup']);
  });

  it.each([
    ['Baie de stockage IBM Full Flash FS7200 NVMe', 'IBM Storage'],
    ['IBM Strowize V7000', 'IBM Storage'],
    ['IBM SAN Volume Controller (IBM SVC)', 'IBM Storage'],
    ['Switchs SAN Brocade 64Gpbs', 'SAN switches'],
    ['Switch Fibre Channel IBM SAN Borcade Dernière Génération', 'SAN switches'],
    ['IBM Spectrum Protect Plus', 'Backup'],
    ['VTL: Deux Appliance IBM ProtecTier TS7610', 'Backup'],
    ['Red Hat OpenShift Container Platform', 'Red Hat OpenShift'],
    ['Redhat LE for SAP HANA', 'Red Hat Enterprise Linux'],
    ['VMware vSphore Entreprise Plus', 'VMware'],
    ['Oracle Exadata Cloud@Customer X11M', 'Oracle'],
    ['IBM LinuxOne Rockhopper II - Z14 (Mainframe)', 'IBM Z / LinuxONE'],
    ['Plateforme GPU IBM Fusion HCI with 24 x NVIDIA H200', 'GPU & AI infrastructure'],
    ['IBM Spectrum Scale (GPFS)', 'IBM Storage Scale & Ceph'],
  ])('%s takes %s', (line, tag) => {
    expect(technologyTagsFor([line])).toContain(tag);
  });

  it('reads the project name too, and leaves an unknown line untagged', () => {
    expect(technologyTagsFor([], 'Mise en place d’une plateforme IBM Power 11')).toEqual(['IBM Power', 'IBM Power 11']);
    expect(technologyTagsFor(['Câbles d’alimentation et de raccordement'])).toEqual([]);
  });
});

describe('prestationTagsFor', () => {
  it('maps the letters’ wording onto the services a tender asks for', () => {
    expect(
      prestationTagsFor([
        'Acquisition et souscription des licences IBM (Contrat ELA)',
        'Prestations de migration depuis les serveurs IBM Power 8 et 9 vers IBM Power 11',
        'Prestations de transfert de compétences et formation des équipes',
        'Prestations d’infogérance globale de la plateforme',
        'Mise en place PSI',
      ]),
    ).toEqual(['Supply', 'Installation & configuration', 'Migration', 'Training & skills transfer', 'Managed services', 'Disaster recovery & HA']);
  });

  it('does not read "dépôt" as a proof of technology', () => {
    expect(prestationTagsFor(['Dépôt des équipements'])).toEqual([]);
  });
});

describe('canonicalPartners', () => {
  it('keeps one spelling per vendor and an unknown vendor as written', () => {
    expect(canonicalPartners(['IBM', 'ibm', 'Dell EMC', 'EMC', 'HP', 'Mellanox', 'TensorMesh', ' '])).toEqual([
      'IBM',
      'Dell Technologies',
      'HPE',
      'NVIDIA',
      'TensorMesh',
    ]);
  });
});
