import { MongoClient, Db } from "mongodb";

// One cached client (Mongo manages its own connection pool inside the client).
const g = globalThis as unknown as { mongoClient?: Promise<MongoClient> };

export async function getDb(): Promise<Db> {
  g.mongoClient ??= new MongoClient(process.env.MONGODB_URI!).connect();
  const client = await g.mongoClient;
  return client.db(process.env.MONGODB_DB);
}
