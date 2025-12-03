// This is the main MUD server

//Notes for running the MongoDB server (I copied these instructions from the CS365 notes):
// Download and install MongoDB from: https://www.mongodb.com/try/download/community
// On Windows, open a command prompt and...
//    cd C:\Program Files\MongoDB\Server\8.2\bin  (or add to path)
//    mongod --dbpath C:\stuff\mongodb\  (or wherever you want the data files for the database to go)
// Now the MongoDB server is running, and node.js can connect to it from the server below.
//db code
const {MongoClient, ObjectId, ServerApiVersion} = require("mongodb");
const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri,{
		serverApi: {
			version: ServerApiVersion.v1,
			strict: true,
			deprecationErrors: true,
		}
});

let db;

var express = require("express");
var app = express();
var http = require("http");
var server = http.Server(app);
var socketio = require("socket.io");
var io = socketio(server);
app.use(express.static("pub"));

//On the server side, you also need to do:
//	npm install express
//	npm install socket.io
//	npm install mongoose

let messages = []; //a full list of all chat made on this server
let lobbyMessages = {}; // a list of chats made on specific room

let adjectives = ["Best", "Happy", "Creepy", "Sappy"];
let nouns = ["Programmer", "Developer", "Web dev", "Student", "Person"];

// Game command parsing words:
let verbs = ['l', 'look', 'examine', 'north', 'n', 'south', 's', 'east', 'e', 'west',
	'w', 'up', 'u', 'down', 'd', 'get', 'grab', 'take', 'drop', 'use', 'attack', 'hit',
	'read', 'eat', 'drink', 'throw', 'jump', 'sit', 'whisper', 'say', 'yell', 'talk',
	'speak', 'open', 'close', 'put', 'place', 'set', 'unlock', 'lock', 'turn',
	'help', 'h', 'inventory', 'i']; // Make sure to handle "look at"

let prepositions = ['with', 'at', 'on', 'in', 'to'];

let articles = ['a', 'an', 'the', 'these', 'those', 'this', 'that'];

let unlockVerbs = ['unlock', 'open'];
let lockVerbs = ['lock', 'close'];

const MAX_USERS_PER_LOBBY = 4;

const INITIAL_WORLD_START_ROOM = 'outside';


async function setExitLockState(socket, eventObject, actingItem, itemToBeActedOn, locked = false) {
    console.log("setExitLockState CALLED");
    console.log("eventObject =", eventObject);
    console.log("actingItem =", actingItem);
    console.log("itemToBeActedOn =", itemToBeActedOn);
    console.log("locked =", locked);
	
	
	const lobbyName = socket.data.lobbyName;
    const roomName = socket.data.currentWorldRoomName;

    // Load full lobby fresh from DB
    const lobby = await db.collection("lobbies").findOne({ lobbyName });
    if (!lobby) return "Lobby not found.";

    let currentRoom = lobby.gameRooms.find(r => r.name === roomName);
    if (!currentRoom) return "Room not found.";

    // Current → Target exit
    let forwardExit = currentRoom.exits?.find(e => e.destination === eventObject.target);
    if (!forwardExit)
        return "No exit leading there.";

    // Find target room
    let targetRoom = lobby.gameRooms.find(r => r.name === eventObject.target);
    if (!targetRoom)
        return "Destination room not found.";

    // Target → Current exit (reverse direction)
    let reverseExit = targetRoom.exits?.find(e => e.destination === currentRoom.name);

    // Key mismatch?
    if (itemToBeActedOn?.neededKeyId !== actingItem?.keyId)
        return "You can't unlock that with this item.";

    // Apply lock state
    forwardExit.isLocked = locked;
    if (reverseExit)
        reverseExit.isLocked = locked;


	console.log("BEFORE SAVE:", JSON.stringify(currentRoom.exits, null, 2));


    // Save FULL updated rooms back into DB
    await db.collection("lobbies").updateOne(
        { lobbyName },
        { $set: { gameRooms: lobby.gameRooms } }
    );

	console.log("AFTER SAVE check… reloading lobby from DB");

	let testLobby = await db.collection("lobbies").findOne({ lobbyName });
	console.log("DB exits =", JSON.stringify(
	testLobby.gameRooms.find(r => r.name === roomName).exits,
	null,
	2
	));

	console.log("=== LOBBY GAME ROOMS ORDER ===");
lobby.gameRooms.forEach((r, i) =>
  console.log(i, r.name)
);


    return `The door is now ${locked ? "locked" : "unlocked"}.`;
}



const interactableFunctions = {
	// These functions are meant to correspond to the action event names that game-item-objects can refer to.
	// They are for doing things when the player interacts with things in the game.
	// So you can define a custom function here to handle whatever sort of game behavior you might want.
	// All of these functions expect four arguments (these arguments can be named more
	// specifically in the functions themselves):
	// 	the applicable socket of whoever is playing
	// 	eventObject,
	//	actingItem (object)
	//	itemToBeActedOn (object)
	unlockExit: (socket, eventObject, actingItem, itemToBeActedOn) => {
		return setExitLockState(socket, eventObject, actingItem, itemToBeActedOn, false);
	},
	lockExit: (socket, eventObject, actingItem, itemToBeActedOn) => {
		return setExitLockState(socket, eventObject, actingItem, itemToBeActedOn, true);
	},
	toggleLockExit: async (socket, eventObject, actingItem, itemToBeActedOn) => {
		const lobbyName = socket.data.lobbyName;
		const username = socket.data.name;

		const lobby = await db.collection("lobbies").findOne({ lobbyName });
		if (!lobby) return "Lobby not found.";

		const user = await db.collection("users").findOne({ username });
		if (!user) return "User not found.";

		let currentGameRoom = lobby.gameRooms.find(r => r.name === user.currentWorldRoomName);
		if (!currentGameRoom) return "Room not found.";

		let exit = currentGameRoom.exits.find(e => e.direction === direction);
		if (!exit) return "No such exit.";

		exit.isLocked = locked;

		await db.collection("lobbies").updateOne(
			{ lobbyName },
			{ $set: { gameRooms: lobby.gameRooms } }
		);

		return locked ? "You lock the door." : "You unlock the door.";
	}


};

// This is the initial game data that each server-room starts with:
const INITIAL_WORLD_DATA = [
	{
		name: 'kitchen',
		description: 'You are standing in a kitchen with a table in the middle. There is a refrigerator here. There is a door to the north leading outside. There is a door leading to the east',
		exits: [
			{
				destination: 'outside',
				direction: 'north'
			},
			{
				destination: 'locked-room',
				direction: 'east',
				isLocked: true,
			}
		],
		interactables: [
			{
				name: 'refrigerator',
				altNames: ['fridge'],
				description: 'It is a refrigerator with two doors, a freezer being on the bottom',
				canGet: false,
				listOnLook: false,
			},
			{
				name: 'old key',
				altNames: ['key'],
				keyId: 'old-room-key',
				description: 'It is an old key',
				positionalPhrase: ' sitting on the table.', // This is used to describe where the object is in the room.
				canGet: true,
				listOnLook: true, // If this is true, the item will be tacked on to the room description
			},
			{
				name: 'door',
				altNames: ['old door', 'old wooden door', 'wooden door'], // TODO: fuzzy matches, so if the user says wooden door but the alt names doesn't have that one
				description: "It's an old wooden door",
				neededKeyId: "old-room-key",
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'locked-room'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'locked-room'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'locked-room'
						}]
					}
				]
			}
		]
	},
	{
		// TODO: this room should need to be unlocked with a key
		name: 'locked-room',
		description: 'You are in the room that used to be locked. TODO: make a description for this room',
		exits: [
			{
				destination: 'kitchen',
				direction: 'west',
				isLocked: true,
				// neededKey: 'old-room-key'
			}
		],
		interactables: [
			{
				name: 'door',
				// TODO: maybe with the database, this INITIAL_WORLD_DATA could be restructured so that it doesn't need duplicate items for things like locked doors
				altNames: ['old door', 'old wooden door', 'wooden door'], // TODO: fuzzy matches, so if the user says wooden door but the alt names doesn't have that one
				description: "It's an old wooden door",
				neededKeyId: "old-room-key",
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'kitchen'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'kitchen'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'kitchen'
						}]
					}
				]
			}
		]
	},
	{
		name: 'outside',
		description: 'You are outside. There is a door to the south leading to the kitchen.',
		exits: [
			{
				destination: 'kitchen',
				direction: 'south'
			}
		],
		interactables: [
			{
				name: 'test object',
				canGet: true,
			}
		]
	}
];

let lobbies = [];

function randomFromList(list) {
	let i = Math.floor(Math.random() * list.length);
	return list[i];
}

function mapSocketsToUsernames(socketList) {
	let ret = [];
	for(socketKeyValue of socketList) {
		// console.log(socketKeyValue[1]);
		ret.push(socketKeyValue[1].data.name);
	}
	return ret;
}

//-------User Collection-----------
// create new user
async function createUser(username, lobbyName, roomName, inventory) {
	return db.collection("users").insertOne({
		username,
		lobbyName,
		currentWorldRoomName: roomName,
		inventory,
		password: null,
		createdAt: new Date()
	});
}

//load existing user
async function getUser(username) {
	return db.collection("users").findOne({username});
}

//update user fields
async function updateUser(username, fields){
	return db.collection("users").updateOne(
		{username},
		{$set: fields}
	);
}



//------------Lobbies Collection------------
async function createLobby(lobbyName) {
	return db.collection("lobbies").insertOne({
		lobbyName,
		users: [],
		gameRooms: structuredClone(INITIAL_WORLD_DATA),
		createdAt: new Date()
	});
}

async function getLobby(lobbyName) {
	return db.collection("lobbies").findOne({lobbyName});
}

async function updateLobby(lobbyName, fields) {
	return db.collection("lobbies").updateOne(
		{lobbyName},
		{$set: fields}
	);
}


//-----------Room States-------------
async function saveRoomState(lobbyName, roomName, data) {
	return db.collection("roomStates").updateOne(
		{lobbyName, roomName},
		{$set: data},
		{upsert: true}
	);
}

async function getRoomState(lobbyName, roomName) {
	return db.collection("roomStates").findOne({lobbyName, roomName});
}


//--------------Command Logging----------------
async function logCommand(lobbyName, username, command, response) {
	return db.collection("commandsAndResponses").insertOne({
		lobbyName,
		user: username,
		command,
		response,
		time: new Date()
	});
}


//Every time a client connects (visits the page) this function(socket) {...} gets executed.
//The socket is a different object each time a new client connects.
io.on("connection", async function(socket) {
	console.log("Somebody connected.");
	
	socket.on("reconnectUser", async (username, callback)=>{
		const user = await getUserFromDB(username);
		if(!user) return callback(false, "User not found.");

		socket.data.name = user.username;
		socket.data.lobbyName = user.lobbyName;
		socket.data.currentWorldRoomName = user.currentWorldRoomName || INITIAL_WORLD_START_ROOM;
		socket.data.inventory = user.inventory || [];

		socket.join(user.lobbyName);
		callback(true, "Reconnected");
 	})

	//socket.data is a convenience object where we can store application data
	socket.data.name = randomFromList(adjectives) +" "+ randomFromList(nouns);
	socket.data.lobbyName = null;
	socket.data.roomName = null;

	// Leave the current lobby
	function leaveLobbyInternal(socket){
		const lobbyName = socket.data.lobbyName;
		if (!lobbyName) return;

		// Find lobby by name
		const lobbyIndex = lobbies.findIndex(r => r.name === lobbyName);
		if (lobbyIndex === -1) {
			socket.data.lobbyName = null;
			return;
		}

		const lobby = lobbies[lobbyIndex];

		// Remove this user from the lobby
		lobby.users = lobby.users.filter(s => s.id !== socket.id);


		socket.leave(lobbyName);
		console.log(socket.data.name + " left " + lobbyName);
		io.to(socket.data.lobbyName).emit("userLeftLobby", socket.data.name);
		let currentLobby = lobbies.find(room => room.name === socket.data.lobbyName);
		if (currentLobby) {
			// Remove this user
			currentLobby.users = currentLobby.users.filter(u => u.name !== socket.data.name);

			io.to(socket.data.lobbyName).emit("updateUserList", currentLobby.users);
		}


		// TODO (optional): If the lobby is empty, delete the lobby

		socket.data.lobbyName = null;
	}

	function getRoomDescription(room) {
		let desc = room.description;
		for (interactable of room.interactables ?? []) {
			if (!interactable.listOnLook)
				continue;
			let firstLetterIsVowel = ['a', 'e', 'i', 'o', 'u'].includes(Array.from(interactable.name)[0]);
			let positionalPhrase = ' on the ground.';
			if (interactable.positionalPhrase && interactable.positionalPhrase != '')
				positionalPhrase = interactable.positionalPhrase;
			desc += "\nThere is a" + (firstLetterIsVowel ? 'n' : '') + " " + interactable.name + positionalPhrase;
		}
		return desc;
	}

	async function getSocketsInGameRoom(room) {
		let socketsInLobby = await io.in(socket.data.lobbyName).fetchSockets();
		let sockets = socketsInLobby.filter(s => s.data.currentWorldRoomName == room.name);
		return sockets;
	}

	function getObjectNameFromIndices(words, objectStartIndex, objectEndIndex) {
		let objectName = '';
		if (objectEndIndex === -1) // If this is a single word item
			objectName = words[objectStartIndex];
		else { // if this item's name is multiple words (i.e. with spaces)
			for (let i = objectStartIndex; i <= objectEndIndex; ++i) {
				objectName += words[i];
				if (i < objectEndIndex)
					objectName += " ";
			}
		}
		return objectName;
	}

	async function getUserFromDB(username) {
		return db.collection("users").findOne({username});
	}

	async function getLobbyFromDB(lobbyName) {
		return db.collection("lobbies").findOne({lobbyName});
	}

	async function updateUserRoom(username, roomName) {
		return db.collection("users").updateOne(
			{username},
			{$set: {currentWorldRoomName: roomName}}
		);
	}

	async function getCurrentGameRoom(lobby, roomName) {
		return lobby.gameRooms.find(r=>r.name===roomName);
	}

	async function saveLobbyGameRooms(lobbyName, gameRooms) {
		return db.collection("lobbies").updateOne(
			{lobbyName},
			{$set: {gameRooms}}
		);
	}




	async function parseCommand(command) {
		/**
		 * TODO: Make a command parser
		 * 
		 * examples:
		 * 		look, l
		 * 		get item, get bottle
		 * 		open door, open window
		 * 		north, n, south, s
		 * 		drop item, drop book
		 * 		attack enemy
		 * 		use key on door
		 *
		 * This should allow synonyms like "take" instead of "get"
		 * I'm not sure how hard it would be to make more complex commands for
		 * things like keys and doors "attack enemy with sword"
		 * Maybe items could have unique behaviors corresponding to the commands that were tried on them?
		 * Will we have realtime things going on besides the players?
		 */

		let response = '';
		const username = socket.data.name;
		// const lobbyName = socket.data.lobbyName;

		let user = await getUserFromDB(username);
		if (!user) return "User not found.";

		const freshUser = await db.collection("users").findOne({ username });
        if (!freshUser) return "User not found.";

        const freshLobby = await db.collection("lobbies").findOne({ lobbyName: freshUser.lobbyName });
        if (!freshLobby) return "Lobby not found.";

       const gameRoom = freshLobby.gameRooms.find(r => r.name === freshUser.currentWorldRoomName);
       if (!gameRoom) return "Room not found.";


		// Split the command by spaces into an array
		let words = command.split(" ");
		let unmodifiedWords = words;
		words = words.map(word => word.toLowerCase());
		let verb = '';
		let verbIndex = 0;
		let objectStartIndex = -1; // For game items that have names with spaces
		let objectEndIndex = -1;
		let secondaryObjectStartIndex = -1; // The secondary object's end index would just be the length of the array minus one. (from the start index to the end of the array)
		let preposition = '';

		// This is the parsing loop
		let index = 0;
		for (word of words) {
			if (prepositions.includes(word)) {
				if (verb === '') {
					socket.emit('commandResponse', 'Your command must contain a verb.');
					return;
				}
				if (preposition === '') {
					if (objectStartIndex !== -1) {
						preposition = word;
						objectEndIndex = index - 1;
						if (articles.includes(words[index + 1]))
							// If there is an article, skip to the next index
							secondaryObjectStartIndex = index + 2;
						else
							secondaryObjectStartIndex = index + 1;
					} else {
						socket.emit('commandResponse', verb + " " + word + " what?");
						return;
					}
				} else {
					socket.emit('commandResponse', 'There is more than one preposition in that sentence.');
					return;
				}
			}
			else if (verbs.includes(word)) {
				if (verb === '') {
					verb = word;
					verbIndex = index;
				} else if (['say', 'speak', 'talk'].includes(verb)) {
					// Do nothing
				} else {
					socket.emit('commandResponse', 'There is more than one verb in that sentence.')
					return;
				}
			}
			else if (verb !== '' && !articles.includes(word)) {
				if (objectStartIndex === -1) {
					objectStartIndex = index;
				} else if (preposition === '') {
					objectEndIndex = index;
				}
			}
			index += 1;
		}


		if (['l', 'look'].includes(verb)) {
			response = getRoomDescription(gameRoom);
		}
		else if (['help', 'h'].includes(verb)) {
			response = "TODO: output some text to help the user.";
		}
		else if (['north','n','south','s','east','e','west','w','up','u','down','d'].includes(verb)) {

			const map = { n:'north', s:'south', e:'east', w:'west', u:'up', d:'down' };
			if (map[verb]) verb = map[verb];

			// 1. ALWAYS load fresh user from DB
			const freshUser = await db.collection("users").findOne({ username });
			if (!freshUser) return "User not found.";

			// 2. ALWAYS load fresh lobby from DB
			const freshLobby = await db.collection("lobbies").findOne({ lobbyName: freshUser.lobbyName });
			if (!freshLobby) return "Lobby not found.";

			// 3. Get the fresh room data
			const gameRoom = freshLobby.gameRooms.find(r => r.name === freshUser.currentWorldRoomName);
			if (!gameRoom) return "Room not found.";




			// 4. Now get the correct exit
			let exit = gameRoom.exits.find(ex => ex.direction === verb);
			if (!exit) return "There is no exit in that direction.";

			if (exit.isLocked) return "It's locked.";

			const destinationRoom = freshLobby.gameRooms.find(r => r.name === exit.destination);
			if (!destinationRoom) return "Destination room not found.";

			// 5. Update user position in DB
			await db.collection("users").updateOne(
				{ username },
				{ $set: { currentWorldRoomName: exit.destination }}
			);

			socket.data.currentWorldRoomName = exit.destination;

			// 6. Rebuild user list and broadcast
			const socketsInLobby = await io.in(freshUser.lobbyName).fetchSockets();
			let userList = [];

			for (let s of socketsInLobby) {
				const u = await db.collection("users").findOne({ username: s.data.name });
				if (u) userList.push({ name: u.username, room: u.currentWorldRoomName });
			}

			io.to(freshUser.lobbyName).emit("updateUserList", userList);


			return getRoomDescription(destinationRoom);
		}



		else if (['inventory', 'i'].includes(verb)) {
			socket.emit('commandResponse',
				"You are carrying: " + (socket.data.inventory.length ? socket.data.inventory.map(item => item?.name).join(", ") : 'nothing')
			);
		}
		else if (['get', 'take'].includes(verb)) {
			let objectName = getObjectNameFromIndices(words, objectStartIndex, objectEndIndex);
			if (objectName !== '') {
				let itemToTakeIndex = gameRoom.interactables.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
				if (itemToTakeIndex != -1) {
					if (gameRoom.interactables[itemToTakeIndex].canGet) {
						// Remove the item from the gameRoom
						let takenItem = gameRoom.interactables.splice(itemToTakeIndex, 1)[0];
						// Push the item to the player's inventory
						socket.data.inventory.push(takenItem);

						await db.collection("users").updateOne(
							{username: socket.data.name},
							{$set: {inventory: socket.data.inventory}}
						);

						response = "You took the " + takenItem.name;
						// Remove the positionalPhrase from the item
						takenItem.positionalPhrase = '';
						// for (user of await getSocketsInGameRoom(gameRoom)) {
						// 	socket.to(user.id).emit('event', socket.data.name + " just took the " + takenItem.name, 'user');
						// }
						io.to(freshLobby.lobbyName).emit('event', socket.data.name + " just took the " + takenItem.name, 'user');
						await db.collection("lobbies").updateOne(
							{lobbyName: freshLobby.lobbyName},
							{$set: {gameRooms: freshLobby.gameRooms}}
						);
					} else response = "You can't take that!";
				} else response = "There doesn't seem to be one of those here.";
			}
			else response = verb + " what?";
		}
		else if (verb === 'drop') {
			let objectName = getObjectNameFromIndices(words, objectStartIndex, objectEndIndex);
			if (objectName !== '') {
				// Find the index of the item to drop
				let itemToDropIndex = socket.data.inventory.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
				if (itemToDropIndex != -1) {
					// Remove the item from the player's inventory
					let droppedItem = socket.data.inventory.splice(itemToDropIndex, 1)[0];
					// Push the item to the gameRoom
					gameRoom.interactables.push(droppedItem);

					await db.collection("users").updateOne(
						{username: socket.data.name},
						{$set: {inventory: socket.data.inventory}}
					);
					response = "You dropped the " + droppedItem.name + " on the ground.";
					droppedItem.positionalPhrase = " on the ground."
					for (user of await getSocketsInGameRoom(gameRoom)) {
						socket.to(user.id).emit('event', socket.data.name + " just dropped " + droppedItem.name, 'user');
					}
					await db.collection("lobbies").updateOne(
						{lobbyName},
						{$set: {gameRooms: freshLobby.gameRooms}}
					);
				} else response = "You don't seem to be carrying that.";
			}
			else response = verb + " what?";
		}
		else if (['use'].includes(verb)) {
			// TODO(?): rename these variables to all use item instead of "object"
			let objectName = getObjectNameFromIndices(words, objectStartIndex, objectEndIndex);
			let itemToUse = socket.data.inventory.find(item => item.name === objectName || item.altNames?.includes(objectName));
			if (!itemToUse) // if it doesn't exist in the inventory, look for it in the room.
				itemToUse = gameRoom.interactables.find(item => item.name === objectName || item.altNames?.includes(objectName));
			if (itemToUse) {
				if (itemToUse.useAction) {
					// TODO: the useAction variable will indicate what kind of thing
					// will happen if the item is used on its own without a secondary object.
				} else {
					let secondaryObjectName = getObjectNameFromIndices(words, secondaryObjectStartIndex, words.length - 1);
					// TODO: search for duplicates that could occur both in the room and the player's inventory. Right now we're just using the first match we get.
					let secondaryItem = socket.data.inventory.find(item => item.name === secondaryObjectName || item.altNames?.includes(secondaryObjectName));
					if (!secondaryItem) // if it doesn't exist in the inventory, look for it in the room.
						secondaryItem = gameRoom.interactables.find(item => item.name === secondaryObjectName || item.altNames?.includes(secondaryObjectName));
					if (!secondaryItem && secondaryObjectName === "door") {
						// Find exit in this room that leads somewhere
						// let exit = gameRoom.exits?.find(e => e.isLocked !== undefined);
						let exit = gameRoom.exits?.find(e=>e.isLocked !== undefined);
						if (exit) {
							// Create a pseudo-item representing the door.
							secondaryItem = {
								name: "door",
								isExitObject: true,
								neededKeyId: "old-room-key",    // key required
								_exitTarget: exit.destination   // store where it leads
							};
						}
					}

					if (secondaryItem) {
						let events = secondaryItem.actions.find(action => action.commands.includes(verb))?.events;
						let eventResponses = [];
						
					} else if (preposition)
						response = "Use the " + objectName + " on what?";
					else
						response = "Using the " + objectName + " on its own won't accomplish anything.";
				}
			} else
				response = objectName ? ("I don't know what \"" + objectName + "\" is in this context.") : 'Use what?';
		}
		else if (['say', 'speak', 'talk'].includes(verb)) {
			let quote = unmodifiedWords.slice(verbIndex + 1).join(' ');
			let m = socket.data.name + " says \"" + quote + "\"";
			socket.to(socket.data.lobbyName).emit("messageSent", m);
			response = "You said \"" + quote + "\"";
			// TODO: make the players only able to talk to the players in the same game world room?
		}
		else if (verb !== '') {
			let objectName = getObjectNameFromIndices(words, objectStartIndex, objectEndIndex);
			let primaryItem = socket.data.inventory.find(item => item.name === objectName || item.altNames?.includes(objectName));
			if (!primaryItem) // if it doesn't exist in the inventory, look for it in the room.
				primaryItem = gameRoom.interactables.find(item => item.name === objectName || item.altNames?.includes(objectName));
			let secondaryObjectName = getObjectNameFromIndices(words, secondaryObjectStartIndex, words.length - 1);
			let secondaryItem = socket.data.inventory.find(item => item.name === secondaryObjectName || item.altNames?.includes(secondaryObjectName));
			if (!secondaryItem) // if it doesn't exist in the inventory, look for it in the room.
				secondaryItem = gameRoom.interactables.find(item => item.name === secondaryObjectName || item.altNames?.includes(secondaryObjectName));

			if (primaryItem) {
				let events = primaryItem.actions?.find(action => action.commands.includes(verb))?.events;
				let eventResponses = [];
				if (events) {
					for (eventObject of events) {
						let actingItem;
						if (secondaryItem)
							actingItem = secondaryItem;
						else if (secondaryObjectStartIndex !== -1)
							actingItem = { name: secondaryObjectName, doesNotExist: true };
						else
							actingItem = { wasNotGiven: true };
						let itemToBeActedOn = primaryItem;
						let eventResponse = await interactableFunctions[eventObject.name](socket, eventObject, actingItem, itemToBeActedOn);
						if (eventResponse !== undefined && eventResponse !== '')
							eventResponses.push(eventResponse);
					}
				}
				if (eventResponses.length){
					response = eventResponses.join(' ');
					
				}
				
				else
					response = "It seems you can't " + verb + " the " + objectName
					+ (secondaryItem ? (' with the ' + secondaryItem.name + '.') : '.');
			}
			else response = "I don't know what \"" + objectName + "\" is in this context.";
		}
		else response = "I didn't understand that.";

		if (response != '')
			socket.emit('commandResponse', response);

		let responseObj = {
			lobby: socket.data.lobbyName,
			user: socket.data.name,
			command: command,
			response: response,
			time: new Date()
		};

		await db.collection("commandsAndResponses").insertOne(responseObj);
	}

	socket.on("disconnect", async function() {
		//This particular socket connection was terminated (probably the client went to a different page
		//or closed their browser).

		let username = socket.data.name;
		let lobbyName = socket.data.lobbyName;

		// Remove user from their room
		// leaveLobbyInternal(socket);

		if (!username) {
			const user = await db.collection("users").findOne({socketId:socket.id});
			if (user){
				username = user.username;
				lobbyName = user.lobbyName;
			}
		}

		if (!lobbyName || !username) return;

		await db.collection("lobbies").updateOne(
			{lobbyName},
			{$pull: {users: username}}
		);

		await db.collection("users").updateOne(
			{username},
			{$set: {socketId: null}}
		);

		await db.collection("roomStates").updateMany(
			{lobbyName},
			{$pull: {players: username}}
		);

		io.to(lobbyName).emit("userLeftLobby", username);

		const updatedLobby = await db.collection("lobbies").findOne({lobbyName});
		io.to(lobbyName).emit("updateUserList", updatedLobby ? updatedLobby.users:[]);
	});

	socket.on("directMessage", function(targetUser, text) {
		for(id of Array.from(io.sockets.sockets.keys())) {
			if (io.sockets.sockets.get(id).data.name == targetUser.name) {
				let m = socket.data.name + " just whispered to " + targetUser.name + ": " + text;
				io.sockets.sockets.get(id).emit("messageSent", m);
				socket.emit("messageSent", m); //also informs the one who sent the whisper
			}
		}
	});


	socket.on("joinLobby", async function (lobbyName, username, callback) {
		for (const [id,s] of io.sockets.sockets){
			if (s.data?.name === username && s.id !== socket.id){
				return callback(false, "User already logged in.");
			}
		}
		
		socket.data.name = username;
		socket.data.lobbyName = lobbyName;

		let existingUser = await db.collection("users").findOne({ username });
		if (!existingUser) {
			await db.collection("users").insertOne({
				username,
				lobbyName,
				currentWorldRoomName: INITIAL_WORLD_START_ROOM,
				inventory: [],
				socketId: socket.id,
				createdAt: new Date()
			});

			socket.data.currentWorldRoomName = INITIAL_WORLD_START_ROOM;
			socket.data.inventory = [];
		}else{
			await db.collection("users").updateOne(
				{username},
				{$set: {
					lobbyName,
					socketId: socket.id
				}}
			);
			
			socket.data.currentWorldRoomName =
				existingUser.currentWorldRoomName || INITIAL_WORLD_START_ROOM;
			socket.data.inventory = existingUser.inventory || [];
		}

		let existingLobby = await db.collection("lobbies").findOne({ lobbyName });
		if (!existingLobby) {
			await db.collection("lobbies").insertOne({
				lobbyName,
				users: [username],
				createdAt: new Date(),
				gameRooms: structuredClone(INITIAL_WORLD_DATA)
			});
		}else{
			if(!existingLobby.users.includes(username)){
				await db.collection("lobbies").updateOne(
					{lobbyName},
					{$addToSet:{users:username}}
				);
			}
		}

		
		socket.join(lobbyName);
		io.to(lobbyName).emit("userJoinedLobby", username);
		let updatedLobby = await db.collection("lobbies")
		 	.findOne({lobbyName});
		
		io.to(lobbyName).emit("updateUserList", updatedLobby.users);


		callback(true, "logged in");
	});


	socket.on("joinRoom", async function(roomName, callback) {
		const lobbyName = socket.data.lobbyName;
		const username = socket.data.name;

		if (!lobbyName){
			if (callback) callback(false, "Join a lobby first");
			return;
		}

		socket.join(roomName);

		socket.data.roomName = roomName; //TODO: Be wary of ANY data coming from the client.
		

		await db.collection("users").updateOne(
			{username},
			{
				$set:{
					currentWorldRoomName: roomName,
					lobbyName: lobbyName,
					updatedAt: new Date()
				}
			}
		);


		await db.collection("roomStates").updateOne(
			{ lobbyName, roomName },
			{
				$addToSet: { players: username},
				$set: {updatedAt: new Date()}
			},
			{ upsert: true }
		);

		await db.collection("lobbies").updateOne(
			{lobbyName},
			{$addToSet: {users: username}}
		);

		const updatedLobby = await db.collection("lobbies")
			.findOne({lobbyName});


		
		io.to(lobbyName).emit("updateUserList", updatedLobby.users);
		// the "callback" below calls the method that the client side gave
		if (callback) callback(true, "Joined successfully");
	});

	// Handle leave lobby request
	socket.on("leaveLobby", function(callback){
		leaveLobbyInternal(socket);

		if (callback) {
			callback(true, "Left lobby successfully.");
		}

	});

	// sendChat is no longer used on the client side. (users use the "say" command)
	socket.on("sendChat", async function(chatMessage) {
		let lobbyName = socket.data.lobbyName;
		let currentLobby = socket.data.lobbyName;
		let messageObj = {
			room: currentLobby,
			user: socket.data.name,
			text: chatMessage,

		}
		
		await db.collection("messages").insertOne(messageObj);

		io.to(currentLobby).emit("messageSent", 
			`${messageObj.user}:${messageObj.text}`
		);
	});

	socket.on("sendCommand", async function(cmd, callback) {

		const username = socket.data.name;
		const lobbyName = socket.data.lobbyName;
		const roomName = socket.data.roomName;

		if (!lobbyName){
			if (callback) callback(false, "You are not in a lobby.");
			return;
		}

		// const response = `You typed: ${cmd}`;
		const response = await parseCommand(cmd);


		if (response){
			//retrieve stored chat history for this lobby
			socket.emit("commandResponse", response);
		}
			
	
		if (callback) callback(true, response||"");
	});



	//retrieve stored chat history for this room
	socket.on("showChatHistory", async function(callback){
		const lobbyName = socket.data.lobbyName;
		if (!lobbyName){
			if (callback) callback(false, "You are not in a lobby.", []);
			return;
		}

		// const history = lobbyMessages[lobbyName] || [];
		const history = await db.collection("messages")
			.find({room:roomName})
			.sort({time:1})
			.toArray();

		if (callback) callback(true, history);
	});




	// List players in the current lobby
	socket.on("listPlayers", async function(callback){
		const lobbyName = socket.data.lobbyName;
		if (!lobbyName){
			if (callback) callback(false, "You are not in a lobby.", []);
			return;
		}

		// const lobby = lobbies.find(r => r.name === lobbyName);
		const lobby = await getLobbyFromDB(socket.data.lobbyName);
		if (!lobby) {
			if (callback) callback(false, "Lobby not found.", []);
			return;
		}

		callback(true, lobby.users);
	});

		// =============== DB TESTING EVENTS ==================

	// GET USER
	socket.on("dbTest:getUser", async (username, callback) => {
	const user = await db.collection("users").findOne({ username });
	if (user) callback(true, user);
	else callback(false, null);
	});

	// GET LOBBY
	socket.on("dbTest:getLobby", async (lobbyName, callback) => {
	const lob = await db.collection("lobbies").findOne({ lobbyName });
	if (lob) callback(true, lob);
	else callback(false, null);
	});

	// GET ROOM STATE
	socket.on("dbTest:getRoomState", async (lobbyName, roomName, callback) => {
	const state = await db.collection("roomStates").findOne({ lobbyName, roomName });
	if (state) callback(true, state);
	else callback(false, null);
	});

	// GET COMMAND LOGS
	socket.on("dbTest:getCommands", async (lobbyName, callback) => {
	const logs = await db.collection("commandsAndResponses")
		.find({ lobbyName })
		.sort({ time: 1 })
		.toArray();

	if (logs.length > 0) callback(true, logs);
	else callback(false, null);
	});

});


async function run() {
	// Connect the client to the server (optional starting in v4.7)
	await client.connect();
	// Send a ping to confirm a successful connection
	db = client.db("mudGame2");
	console.log("You successfully connected to MongoDB!");
	
	server.listen(8080, function() {
		console.log("Server with socket.io is ready.");
	});
}
run().catch(console.dir);

async function shutDown() {
	await client.close();
	console.log("Database connection closed.");
	process.exit(0);
}
process.on('SIGINT', shutDown); //If you hit ctrl-c, it triggers the shutDown method


async function clearDB() {
    await client.connect();
    const db = client.db("mudGame2");
    await db.dropDatabase();
    console.log("mudGame database erased completely");
    process.exit(0);
}

// clearDB();   
