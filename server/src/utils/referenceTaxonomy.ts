/**
 * Standard tags for the client references register.
 *
 * A reference keeps its technologies and services as the letter wrote them —
 * that wording goes into bids. But the same thing is written forty ways: the
 * IBM Power family alone appears as "Power 10", "Power10 S1024", "POWER8
 * E880C", "Pseries", "8205-E6C", even "BM Power System". A search for "Power
 * references" cannot list those spellings, so each reference also carries the
 * tags below, derived from what it says on every write. Nothing else writes
 * them; to tag a reference differently, change its wording or these rules.
 *
 * Rules match the folded text (lower case, accents dropped), and a tag
 * applies when any of its patterns matches any line. Order is the order the
 * filter lists them in.
 */

export function fold(text: string): string {
  // Ligatures are letters of their own to NFD: "Nœuds" must still read "noeuds".
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

interface TagRule {
  tag: string;
  patterns: RegExp[];
  /** A line matching one of these never takes the tag, whatever else it says. */
  unless?: RegExp[];
  /**
   * Another vendor's product names, removed from the line before the patterns
   * run — so "Dell PowerEdge R740 et IBM Power 10" still takes IBM Power,
   * where an `unless` would have vetoed the whole line. Must be global.
   */
  strip?: RegExp;
}

/** Dell's "Power" products, which are not IBM Power. */
const DELL_POWER = /poweredge|powervault|powerscale|powerstore|powermax|power ?bi\b/g;

/**
 * Power models by generation. The bare model numbers are how most letters
 * name the servers ("2 x E950", "S922"), and the 82xx-xxx machine types are
 * the POWER7 era's.
 */
const POWER7 = /\bpower ?7\b|\bp ?7[0-9]0\b|\b82(0[2-5]|3[1-3])-[a-z0-9]{3}\b/;
const POWER8 = /\bpower ?8\b|\b[se]8(1[24]|2[24]|50|70|80)c?\b/;
const POWER9 = /\bpower ?9\b|\b[s]9(1[24]|2[24])\b|\be9(50|80)\b/;
const POWER10 = /\bpower ?10\b|\bpower ?10(1[24]|2[24])\b|\bs10(1[24]|2[24])\b|\be10(50|80)\b/;
const POWER11 = /\bpower ?11\b|\bs11(1[24]|2[24])\b|\be11(50|80)\b/;

export const TECHNOLOGY_TAGS: TagRule[] = [
  {
    tag: 'IBM Power',
    patterns: [
      /\bpower ?(5|6|7|8|9|10|11)\b/,
      /\bpower ?1[01](1[24]|2[24])\b/,
      /\bpower ?(systems?|scale ?out)\b/,
      /\bp ?series\b/,
      /\bibm power\b/,
      /\bserveurs? (ibm )?power\b/,
      /\b[se](8(1[24]|2[24]|50|70|80)|9(1[24]|2[24]|50|80)|1[01](1[24]|2[24]|50|80))c?\b/,
      /\bp ?7[0-9]0\b/,
      /\b82(0[2-5]|3[1-3])-[a-z0-9]{3}\b/,
      /\bhmc\b|hardware management console|7063-cr/,
      /\bnovalink\b/,
    ],
    // "Power SC/VC/VM/HA" is software, tagged below.
    strip: DELL_POWER,
  },
  { tag: 'IBM Power 7', patterns: [POWER7], strip: DELL_POWER },
  { tag: 'IBM Power 8', patterns: [POWER8], strip: DELL_POWER },
  { tag: 'IBM Power 9', patterns: [POWER9], strip: DELL_POWER },
  { tag: 'IBM Power 10', patterns: [POWER10], strip: DELL_POWER },
  { tag: 'IBM Power 11', patterns: [POWER11], strip: DELL_POWER },
  {
    tag: 'AIX & PowerVM',
    patterns: [
      /\baix\b/,
      /\bpower ?(vm|vc|ha|sc)\b/,
      /\bvm ?recovery ?manager\b|\bvmrm?\b|\bvrm\b/,
      /\blpm\b|live partition mobility/,
      /\bxl ?c\b|open xl|\bxlc\b/,
      /private cloud edition/,
      /cloud (management|mgmt) console/,
      /\bswma\b|expert care/,
    ],
  },
  { tag: 'IBM i', patterns: [/\bibm i\b|\bas\/?400\b|\biseries\b|system i\b|icluster|\bmimix\b/] },
  { tag: 'IBM Z / LinuxONE', patterns: [/linux ?one|mainframe|\bibm z\b|system z\b|\bz1[3-7]\b/] },
  {
    // Any vendor's storage: "références stockage" is asked as often as a brand.
    tag: 'Storage',
    patterns: [
      /stockage|\bstorage\b(?! networking)|\bbaies?\b|\bnas\b|\bnvme\b/,
      /flash ?system|stor?wize|strowize|\bsvc\b|san volume controller|\bds ?[3-8]\d{3}|\bxiv\b|\bn6040\b/,
      /\bunity\b|\bvnxe?\b|\bvmax\b|powermax|powerstore|isilon|powervault md|dorado|oceanstor|eternus|netapp|ontap/,
    ],
    unless: [/storage networking|san\d|switch|protect|defender|backup|sauvegarde|ceph|scale|\bsuite\b/],
  },
  {
    tag: 'IBM Storage',
    patterns: [
      /flash ?system|\bfs ?\d{4}\b|\bfs9\d{3}|\bfs7\d{3}|\bfs5\d{3}/,
      /stor?wize|strowize/,
      /\bsvc\b|san volume controller|spectrum virtualize/,
      /\bds ?[3-8]\d{3}[a-z]?\b/,
      /\bxiv\b|\bn6040\b|system storage n\d{4}|spectrum storage suite/,
      /\bv[357]000\b|\bv3700\b|\bv5030\b/,
      /ibm storage (?!networking|ceph|scale|defender|protect)/,
      /baies? de stockage ibm|stockage ibm/,
      /storage anomaly detection|enhanced remote mirror|metro mirror|global mirror|\btpc\b|spectrum control/,
    ],
  },
  { tag: 'IBM Storage Scale & Ceph', patterns: [/spectrum scale|storage scale|\bgpfs\b|storage ceph|\bceph\b|\bhsm\b|spectrum archive/] },
  {
    tag: 'SAN switches',
    patterns: [
      /\bsan ?\d{2,3}b\b|\bsan\d{2,3}b-\d\b|\b24-b5\b/,
      /brocades?|borcade/,
      /connectrix|\bmds ?9\d{3}\b/,
      /switch(s|es)? (san|fibre|fiber|fc)\b|switchs? (ibm )?(storage networking|system networking)|commutateurs? san|switchs? san|\bsannav\b/,
      /fibre channel ibn|switchs? fibre channel|switchs? fiber channel|switch fc\b|switchs reseaux fc/,
    ],
  },
  {
    tag: 'Backup',
    patterns: [
      /sauvegarde|backup|\bvtl\b/,
      /spectrum protect|tivoli storage manage|\btsm\b|storage defender/,
      /protec ?t?tier|\bts ?7[56]\d{2}\b/,
      /\bts ?[34]\d{3}\b|\btapes?\b|librairie|\blto\b|robot|powervault tl|lecteurs? de bandes|\b3592\b/,
      /data ?domain|avamar|networker|net ?backup|veritas|commvault|veeam|rubrik|cohesity|storage protect/,
    ],
  },
  { tag: 'Red Hat OpenShift', patterns: [/openshift|\bokd\b|kubernetes|\bodf\b/] },
  {
    tag: 'Red Hat Enterprise Linux',
    patterns: [/red ?hat (enterprise |entreprise )?(linux|le\b|virtualization)|\brhel\b|redhat le\b|linux red ?hat|red ?hat linux|redhat smart management|red ?hat satellite/],
  },
  { tag: 'Ansible', patterns: [/ansible/] },
  { tag: 'SUSE', patterns: [/\bsuse\b|\bsles\b/] },
  { tag: 'IBM Cloud Pak', patterns: [/cloud ?pac?k|cloupak/] },
  { tag: 'IBM watsonx & AI', patterns: [/watson|watsonx|\bwx\b|granite|code assistant/] },
  { tag: 'IBM Data & Analytics', patterns: [/cognos|datastage|infosphere|information server|planning analytics|\bspss\b|watson studio|\bopenpages\b/] },
  { tag: 'GPU & AI infrastructure', patterns: [/nvidia|\bgpu\b|\bh100\b|\bh200\b|\bl40s?\b|\bgb[23]00\b|\brtx ?\d|\ba100\b|fusion hci|lm cache|\bllm\b/] },
  { tag: 'IBM Fusion', patterns: [/\bfusion\b/] },
  { tag: 'IBM Db2', patterns: [/\bdb2\b/] },
  { tag: 'PostgreSQL & EDB', patterns: [/postg?res|\bedb\b/] },
  { tag: 'Other databases', patterns: [/mongodb|arangodb|sql server|informix|mysql|mariadb|cassandra|redis/] },
  { tag: 'Oracle', patterns: [/oracle|exadata|exacc|\bsparc\b|solaris|super ?cluster|storagetek|zfs storage|goldengate|\bsun\b|universal credits/] },
  { tag: 'IBM middleware', patterns: [/websphere|\bmq\b|mq ?series|integration bus|app connect|txseries|\bcics\b|liberty|jboss|\brational\b|\bodm\b|business automation|api connect|datapower|\bportal\b|digital experience/] },
  { tag: 'File transfer', patterns: [/axway|\bcft\b|aspera|sterling|connect:? ?direct/] },
  { tag: 'ECM & GED', patterns: [/alfresco|\bged\b|\becm\b|filenet|content manager|nuxeo/] },
  { tag: 'Data security', patterns: [/guardium|qradar|sklm|trusteer|security verify|security key lifecycle|maas360|cryptage|chiffrement|encryption|directory server|\biam\b|identity|access manager/] },
  { tag: 'VMware', patterns: [/vmware|vsph[eo]re|vcenter|\bnsx\b|site recovery manager|\bsrm\b|vsan\b|vrealize|\baria\b/] },
  { tag: 'x86 servers', patterns: [/poweredge|thinksystem|think system|thinkserver|thinkagile|proliant|\bx3[56]50\b|xseries|\blames?\b|\bblades?\b|bladecenter|chassis ibm|\bhs(1|2)\d\b|m1000e|wintel|\bx86\b|nutanix|\bsr[5-9]\d0\b|plateforme de compute|serveurs? (de traitement )?intel|\blenovo\b|fujitsu rx|primergy|dell (emc )?(pe )?r[6-9]\d0\b|\bpe r[6-9]\d0\b/] },
  { tag: 'Dell EMC storage', patterns: [/\bunity\b|\bvnx\b|\bvmax\b|vplex|recoverpoint|powermax|powerstore|isilon|powerscale/] },
  { tag: 'Huawei', patterns: [/huawei|dorado|oceanstor/] },
  {
    tag: 'Network & security',
    patterns: [
      /forti(gate|web|net)|forcepoint|mcafee|\bf5\b|big-?ip|palo alto|checkpoint|cisco|nexus|catalyst|mellanox|infiniband|firewall|\bips\b|load balanc/,
      /\bswitch(s|es)?\b|commutateurs?|networking n\d{4}|\bs4148|equipements actifs reseau|telephonie/,
    ],
    // A SAN switch is tagged above, not here.
    unless: [/\bsan\b|fibre channel|fiber channel|\bfc\b|brocade|borcade|\bmds\b|storage networking/],
  },
  { tag: 'HPC', patterns: [/\bhpc\b|haute performance|calcul|batch|traitement par lots|lsf\b|slurm/] },
  { tag: 'Data platform', patterns: [/hadoop|spark|kafka|nifi|ambari|\byarn\b|elastic ?search|superset|airflow|cloudera|minio|data fabric|watsonx\.data|kubeflow|rclone/] },
  { tag: 'Observability & DevOps', patterns: [/grafana|prometheus|instana|tivoli monitoring|\bitm\b|gitlab|tekton|fluentd|\bkong\b|observab|monitoring|supervision|nagios|turbonomic|systems? director|workload scheduler|\btws\b|\bconcert\b|morpheus|cloud management|multicloud/] },
  { tag: 'Microsoft', patterns: [/windows|exchange|microsoft|active directory|hyper-v/] },
  { tag: 'SAP', patterns: [/\bsap\b|\bhana\b/] },
];

export const PRESTATION_TAGS: TagRule[] = [
  { tag: 'Supply', patterns: [/fourniture|acquisition|achat|livraison|licen[cs]e|souscription|subscription|supply|\bvente\b|renouvellement|extension/] },
  { tag: 'Installation & configuration', patterns: [/install|configur|parametr|mise en (place|service|oeuvre|œuvre|production|exploitation)|deploi|implementation|integration|mise a niveau|upgrade|build|virtualis|preparation|prerequis/] },
  { tag: 'Migration', patterns: [/migr|bascule|demenagement|deplacement|transfert du|modernisation|portage|conteneuris/] },
  { tag: 'Maintenance & support', patterns: [/maintenance|support|assistance|garantie|warranty|\bswma\b|expert care|mco\b|maintien en condition|entretien|correction|contournement|incident|depannage/] },
  // Word-initial: "formation" is also the end of "information".
  { tag: 'Training & skills transfer', patterns: [/\bformations?\b|transfert de competence|training|accompagnement/] },
  { tag: 'Managed services', patterns: [/infogerance|exploitation|\brun\b|managed|administration|supervision|monitoring|soutien|hebergement|as a service|\b(i|p|s)aas\b/] },
  { tag: 'Project management', patterns: [/conduite (du|de) projet|gestion de projet|pilotage|chef(ferie)? de projet|project management|ingenierie/] },
  { tag: 'Audit & consulting', patterns: [/audit|healthcheck|health check|conseil|etude|design|architecture|assessment|cadrage|dimensionnement|sizing|\bpoc\b|\bpot\b/] },
  { tag: 'Disaster recovery & HA', patterns: [/\bpra\b|\bpca\b|\bpsi\b|plan de secours|reprise|disaster|secours|replication|haute disponibilite|high availab|\bha\/dr\b|\bdr\b/] },
  { tag: 'Security', patterns: [/securi|cryptage|chiffrement|hardening|durcissement/] },
];

function matches(rule: TagRule, line: string): boolean {
  const text = rule.strip ? line.replace(rule.strip, ' ') : line;
  if (rule.unless?.some((re) => re.test(text))) return false;
  return rule.patterns.some((re) => re.test(text));
}

/** The tags any of `lines` earns, in the rules' order, each once. */
export function tagsFor(lines: Array<string | null | undefined>, rules: TagRule[]): string[] {
  const folded = lines.filter((l): l is string => Boolean(l && l.trim())).map(fold);
  return rules.filter((rule) => folded.some((line) => matches(rule, line))).map((r) => r.tag);
}

export const technologyTagsFor = (technologies: string[], projectName?: string | null) =>
  tagsFor([...technologies, projectName], TECHNOLOGY_TAGS);

export const prestationTagsFor = (prestations: string[]) => tagsFor(prestations, PRESTATION_TAGS);

/**
 * Vendor names as the partner column writes them. "Dell EMC", "EMC" and
 * "Dell Technologies" are one partner; so are "HP" and "HPE".
 */
const PARTNER_ALIASES: Array<[RegExp, string]> = [
  [/^ibm\b|^ibm$/, 'IBM'],
  [/red ?hat/, 'Red Hat'],
  [/vmware|broadcom/, 'VMware'],
  [/oracle|\bsun\b/, 'Oracle'],
  [/dell|\bemc\b/, 'Dell Technologies'],
  [/lenovo/, 'Lenovo'],
  [/cisco/, 'Cisco'],
  [/nvidia|mellanox/, 'NVIDIA'],
  [/microsoft/, 'Microsoft'],
  [/^hp|hewlett/, 'HPE'],
  [/brocade/, 'Brocade'],
  [/suse/, 'SUSE'],
  [/huawei/, 'Huawei'],
  [/forti/, 'Fortinet'],
  [/^f5/, 'F5'],
  [/veritas/, 'Veritas'],
  [/commvault/, 'Commvault'],
  [/veeam/, 'Veeam'],
  [/\bedb\b|enterprisedb/, 'EDB'],
  [/nutanix/, 'Nutanix'],
  [/\bsap\b/, 'SAP'],
];

/** One spelling per vendor; an unknown vendor is kept as written. */
export function canonicalPartner(name: string): string {
  const trimmed = name.trim();
  const folded = fold(trimmed);
  const hit = PARTNER_ALIASES.find(([re]) => re.test(folded));
  return hit ? hit[1] : trimmed;
}

export function canonicalPartners(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (!n.trim()) continue;
    const c = canonicalPartner(n);
    if (!out.some((o) => fold(o) === fold(c))) out.push(c);
  }
  return out;
}

export const TECHNOLOGY_TAG_NAMES = TECHNOLOGY_TAGS.map((r) => r.tag);
export const PRESTATION_TAG_NAMES = PRESTATION_TAGS.map((r) => r.tag);
