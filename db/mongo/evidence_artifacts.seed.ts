// evidence_artifacts.seed.ts (Member A)
// Inserts one artifact document for each seeded MySQL evidence row (ids 1-25).
// Type of evidence id N = types[(N-1) % 6], exactly how 91_seed_evidence.sql assigns them:
//   Disk Image: 1,7,13,19,25   Mobile Device: 2,8,14,20   Network Capture: 3,9,15,21
//   Email Archive: 4,10,16,22  CCTV Footage: 5,11,17,23   Document Scan: 6,12,18,24
// Run after mongo:setup:  npm run mongo:seed      (re-running replaces the seed documents)
import { MongoClient } from "mongodb";

type Finding = { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; summary: string };
const TYPES = ["Disk Image", "Mobile Device", "Network Capture", "Email Archive", "CCTV Footage", "Document Scan"];

// ---- type-specific details (4-5 variations each, picked by position within its type) ----
const disk = [
  { partitions: [{ name: "C:", filesystem: "NTFS", size_gb: 450 }, { name: "D:", filesystem: "NTFS", size_gb: 50 }], total_size_gb: 500, imaging_tool: "FTK Imager 4.7" },
  { partitions: [{ name: "/", filesystem: "ext4", size_gb: 230 }, { name: "swap", filesystem: "swap", size_gb: 8 }], total_size_gb: 256, imaging_tool: "dd + dcfldd" },
  { partitions: [{ name: "Macintosh HD", filesystem: "APFS", size_gb: 490 }], total_size_gb: 512, imaging_tool: "Magnet ACQUIRE" },
  { partitions: [{ name: "E:", filesystem: "exFAT", size_gb: 120 }], total_size_gb: 128, imaging_tool: "FTK Imager 4.7" },
  { partitions: [{ name: "C:", filesystem: "NTFS", size_gb: 900 }, { name: "Recovery", filesystem: "NTFS", size_gb: 1 }], total_size_gb: 1000, imaging_tool: "EnCase 21" },
];
const mobile = [
  { imei: "356938035643809", os: "Android", os_version: "13", installed_apps: ["WhatsApp", "Telegram", "Signal", "Chrome", "Gmail"], contacts_count: 212 },
  { imei: "490154203237518", os: "iOS", os_version: "17.2", installed_apps: ["WhatsApp", "Telegram", "Instagram", "Safari", "ProtonVPN"], contacts_count: 340 },
  { imei: "352099001761481", os: "Android", os_version: "12", installed_apps: ["WhatsApp", "Facebook", "Chrome", "TrueCaller"], contacts_count: 87 },
  { imei: "867530902145678", os: "Android", os_version: "14", installed_apps: ["Signal", "Telegram", "Tor Browser", "WhatsApp", "Gmail"], contacts_count: 45 },
];
const network = [
  { protocols: ["TCP", "TLS", "HTTP", "DNS"], top_talkers: [{ ip: "10.0.0.15", bytes: 842113024 }, { ip: "185.199.110.153", bytes: 512004096 }], duration_sec: 3600 },
  { protocols: ["TCP", "SSH", "DNS"], top_talkers: [{ ip: "192.168.1.20", bytes: 128450000 }, { ip: "45.33.32.156", bytes: 99120000 }], duration_sec: 1800 },
  { protocols: ["UDP", "DNS", "QUIC"], top_talkers: [{ ip: "10.0.0.42", bytes: 64000000 }], duration_sec: 900 },
  { protocols: ["TCP", "SMB", "TLS", "FTP"], top_talkers: [{ ip: "10.0.0.7", bytes: 2048000000 }, { ip: "203.0.113.50", bytes: 1900000000 }], duration_sec: 7200 },
];
const email = [
  { mailbox: "cfo@example-corp.com", message_count: 14230, date_range: { from: new Date("2024-01-01"), to: new Date("2024-12-31") } },
  { mailbox: "it.admin@example-corp.com", message_count: 8120, date_range: { from: new Date("2024-06-01"), to: new Date("2025-01-15") } },
  { mailbox: "j.doe@example-corp.com", message_count: 3550, date_range: { from: new Date("2024-09-10"), to: new Date("2025-02-01") } },
  { mailbox: "hr@example-corp.com", message_count: 6010, date_range: { from: new Date("2023-11-01"), to: new Date("2024-10-30") } },
];
const cctv = [
  { camera_id: "CAM-LOBBY-01", duration_sec: 28800, resolution: "1920x1080", frame_rate: 25 },
  { camera_id: "CAM-PARKING-03", duration_sec: 14400, resolution: "1280x720", frame_rate: 15 },
  { camera_id: "CAM-SERVER-02", duration_sec: 21600, resolution: "2560x1440", frame_rate: 30 },
  { camera_id: "CAM-EXIT-04", duration_sec: 7200, resolution: "1920x1080", frame_rate: 25 },
];
const doc = [
  { page_count: 12, scan_dpi: 300, language: "en" },
  { page_count: 3, scan_dpi: 600, language: "en" },
  { page_count: 48, scan_dpi: 300, language: "hi" },
  { page_count: 7, scan_dpi: 200, language: "en" },
];
const detailsByType = [disk, mobile, network, email, cctv, doc];

// ---- findings and tags, varied by evidence id so aggregations have something to count ----
const findingPool: Finding[][] = [
  [{ severity: "CRITICAL", summary: "Deleted ledger spreadsheet recovered from unallocated space" }, { severity: "LOW", summary: "Routine system logs" }],
  [{ severity: "HIGH", summary: "Encrypted messaging app used around incident time" }],
  [{ severity: "MEDIUM", summary: "Unusual outbound traffic volume at night" }, { severity: "HIGH", summary: "Beaconing to a known malicious IP" }],
  [{ severity: "HIGH", summary: "Emails discussing transfer of confidential files" }, { severity: "MEDIUM", summary: "Auto-forward rule to external address" }],
  [{ severity: "LOW", summary: "No relevant activity in the first four hours" }],
  [{ severity: "MEDIUM", summary: "Signature mismatch on page 3" }],
  [],
  [{ severity: "CRITICAL", summary: "Credential dumping tool found in temp folder" }],
];
const tagPool = [
  ["malware", "financial-fraud"], ["insider-threat", "data-exfiltration"], ["encrypted-comms", "burner-phone"],
  ["phishing", "email"], ["physical-access", "cctv"], ["forgery", "document"], ["malware", "data-exfiltration"], ["financial-fraud", "insider-threat"],
];

const counters = [0, 0, 0, 0, 0, 0];
const docs = Array.from({ length: 25 }, (_, i) => {
  const id = i + 1;
  const t = i % 6;
  const variants = detailsByType[t];
  const details = variants[counters[t]++ % variants.length];
  return {
    evidence_id: id,
    evidence_type: TYPES[t],
    extracted_by: 5 + (i % 4),                                    // analysts 5-8
    extracted_at: new Date(Date.UTC(2025, 0, 9 + i * 9, 10, 0)),  // ~3 days after collection
    tags: tagPool[(i * 3 + t) % tagPool.length],
    findings: findingPool[(i * 5 + t) % findingPool.length],
    details,
  };
});

const client = new MongoClient(process.env.MONGODB_URI!);
try {
  const col = client.db(process.env.MONGODB_DB).collection("evidence_artifacts");
  await col.deleteMany({});
  const r = await col.insertMany(docs);
  console.log(`inserted ${r.insertedCount} documents`);

  // Validation demo (screenshot this): Mongo itself rejects a bad document.
  const bad = [
    { label: "missing evidence_type", doc: { evidence_id: 99, extracted_by: 5, extracted_at: new Date(), details: {} } },
    { label: "Mobile Device without imei/os", doc: { evidence_id: 99, evidence_type: "Mobile Device", extracted_by: 5, extracted_at: new Date(), details: { contacts_count: 1 } } },
    { label: "invalid severity 'URGENT'", doc: { evidence_id: 99, evidence_type: "Document Scan", extracted_by: 5, extracted_at: new Date(), details: { page_count: 1, scan_dpi: 300 }, findings: [{ severity: "URGENT", summary: "bad level" }] } },
  ];
  for (const b of bad) {
    try {
      await col.insertOne(b.doc);
      console.log(`UNEXPECTED: "${b.label}" was accepted`);
    } catch (e: any) {
      console.log(`rejected as expected (${b.label}): code ${e.code} ${e.codeName}`);  // 121 DocumentValidationFailure
    }
  }
  try {
    await col.insertOne({ ...docs[0], tags: ["dup"] });
  } catch (e: any) {
    console.log(`rejected as expected (duplicate evidence_id 1): code ${e.code}`);      // 11000
  }
} finally {
  await client.close();
}
