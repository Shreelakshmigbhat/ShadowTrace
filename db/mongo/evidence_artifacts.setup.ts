// evidence_artifacts.setup.ts (Member A)
// Creates the `evidence_artifacts` collection with a $jsonSchema validator and its indexes.
// Safe to run many times. Run:  npm run mongo:setup
//
// DOCUMENT MODEL (one document per MySQL evidence row):
//   evidence_id    int      -> evidence.id in MySQL (the link between the two databases)
//   evidence_type  string   -> evidence_types.type_name in MySQL
//   extracted_by   int      -> users.id in MySQL
//   extracted_at   date
//   tags[]         strings
//   findings[]     { severity: LOW|MEDIUM|HIGH|CRITICAL, summary }
//   details        object whose fields DEPEND on evidence_type (this is why we use Mongo):
//     Mobile Device   : imei, os, os_version, installed_apps[], contacts_count
//     Disk Image      : partitions[{name, filesystem, size_gb}], total_size_gb, imaging_tool
//     Network Capture : protocols[], top_talkers[{ip, bytes}], duration_sec
//     Email Archive   : mailbox, message_count, date_range{from, to}
//     CCTV Footage    : camera_id, duration_sec, resolution, frame_rate
//     Document Scan   : page_count, scan_dpi, language
import { MongoClient } from "mongodb";

const SEVERITY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const TYPES = ["Disk Image", "Mobile Device", "Network Capture", "Email Archive", "CCTV Footage", "Document Scan"];
const INT = ["int", "long"];

// One branch per evidence type: "if evidence_type is X then details must contain these fields".
// ($jsonSchema has no if/then, so anyOf with one branch per type does the same job.)
function branch(type: string, detailProps: Record<string, object>, required: string[]) {
  return {
    properties: {
      evidence_type: { enum: [type] },
      details: { bsonType: "object", required, properties: detailProps },
    },
  };
}

const validator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["evidence_id", "evidence_type", "extracted_by", "extracted_at", "details"],
    properties: {
      evidence_id: { bsonType: INT, minimum: 1, description: "MySQL evidence.id" },
      evidence_type: { enum: TYPES, description: "MySQL evidence_types.type_name" },
      extracted_by: { bsonType: INT, minimum: 1 },
      extracted_at: { bsonType: "date" },
      tags: { bsonType: "array", items: { bsonType: "string" } },
      findings: {
        bsonType: "array",
        items: {
          bsonType: "object",
          required: ["severity", "summary"],
          properties: {
            severity: { enum: SEVERITY },
            summary: { bsonType: "string", minLength: 3 },
          },
        },
      },
      details: { bsonType: "object" },
    },
    anyOf: [
      branch("Mobile Device", {
        imei: { bsonType: "string", pattern: "^[0-9]{15}$" },
        os: { enum: ["Android", "iOS"] },
        os_version: { bsonType: "string" },
        installed_apps: { bsonType: "array", items: { bsonType: "string" } },
        contacts_count: { bsonType: INT, minimum: 0 },
      }, ["imei", "os", "os_version", "installed_apps", "contacts_count"]),
      branch("Disk Image", {
        partitions: {
          bsonType: "array",
          items: { bsonType: "object", required: ["filesystem", "size_gb"] },
        },
        total_size_gb: { bsonType: ["int", "long", "double"], minimum: 0 },
        imaging_tool: { bsonType: "string" },
      }, ["partitions", "total_size_gb", "imaging_tool"]),
      branch("Network Capture", {
        protocols: { bsonType: "array", items: { bsonType: "string" } },
        top_talkers: {
          bsonType: "array",
          items: { bsonType: "object", required: ["ip", "bytes"] },
        },
        duration_sec: { bsonType: INT, minimum: 0 },
      }, ["protocols", "top_talkers", "duration_sec"]),
      branch("Email Archive", {
        mailbox: { bsonType: "string" },
        message_count: { bsonType: INT, minimum: 0 },
        date_range: { bsonType: "object", required: ["from", "to"] },
      }, ["mailbox", "message_count", "date_range"]),
      branch("CCTV Footage", {
        camera_id: { bsonType: "string" },
        duration_sec: { bsonType: INT, minimum: 0 },
        resolution: { bsonType: "string" },
        frame_rate: { bsonType: INT, minimum: 1 },
      }, ["camera_id", "duration_sec", "resolution"]),
      branch("Document Scan", {
        page_count: { bsonType: INT, minimum: 1 },
        scan_dpi: { bsonType: INT, minimum: 50 },
        language: { bsonType: "string" },
      }, ["page_count", "scan_dpi"]),
    ],
  },
};

const client = new MongoClient(process.env.MONGODB_URI!);
try {
  const db = client.db(process.env.MONGODB_DB);
  const name = "evidence_artifacts";
  const exists = (await db.listCollections({ name }).toArray()).length > 0;

  if (!exists) {
    // validationAction 'error' = reject the write. ('warn' would only log it.)
    await db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
    console.log("created collection with validator");
  } else {
    // Collection already exists: update its validator in place.
    await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
    console.log("updated validator on existing collection");
  }

  const col = db.collection(name);
  // UNIQUE: one artifact document per MySQL evidence row.
  await col.createIndex({ evidence_id: 1 }, { unique: true, name: "uq_evidence_id" });
  // Multikey indexes (one index entry per array element): fast "find all docs tagged X"
  await col.createIndex({ tags: 1 }, { name: "idx_tags" });
  // ...and "find all docs having a HIGH finding".
  await col.createIndex({ "findings.severity": 1 }, { name: "idx_findings_severity" });
  // Filter / group by evidence type.
  await col.createIndex({ evidence_type: 1 }, { name: "idx_evidence_type" });
  console.log("indexes:", (await col.indexes()).map((i) => i.name).join(", "));
} finally {
  await client.close();
}
