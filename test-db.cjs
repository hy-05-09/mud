// ========================
// MUD Game Database Tester
// ========================

const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function runTests() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        const db = client.db("mudGame");

        // ============================
        // 1) USERS COLLECTION TEST
        // ============================

        console.log("\n=== USERS TEST ===");

        const usersCol = db.collection("users");

        // Create user
        const userInsert = await usersCol.insertOne({
            username: "testUser",
            lobbyName: "testLobby",
            currentWorldRoomName: "outside",
            inventory: [{ name: "pencil", canGet: true }],
            password: null,
            createdAt: new Date()
        });

        console.log("User inserted:", userInsert.insertedId);

        // Find user
        const foundUser = await usersCol.findOne({ username: "testUser" });
        console.log("User found:", foundUser);

        // Update user
        await usersCol.updateOne(
            { username: "testUser" },
            { $set: { currentWorldRoomName: "kitchen" } }
        );

        const updatedUser = await usersCol.findOne({ username: "testUser" });
        console.log("User updated:", updatedUser);


        // ============================
        // 2) LOBBIES COLLECTION TEST
        // ============================

        console.log("\n=== LOBBIES TEST ===");

        const lobbiesCol = db.collection("lobbies");

        // Create lobby
        const lobbyInsert = await lobbiesCol.insertOne({
            lobbyName: "testLobby",
            users: ["testUser"],
            gameRooms: [],
            createdAt: new Date()
        });

        console.log("Lobby inserted:", lobbyInsert.insertedId);

        // Find lobby
        const foundLobby = await lobbiesCol.findOne({ lobbyName: "testLobby" });
        console.log("Lobby found:", foundLobby);

        // Update lobby
        await lobbiesCol.updateOne(
            { lobbyName: "testLobby" },
            { $set: { users: ["testUser", "anotherUser"] } }
        );

        const updatedLobby = await lobbiesCol.findOne({ lobbyName: "testLobby" });
        console.log("Lobby updated:", updatedLobby);


        // ============================
        // 3) ROOM STATES TEST
        // ============================

        console.log("\n=== ROOM STATES TEST ===");

        const roomStatesCol = db.collection("roomStates");

        // Save room state (upsert)
        await roomStatesCol.updateOne(
            { lobbyName: "testLobby", roomName: "kitchen" },
            {
                $set: {
                    items: ["key", "apple"],
                    players: ["testUser"],
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        console.log("✔ Room state saved (upsert)!");

        // Load room state
        const foundRoomState = await roomStatesCol.findOne({
            lobbyName: "testLobby",
            roomName: "kitchen"
        });

        console.log("Room state loaded:", foundRoomState);


        // ============================
        // 4) COMMAND LOGGING TEST
        // ============================

        console.log("\n=== COMMAND LOG TEST ===");

        const logsCol = db.collection("commandsAndResponses");

        const logInsert = await logsCol.insertOne({
            lobbyName: "testLobby",
            user: "testUser",
            command: "look",
            response: "You are in a kitchen.",
            time: new Date()
        });

        console.log("Command log inserted:", logInsert.insertedId);


        // ============================
        // SHOW ALL COLLECTIONS
        // ============================

        const collections = await db.listCollections().toArray();
        console.log("\nCurrent Collections:", collections);

        console.log("\nALL TESTS SUCCESSFULLY COMPLETED!");

    } catch (error) {
        console.error("Test failed:", error);
    } finally {
        await client.close();
    }
}

runTests();
