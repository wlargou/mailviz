/**
 * What a tender response is made of.
 *
 * A Moroccan tender answer is a set of dossiers, each a list of pieces. The
 * kinds and the default pieces below come from the tenders this was built
 * against — the DGI's RC (27/2026/DGI, articles I–VI) and Tanger Med's
 * (TMPA_AO_56_26, articles 1.5–1.6) — not from memory. They are defaults:
 * every piece can be renamed, marked N/A or removed, and more added.
 *
 * The three dossiers are once per tender. The two offers are once per LOT:
 * on an allotted tender each lot is bid, and judged, on its own offer.
 */
export const RFP_FOLDER_KINDS = ['ADMINISTRATIF', 'TECHNIQUE', 'ADDITIF', 'OFFRE_TECHNIQUE', 'OFFRE_FINANCIERE', 'OTHER'] as const;
export type RfpFolderKind = (typeof RFP_FOLDER_KINDS)[number];

export const RFP_FOLDER_LABELS: Record<RfpFolderKind, string> = {
  ADMINISTRATIF: 'Dossier administratif',
  TECHNIQUE: 'Dossier technique',
  ADDITIF: 'Dossier additif',
  OFFRE_TECHNIQUE: 'Offre technique',
  OFFRE_FINANCIERE: 'Offre financière',
  OTHER: 'Autre',
};

/** Kinds prepared once per lot rather than once per tender. */
export const PER_LOT_KINDS: readonly RfpFolderKind[] = ['OFFRE_TECHNIQUE', 'OFFRE_FINANCIERE'];

export function isPerLotKind(kind: RfpFolderKind): boolean {
  return PER_LOT_KINDS.includes(kind);
}

/** The pieces each kind starts with. */
export const RFP_FOLDER_DEFAULT_ITEMS: Record<RfpFolderKind, readonly string[]> = {
  ADMINISTRATIF: [
    "Déclaration sur l'honneur",
    'Cautionnement provisoire',
    'Pièces justifiant les pouvoirs du signataire',
    'Attestation fiscale',
    'Attestation CNSS',
    'Certificat du registre de commerce',
  ],
  TECHNIQUE: [
    'Note des moyens humains et techniques',
    'Attestations de références',
  ],
  ADDITIF: [
    'CPS paraphé et signé « lu et accepté »',
    'RC paraphé et signé',
  ],
  OFFRE_TECHNIQUE: [
    'Tableau des moyens humains affectés',
    'CV des intervenants',
    'Diplômes',
    'Certificats',
    'Note méthodologique',
    'Offre de support',
  ],
  OFFRE_FINANCIERE: [
    "Acte d'engagement",
    'Bordereau des prix et détail estimatif',
  ],
  OTHER: [],
};

/**
 * Display order: the dossiers in the order an RC lists them, the offers
 * after, then anything else. Per-lot folders sort by lot within their kind.
 */
export function folderPosition(kind: RfpFolderKind, lotNumber: number | null): number {
  return RFP_FOLDER_KINDS.indexOf(kind) * 1000 + (lotNumber ?? 0);
}

export const RFP_ITEM_STATUSES = ['TODO', 'IN_PROGRESS', 'READY', 'NOT_APPLICABLE'] as const;
export type RfpItemStatus = (typeof RFP_ITEM_STATUSES)[number];
