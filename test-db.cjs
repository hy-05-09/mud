
const {MongoClient, ObjectId, ServerApiVersion} = require("mongodb");
const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri,{
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    }
)

async function testConnection() {
  try {
    await client.connect();
    console.log("✅ MongoDB connected!");

    const db = client.db("mudGame");

    //Test Insert
    const result = await db.collection("chatLogs").insertOne({
      room: "testRoom",
      user: "testUser",
      message: "Hello MongoDB",
      time: new Date()
    });

    console.log("✅ Test data inserted:", result.insertedId);


    const collections = await db.listCollections().toArray();
    console.log("Current collections:", collections);

  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  } finally {
    await client.close();
  }
}

testConnection();