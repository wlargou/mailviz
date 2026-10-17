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
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface TagRule {
  tag: string;
  patterns: RegExp[];
  /** A line matching one of these never takes the tag, whatever else it says. */
  unless?: RegExp[];
}

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
    // "PowerEdge" is Dell, "PowerVault" and "PowerScale" too; "Power SC/VC/VM/HA"
    // is software, tagged below.
    unless: [/poweredge|powervault|powerscale|powerstore|powermax|power ?bi\b/],
  },
  { tag: 'IBM Power 7', patterns: [POWER7] },
  { tag: 'IBM Power 8', patterns: [POWER8], unless: [/poweredge/] },
  { tag: 'IBM Power 9', patterns: [POWER9], unless: [/poweredge/] },
  { tag: 'IBM Power 10', patterns: [POWER10], unless: [/poweredge/] },
  { tag: 'IBM Power 11', patterns: [POWER11], unless: [/poweredge/] },
  {
    tag: 'AIX & PowerVM',
    patterns: [
      /\baix\b/,
      /\bpower ?(vm|vc|ha|sc)\b/,
      /\bvm ?recovery ?manager\b|\bvmrm?\b|\bvrm\b/,
      /\blpm\b|live partition mobility/,
      /\bxl ?c\b|open xl|\bxlc\b/,
      /private cloud edition/,
      /cloud management console/,
      /\bswma\b|expert care/,
    ],
  },
  { tag: 'IBM i', patterns: [/\bibm i\b|\bas\/?400\b|\biseries\b|system i\b/] },
  { tag: 'IBM Z / LinuxONE', patterns: [/linux ?one|mainframe|\bibm z\b|system z\b|\bz1[3-7]\b/] },
  {
    tag: 'IBM Storage',
    patterns: [
      /flash ?system|\bfs ?\d{4}\b|\bfs9\d{3}|\bfs7\d{3}|\bfs5\d{3}/,
      /stor?wize|strowize/,
      /\bsvc\b|san volume controller|spectrum virtualize/,
      /\bds ?[3-8]\d{3}[a-z]?\b/,
      /\bxiv\b/,
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
      /b[ro]r?cade|borcade/,
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
      /protec?t ?ti?er|\bts ?7[56]\d{2}\b/,
      /\bts ?[34]\d{3}\b|tape|librairie|\blto\b|robot|powervault tl/,
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
  { tag: 'IBM Cloud Pak', patterns: [/cloud ?pak|cloupak/] },
  { tag: 'IBM watsonx & AI', patterns: [/watson|watsonx|\bwx\b|granite|code assistant/] },
  { tag: 'GPU & AI infrastructure', patterns: [/nvidia|\bgpu\b|\bh100\b|\bh200\b|\bl40s?\b|\bgb[23]00\b|\brtx ?\d|\ba100\b|fusion hci|lm cache|\bllm\b/] },
  { tag: 'IBM Fusion', patterns: [/\bfusion\b/] },
  { tag: 'IBM Db2', patterns: [/\bdb2\b/] },
  { tag: 'PostgreSQL & EDB', patterns: [/postg?res|\bedb\b/] },
  { tag: 'Other databases', patterns: [/mongodb|arangodb|sql server|informix|mysql|mariadb|cassandra|redis/] },
  { tag: 'Oracle', patterns: [/oracle|exadata|exacc|\bsparc\b|solaris|super ?cluster|storagetek|zfs storage|goldengate|\bsun\b/] },
  { tag: 'IBM middleware', patterns: [/websphere|\bmq\b|integration bus|app connect|txseries|\bcics\b|liberty|jboss|rational|\bodm\b|business automation|api connect|datapower/] },
  { tag: 'IBM security', patterns: [/guardium|qradar|sklm|trusteer|security verify|security key lifecycle|maas360/] },
  { tag: 'VMware', patterns: [/vmware|vsph[eo]re|vcenter|\bnsx\b|site recovery manager|\bsrm\b|vsan\b|vrealize|aria/] },
  { tag: 'x86 servers', patterns: [/poweredge|thinksystem|think system|thinkserver|thinkagile|proliant|\bx3[56]50\b|xseries|\blames?\b|\bblades?\b|\bhs(1|2)\d\b|m1000e|wintel|\bx86\b|nutanix|\bsr[5-9]\d0\b|plateforme de compute|serveurs? (de traitement )?intel/] },
  { tag: 'Dell EMC storage', patterns: [/\bunity\b|\bvnx\b|\bvmax\b|vplex|recoverpoint|powermax|powerstore|isilon|powerscale/] },
  { tag: 'Huawei', patterns: [/huawei|dorado|oceanstor/] },
  { tag: 'Network & security', patterns: [/forti(gate|web|net)|forcepoint|mcafee|\bf5\b|big-?ip|palo alto|checkpoint|cisco|nexus|catalyst|mellanox|infiniband|switch(s|es)? (ethernet|core|10)|commutateurs haut debit|networking n40|\bs4148|firewall|\bips\b|load balanc/] },
  { tag: 'HPC', patterns: [/\bhpc\b|haute performance|calcul|batch|traitement par lots|lsf\b|slurm/] },
  { tag: 'Data platform', patterns: [/hadoop|spark|kafka|nifi|ambari|\byarn\b|elastic ?search|superset|airflow|cloudera|minio|data fabric|watsonx\.data|kubeflow|rclone/] },
  { tag: 'Observability & DevOps', patterns: [/grafana|prometheus|instana|tivoli monitoring|\bitm\b|gitlab|tekton|fluentd|kong|observab|monitoring|turbonomic|system director|workload scheduler|\btws\b|concert/] },
  { tag: 'Microsoft', patterns: [/windows|exchange|microsoft|active directory|hyper-v/] },
  { tag: 'SAP', patterns: [/\bsap\b|hana/] },
];

export const PRESTATION_TAGS: TagRule[] = [
  { tag: 'Supply', patterns: [/fourniture|acquisition|achat|livraison|licen[cs]e|souscription|subscription|supply|vente/] },
  { tag: 'Installation & configuration', patterns: [/install|configur|parametr|mise en (place|service|oeuvre|œuvre|production|exploitation)|deploi|implementation|integration|mise a niveau|upgrade|build/] },
  { tag: 'Migration', patterns: [/migr|bascule/] },
  { tag: 'Maintenance & support', patterns: [/maintenance|support|assistance|garantie|warranty|\bswma\b|expert care|mco\b|maintien en condition/] },
  { tag: 'Training & skills transfer', patterns: [/formation|transfert de competence|training|accompagnement/] },
  { tag: 'Managed services', patterns: [/infogerance|exploitation|\brun\b|managed|administration|supervision|hebergement|as a service|\b(i|p|s)aas\b/] },
  { tag: 'Audit & consulting', patterns: [/audit|healthcheck|health check|conseil|etude|design|architecture|assessment|cadrage|dimensionnement|sizing|\bpoc\b|\bpot\b/] },
  { tag: 'Disaster recovery & HA', patterns: [/\bpra\b|\bpca\b|\bpsi\b|plan de secours|reprise|disaster|secours|replication|haute disponibilite|high availab|\bha\/dr\b|\bdr\b/] },
  { tag: 'Security', patterns: [/securi|cryptage|chiffrement|hardening|durcissement/] },
];

function matches(rule: TagRule, line: string): boolean {
  if (rule.unless?.some((re) => re.test(line))) return false;
  return rule.patterns.some((re) => re.test(line));
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
