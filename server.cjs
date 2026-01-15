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
let verbs = ['l', 'look','search', 'inspect', 'examine', 'north', 'n', 'south', 's', 'east', 'e', 'west',
	'w', 'up', 'u', 'down', 'd', 'get', 'grab', 'take', 'drop', 'use', 'attack', 'hit',
	'read', 'eat', 'drink', 'throw', 'jump', 'sit', 'whisper', 'say', 'yell', 'talk',
	'speak', 'open', 'close', 'put', 'place', 'set', 'unlock', 'lock', 'turn',
	'help', 'h', 'inventory', 'i', 'inv',]; // Make sure to handle "look at"	

let prepositions = ['with', 'at', 'on', 'in', 'to', 'from', 'out'];

let articles = ['a', 'an', 'the', 'these', 'those', 'this', 'that'];

let unlockVerbs = ['unlock', 'open'];
let lockVerbs = ['lock', 'close'];

const MAX_USERS_PER_LOBBY = 4;

const INITIAL_WORLD_START_ROOM = 'Forest';


async function setExitLockState(socket, eventObject, actingItem, itemToBeUnlocked, locked = false) {

	const lobbyName = socket.data.lobbyName;
    const roomName = socket.data.currentWorldRoomName;

    // Load full lobby fresh from DB
    const lobby = await db.collection("lobbies").findOne({ lobbyName });
    if (!lobby) return "Lobby not found.";

    let currentRoom = lobby.gameRooms.find(r => r.name === roomName);
    if (!currentRoom) return "Room not found.";


	let exit = currentRoom.exits?.find(exit => exit.destination === eventObject.target);
	let destinationRoom = lobby.gameRooms.find(r => r.name === eventObject.target);
	let destinationExit = destinationRoom?.exits?.find(exit => exit.destination === currentRoom.name);
	let response = '';
	let success = () => {
		exit.isLocked = locked;
		response = "The " + itemToBeUnlocked.name + " is now " + (exit.isLocked ? 'locked' : 'unlocked');
	}
	if (exit?.isLocked !== undefined) {
		if (itemToBeUnlocked?.neededKeyId === actingItem?.keyId) {
			// Using a function here for other potential conditional maners of unlocking
			success();
		} else {
			if (actingItem?.doesNotExist)
				response = "I don't know what \"" + actingItem?.name + "\" is in this context.";
			else if (actingItem?.wasNotGiven)
				response = "The " + itemToBeUnlocked.name + " can't be unlocked on its own.";
			else if (actingItem?.name)
				response = "Your attempt to " + (locked ? 'lock' : 'unlock') + " the " + itemToBeUnlocked.name + " with the " + actingItem.name + " failed.";
			else response = "Your attempt to " + (locked ? 'lock' : 'unlock') + " the " + itemToBeUnlocked.name + " failed.";
		}
	}
	if (destinationExit?.isLocked !== undefined)
		destinationExit.isLocked = locked;
	

    // Save FULL updated rooms back into DB
    await db.collection("lobbies").updateOne(
        { lobbyName },
        { $set: { gameRooms: lobby.gameRooms } }
    );

	return response;
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
		const roomName = socket.data.currentWorldRoomName;

		const lobby = await db.collection("lobbies").findOne({ lobbyName });
		if (!lobby) return "Lobby not found.";

		const currentRoom = lobby.gameRooms.find(r => r.name === roomName);
		if (!currentRoom) return "Room not found.";

		const forwardExit = currentRoom.exits?.find(e => e.destination === eventObject.target);
		if (!forwardExit) return "No exit leading there.";

		const nextLocked = !Boolean(forwardExit.isLocked);

		return setExitLockState(socket, eventObject, actingItem, itemToBeActedOn, nextLocked);
	}


};

// This is the initial game data that each server-room starts with:
const INITIAL_WORLD_DATA = [
	{
		name: 'Forest',
		description: 'You are in a dark forest. There is a path leading north.',
		exits: [
			{
				destination: 'Driveway',
				direction: 'north'
			}
		],
		interactables: [
			{
				name: 'Axe',
				altNames: ['axe'],
				description: 'A rusted axed with a wooden handle.',
				positionalPhrase: ' lodged in a tree stump.',
				canGet: true,
				listOnLook: true,
			}
		]
	},
	{
		name: 'Driveway',
		description: 'You are standing at the end of a long gravel driveway. There is a house to the east and the forest to the south.',
		exits: [
			{
				destination: 'Forest',
				direction: 'south'
			},
			{
				destination: 'Front Porch',
				direction: 'east'
			}
		],
		interactables: [
			{
				name: 'mailbox',
				description: 'A faded white mailbox with a broken flag.',
				positionalPhrase: ' next to the driveway.',
				canGet: false,
				listOnLook: true,
				inventory: [
					{
						name: 'Front Door Key',
						altNames: ['front door key'],
						description: 'A small brass key.',
						keyId: 'front-door-key',
						canGet: true,
						listOnLook: false
					}
				]
			},
		],

	},
	{
		name: 'Front Porch',
		description: 'You are standing on the front porch of a small house. There is a door to the east leading inside, a garden on the north of the house and the driveway is to the west.',
		exits: [
			{
				destination: 'Driveway',
				direction: 'west'
			},
			{
				destination: 'Living Room',
				direction: 'east',
				isLocked: true,
				neededKeyId: 'front-door-key'
			},
			{
				destination: 'Garden',
				direction: 'north'
			}
		],
		interactables: [
			{
				name: 'Front Door',
				altNames: ['front door'],
				description: "It's a wooden front door with a brass doorknob.",
				neededKeyId: 'front-door-key',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Living Room'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Living Room'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Living Room'
						}]
					}
				]
			}
		]
	},
	{
		name: 'Living Room',
		description: 'You are in a abandoned living room. There is a door to the west leading to the front porch. There\'s rooms to the north and south.',
		exits: [
			{
				destination: 'Front Porch',
				direction: 'west',
				isLocked: true,
				neededKeyId: 'front-door-key'
			},
			{
				destination: 'Kitchen',
				direction: 'south'
			},
			{
				destination: 'Bedroom',
				direction: 'north'
			}
		],
		interactables: [
			{
				name: 'couch',
				description: 'A dusty old couch with torn upholstery.',
				positionalPhrase: ' in the middle of the room.',
				canGet: false,
				listOnLook: true,
				inventory: []
			},
			{
				name: 'Front Door',
				altNames: ['front door'],
				description: "It's a wooden front door with a brass doorknob.",
				neededKeyId: 'front-door-key',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Front Porch'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Front Porch'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Front Porch'
						}]
					}
				]
			}

		]
	},
	{
		name: 'Bedroom',
		description: 'You are in a small bedroom. There is a bathroom to the east and the living room to the south.',
		exits: [
			{
				destination: 'Living Room',
				direction: 'south'
			},
			{
				destination: 'Bathroom',
				direction: 'east',
				isLocked: true,
			}
		],
		interactables: [
			{
				name: 'bed',
				description: 'A small bed with a thin mattress.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' against the wall.'
			},
			{
				name: 'nightstand',
				altNames: ['dresser'],
				description: 'A small wooden nightstand with a drawer.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' next to the bed.',
				inventory: [
					{
						name: 'Cellar Key',
						altNames: ['cellar key'],
						description: 'A small iron key.',
						keyId: 'cellar-key',
						canGet: true,
						listOnLook: false
					}
				]
			},
			{
				name: 'Bathroom Door',
				altNames: ['door', 'bathroom door'],
				description: "It's a door that leads to the bathroom.",
				neededKeyId: 'bathroom-key',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Bathroom'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Bathroom'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Bathroom'
						}]
					}
				]
			}
		]
	},
	{
		name: 'Kitchen',
		description: 'You are in a small kitchen. There is a table in the middle of the room and a door to the north leading back to the living room.',
		exits: [
			{
				destination: 'Living Room',
				direction: 'north'
			}
		],
		interactables: [
			{
				name: 'refrigerator',
				altNames: ['fridge'],
				description: 'A white refrigerator with a freezer on top.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' against the wall.',
				inventory: [
					{
						name: 'Milk Jug',
						altNames: ['milk', 'jug', 'milk jug'],
						description: 'A half-empty jug of milk.',
						canGet: true,
						listOnLook: false
					}
				]
			},
			{
				name: 'table',
				description: 'A wooden table with a few chairs around it.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' in the middle of the room.'
			}
		]
	},
	{
		name: 'Bathroom',
		description: 'You are in a small bathroom. There is a sink, a toilet, and a shower. The bedroom is to the west.',
		exits: [
			{
				destination: 'Bedroom',
				direction: 'west',
				isLocked: true,
			}
		],
		interactables: [
			{
				name: 'sink',
				description: 'A white porcelain sink with a mirror above it.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' against the wall.'
			},
			{
				name: 'toilet',
				description: 'A white porcelain toilet.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' next to the sink.',
				inventory: [
					{
						name: 'Key Card',
						altNames: ['keycard', 'key card'],
						keyId: 'keycard',
						description: 'A plastic key card with a magnetic strip.',
						canGet: true,
						listOnLook: false
					}
				]
			},
			{
				name: 'shower',
				description: 'A white tiled shower with a glass door.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' in the corner.'
			},
			{
				name: 'Bathroom Door',
				altNames: ['door', 'bathroom door'],
				description: "It's a door that leads to the bathroom.",
				neededKeyId: 'bathroom-key',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Bedroom'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Bedroom'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Bedroom'
						}]
					}
				]
			}
		]
	},
	{
		name: 'Garden',
		description: 'You are in a small garden built next to the side of the house. There is a cellar door to the east. The front porch is to the south.',
		exits: [
			{
				destination: 'Front Porch',
				direction: 'south'
			},
			{
				destination: 'Cellar',
				direction: 'east',
				isLocked: true,
			}
		],
		interactables: [
			{
				name: 'Cellar Door',
				altNames: ['door', 'cellar door'],
				description: "It's a wooden door set into the ground with a rusty handle.",
				neededKeyId: 'cellar-key',
				positionalPhrase: ' set into the ground.',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Cellar'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Cellar'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Cellar'
						}]
					}
				]
			},
			{
				name: 'flower bed',
				description: 'A small flower bed with a few blooming flowers.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' against the house wall.',
				inventory: [
					{
						name: 'Flower',
						altNames: ['flower'],
						description: 'A really beautiful red flower.',
						canGet: true,
						listOnLook: true
					}
				]
			}
		]
	},
	{
		name: 'Cellar',
		description: 'You are in a dark cellar. There is a staircase to the west leading up to the garden and a secure door to the south.',
		exits: [
			{
				destination: 'Garden',
				direction: 'west',
				isLocked: true,
			},
			{
				destination: 'Research Facility',
				direction: 'south',
				isLocked: true,
				neededKeyId: 'front-door-key'
			},
			{
				destination: 'Garden',
				direction: 'north'
			}
		],
		interactables: [
			{
				name: 'Front Door',
				altNames: ['front door'],
				description: "It's a wooden front door with a brass doorknob.",
				neededKeyId: 'front-door-key',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Living Room'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Living Room'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Living Room'
						}]
					}
				]
			}
		]
	},
	{
		name: 'Living Room',
		description: 'You are in a abandoned living room. There is a door to the west leading to the front porch. There\'s rooms to the north and south.',
		exits: [
			{
				destination: 'Front Porch',
				direction: 'west',
				isLocked: true,
				neededKeyId: 'front-door-key'
			},
			{
				destination: 'Kitchen',
				direction: 'south'
			},
			{
				destination: 'Bedroom',
				direction: 'north'
			}
		],
		interactables: [
			{
				name: 'couch',
				description: 'A dusty old couch with torn upholstery.',
				positionalPhrase: ' in the middle of the room.',
				canGet: false,
				listOnLook: true,
				inventory: []
			},
			{
				name: 'Front Door',
				altNames: ['front door'],
				description: "It's a wooden front door with a brass doorknob.",
				neededKeyId: 'front-door-key',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Front Porch'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Front Porch'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Front Porch'
						}]
					}
				]
			}

		]
	},
	{
		name: 'Bedroom',
		description: 'You are in a small bedroom. There is a bathroom to the east and the living room to the south.',
		exits: [
			{
				destination: 'Living Room',
				direction: 'south'
			},
			{
				destination: 'Bathroom',
				direction: 'east',
				isLocked: true,
			}
		],
		interactables: [
			{
				name: 'bed',
				description: 'A small bed with a thin mattress.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' against the wall.'
			},
			{
				name: 'nightstand',
				altNames: ['dresser'],
				description: 'A small wooden nightstand with a drawer.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' next to the bed.',
				inventory: [
					{
						name: 'Cellar Key',
						altNames: ['cellar key'],
						description: 'A small iron key.',
						keyId: 'cellar-key',
						canGet: true,
						listOnLook: false
					}
				]
			},
			{
				name: 'Bathroom Door',
				altNames: ['door', 'bathroom door'],
				description: "It's a door that leads to the bathroom.",
				neededKeyId: 'bathroom-key',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Bathroom'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Bathroom'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Bathroom'
						}]
					}
				]
			}
		]
	},
	{
		name: 'Kitchen',
		description: 'You are in a small kitchen. There is a table in the middle of the room and a door to the north leading back to the living room.',
		exits: [
			{
				destination: 'Living Room',
				direction: 'north'
			}
		],
		interactables: [
			{
				name: 'crate',
				description: 'A wooden crate filled with old junk.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' in the corner.',
				inventory: [
					{
						name: 'Old Book',
						altNames: ['book', 'old book'],
						description: 'A dusty old book with a leather cover.',
						canGet: true,
						listOnLook: true
					},
					{
						name: 'Bathroom key',
						altNames: ['bathroom key'],
						description: 'A small brass key.',
						keyId: 'bathroom-key',
						canGet: true,
						listOnLook: true
					}
				]
			},
			{
				name: 'garbage pile',
				description: 'A pile of garbage bags and old furniture.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' against the wall.'
			},
			{
				name: 'Cellar Door',
				altNames: ['door', 'cellar door'],
				description: "It's a wooden door set into the ground with a rusty handle.",
				neededKeyId: 'cellar-key',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'toggleLockExit',
							target: 'Garden'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Garden'
						}]
					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Garden'
						}]
					}
				]
			},
			{
				name: 'Keycard terminal',
				altNames: ['terminal', 'keycard terminal'],
				description: 'A high-tech terminal that requires a keycard to access the research facility.',
				positionalPhrase: ' on the wall',
				canGet: false,
				listOnLook: true,
				neededKeyId: 'keycard',
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'unlockExit',
							target: 'Research Facility'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Research Facility'
						}]

					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Research Facility'
						}]
					}
				]
			}
		]
	},
	{
		name: 'Research Facility',
		description: 'You are in a high-tech research facility. There are computers and lab equipment everywhere. The cellar is to the north.',
		exits: [
			{
				destination: 'Cellar',
				direction: 'north'
			}
		],
		interactables: [
			{
				name: 'computer',
				description: 'A sleek computer with a glowing screen.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' on a metal desk.'
			},
			{
				name: 'Disected Alien',
				altNames: ['alien', 'disected alien'],
				description: 'A strange alien creature that has been disected for research purposes.',
				canGet: false,
				listOnLook: true,
				positionalPhrase: ' on an operating table.',
				inventory: [
					{
						name: 'Alien Heart',
						altNames: ['heart', 'alien heart'],
						description: 'A pulsating alien heart that glows with an otherworldly light.',
						canGet: true,
						listOnLook: true
					}
				]
			},
			{
				name: 'Torn Experiment Note',
				altNames: ['log', 'experiment log'],
				description: 'A torn peice of paper that reads : "We fear what we don\'t understand."',
				canGet: true,
				listOnLook: true,
				positionalPhrase: ' on the floor.'
			},
			{
				name: 'Keycard terminal',
				altNames: ['terminal', 'keycard terminal'],
				description: 'A high-tech terminal that requires a keycard to access the research facility.',
				positionalPhrase: ' on the wall',
				neededKeyId: 'keycard',
				canGet: false,
				listOnLook: true,
				actions: [
					{
						commands: ['use'],
						events: [{
							name: 'unlockExit',
							target: 'Research Facility'
						}]
					},
					{
						commands: lockVerbs,
						events: [{
							name: 'lockExit',
							target: 'Research Facility'
						}]

					},
					{
						commands: unlockVerbs,
						events: [{
							name: 'unlockExit',
							target: 'Research Facility'
						}]
					}
				]
			}
		]
	}
];

let lobbies = [];

function randomFromList(list) {
	let i = Math.floor(Math.random() * list.length);
	return list[i];
}

//-------User Collection-----------
// create new user
const crypto = require("crypto");
async function createUser({username, lobbyName, socketId}) {
	const reconnectToken = crypto.randomBytes(32).toString("hex");
	await db.collection("users").insertOne({
			username,
			lobbyName,
			currentWorldRoomName: INITIAL_WORLD_START_ROOM,
			inventory: [],
			socketId,
			reconnectToken,
			createdAt: new Date(),
			tokenUpdatedAt: new Date()
	});
	return reconnectToken;
}

//load existing user
async function getUserFromDB(username) {
	return db.collection("users").findOne({username});
}

//update user fields
async function updateUser(username, updateDoc, options = {}){
	return db.collection("users").updateOne(
		{username},
		updateDoc,
		options
	);
}



//------------Lobbies Collection------------
async function createLobby({lobbyName, createdBy}) {
	return db.collection("lobbies").insertOne({
		lobbyName,
		users: createdBy ? [createdBy] : [],
		gameRooms: structuredClone(INITIAL_WORLD_DATA),
		createdAt: new Date()
	});
}


async function getLobbyFromDB(lobbyName) {
	return db.collection("lobbies").findOne({lobbyName});
}

async function updateLobby(lobbyName, updateDoc, options = {}) {
  return db.collection("lobbies").updateOne(
    { lobbyName },
    updateDoc,
    options
  );
}



//-----------Room States-------------
async function updateRoomState(lobbyName, roomName, updateDoc, options = {}) {
  return db.collection("roomStates").updateOne(
    { lobbyName, roomName },
    updateDoc,
    options
  );
}

async function updateRoomStates(lobbyName, updateDoc, options = {}) {
  return db.collection("roomStates").updateMany(
    { lobbyName },
    updateDoc,
    options
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

	async function emitUserList(lobbyName) {
		const socketsInLobby = await io.in(lobbyName).fetchSockets();
		const userList = [];

		for (const s of socketsInLobby) {
			const u = await db.collection("users").findOne({ username: s.data.name });
			if (u) userList.push({ name: u.username, room: u.currentWorldRoomName });
		}
		io.to(lobbyName).emit("updateUserList", userList);
	}

	async function cleanupUserSession(socket) {
		//This particular socket connection was terminated (probably the client went to a different page
		//or closed their browser).

		let username = socket.data.name;
		let lobbyName = socket.data.lobbyName;

		if (!username || !lobbyName) {
			const user = await db.collection("users").findOne({socketId:socket.id});
			if (user){
				username = user.username;
				lobbyName = user.lobbyName;
			}
		}
		if (!username || !lobbyName) return;

		await updateLobby(lobbyName, { $pull: { users: username } });
		await updateUser(username, {$set:{socketId: null}});
		await updateRoomStates(lobbyName, {$pull: {players: username}});

		io.to(lobbyName).emit("userLeftLobby", username);
		await emitUserList(lobbyName);

		socket.data.lobbyName = null;
	}


	// Leave the current lobby
	// async function leaveLobbyInternal(socket){
	// 	const lobbyName = socket.data.lobbyName;
	// 	if (!lobbyName) return;

	// 	// Find lobby by name
	// 	const lobbyIndex = lobbies.findIndex(r => r.name === lobbyName);
	// 	if (lobbyIndex === -1) {
	// 		socket.data.lobbyName = null;
	// 		return;
	// 	}

	// 	const lobby = lobbies[lobbyIndex];

	// 	// Remove this user from the lobby
	// 	lobby.users = lobby.users.filter(s => s.id !== socket.id);

	// 	socket.leave(lobbyName);
	// 	console.log(socket.data.name + " left " + lobbyName);
	// 	io.to(socket.data.lobbyName).emit("userLeftLobby", socket.data.name);
	// 	let currentLobby = lobbies.find(room => room.name === socket.data.lobbyName);
	// 	if (currentLobby) {
	// 		let gameRoom = currentLobby.gameRooms.find(r => r.name == socket.data.currentWorldRoomName);
	// 		// Drop this user's items in the game room
	// 		gameRoom.interactables = gameRoom.interactables.concat(socket.data.inventory);

	// 		currentLobby.users = currentLobby.users.filter(u => u.name !== socket.data.name);

	// 		// io.to(socket.data.lobbyName).emit("updateUserList", currentLobby.users);
	// 		await emitUserList(lobbyName);

	// 	}
	// 	// TODO (optional): If the lobby is empty, delete the lobby

	// 	socket.data.lobbyName = null;
	// }

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

	async function getCurrentGameRoom(lobby, roomName) {
		return lobby.gameRooms.find(r=>r.name===roomName);
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
				if (verb === 'look' && word === 'at' && objectStartIndex === -1) {
					verb = "look at";
				}
				else if (verb === '') {
					socket.emit('commandResponse', 'Your command must contain a verb.');
					return;
				}
				else if (preposition === '') {
					if (objectStartIndex !== -1) {
						preposition = word;
						objectEndIndex = index - 1;
						if (word === 'out' && ['of', 'from'].includes(words[index + 1])) {
							preposition += " " + words[index + 1];
							index += 1;
						}
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

		//alpha server 1
		// let objectName = getObjectNameFromIndices(words, objectStartIndex, objectEndIndex);
		// let secondaryObjectName = getObjectNameFromIndices(words, secondaryObjectStartIndex, words.length - 1);
		// let currentLobby = lobbies.find(r => r.name === socket.data.lobbyName);
		// let gameRoom = currentLobby.gameRooms.find(r => r.name == socket.data.currentWorldRoomName);
		// let response = '';
		// console.log(objectName + " " + preposition + " ", secondaryObjectName);
		if (['l', 'look'].includes(verb)) {
			response = getRoomDescription(gameRoom);
		}
		else if (['examine', 'look at', 'inspect', 'search'].includes(verb)) {
			let itemToExamine = socket.data.inventory.find(item => item.name === objectName || item.altNames?.includes(objectName));
			if (!itemToExamine) // if it doesn't exist in the inventory, look for it in the room.
				itemToExamine = gameRoom.interactables.find(item => item.name === objectName || item.altNames?.includes(objectName));
			if (itemToExamine?.description) {
				response = itemToExamine?.description;
				if (itemToExamine.inventory) {
					response += " It contains: ";
					if (itemToExamine.inventory.length > 0)
						response += itemToExamine.inventory.map(item => item.name).join(', ');
					else
						response += "nothing.";
				}
			} else
				response = "There doesn't appear to be a " + objectName + " here.";
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
			await updateUser(username, { $set: {currentWorldRoomName: exit.destination}});

// 			await db.collection("lobbies").updateOne(
// 			{ lobbyName: freshLobby.lobbyName },   
// 			{ $set: { gameRooms: freshLobby.gameRooms } }
// );

			socket.data.currentWorldRoomName = exit.destination;

			// 6. Rebuild user list and broadcast
			const socketsInLobby = await io.in(freshUser.lobbyName).fetchSockets();
			let userList = [];

			for (let s of socketsInLobby) {
				const u = await db.collection("users").findOne({ username: s.data.name });
				if (u) userList.push({ name: u.username, room: u.currentWorldRoomName });
			}

			// io.to(freshUser.lobbyName).emit("updateUserList", userList);
			await emitUserList(freshUser.lobbyName);

			return getRoomDescription(destinationRoom);
		}
		else if (['inventory', 'i', 'inv'].includes(verb)) {
			socket.emit('commandResponse',
				"You are carrying: " + (socket.data.inventory.length ? socket.data.inventory.map(item => item?.name).join(", ") : 'nothing')
			);
		}
		else if (['get', 'take', 'grab'].includes(verb)) {
			if (objectName !== '') {
				let itemToTakeIndex = gameRoom.interactables.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
				if (itemToTakeIndex != -1) {
					if (gameRoom.interactables[itemToTakeIndex].canGet) {
						// Remove the item from the gameRoom
						let takenItem = gameRoom.interactables.splice(itemToTakeIndex, 1)[0];
						// Push the item to the player's inventory
						socket.data.inventory.push(takenItem);

						await updateUser(username, {$set:{inventory: socket.data.inventory}});

						response = "You took the " + takenItem.name;
						// Remove the positionalPhrase from the item
						takenItem.positionalPhrase = '';
						// for (user of await getSocketsInGameRoom(gameRoom)) {
						// 	socket.to(user.id).emit('event', socket.data.name + " just took the " + takenItem.name, 'user');
						// }
						io.to(freshLobby.lobbyName).emit('event', socket.data.name + " just took the " + takenItem.name, 'user');
						
						await updateLobby(freshLobby.lobbyName, { $set:{gameRooms: freshLobby.gameRooms}});
					} else response = "You can't take that!";
				} else response = "There doesn't seem to be one of those here.";
				//alpha server n.2
				// if (preposition !== '') {
				// 	let container = gameRoom.interactables.find(item => item.name === secondaryObjectName || item.altNames?.includes(secondaryObjectName));
				// 	if (container) {
				// 		let itemToTakeIndex = container?.inventory.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
				// 		if (itemToTakeIndex != -1) {
				// 			if (container.inventory[itemToTakeIndex].canGet) {
				// 				// Remove the item from the gameRoom
				// 				let takenItem = container.inventory.splice(itemToTakeIndex, 1)[0];
				// 				// Push the item to the player's inventory
				// 				socket.data.inventory.push(takenItem);
				// 				response = "You took the " + takenItem.name;
				// 				// Remove the positionalPhrase from the item
				// 				takenItem.positionalPhrase = ''
				// 				if (takenItem.name == 'Alien Heart') {
				// 					io.to(socket.data.lobbyName).emit('event', socket.data.name + " has discovered the " + takenItem.name + ". They have won the game!", 'user');
				// 				}
				// 				for (user of await getSocketsInGameRoom(gameRoom)) {
				// 					socket.to(user.id).emit('event', socket.data.name + " just took the " + takenItem.name, 'user');
				// 				}
				// 			} else response = "You can't take the " + objectName + "!";
				// 		} else response = "The " + secondaryObjectName + " doesn't contain \"" + objectName + "\".";
				// 	} else
				// 		response = "From what?";
				// }
				// else {
				// 	let itemToTakeIndex = gameRoom.interactables.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
				// 	if (itemToTakeIndex != -1) {
				// 		if (gameRoom.interactables[itemToTakeIndex].canGet) {
				// 			// Remove the item from the gameRoom
				// 			let takenItem = gameRoom.interactables.splice(itemToTakeIndex, 1)[0];
				// 			// Push the item to the player's inventory
				// 			socket.data.inventory.push(takenItem);
				// 			response = "You took the " + takenItem.name;
				// 			// Remove the positionalPhrase from the item
				// 			takenItem.positionalPhrase = '';
				// 			for (user of await getSocketsInGameRoom(gameRoom)) {
				// 				socket.to(user.id).emit('event', socket.data.name + " just took the " + takenItem.name, 'user');
				// 			}
				// 		} else response = "You can't take the " + objectName + "!";
				// 	} else response = "There doesn't seem to be \"" + objectName + "\" here.";
				// }
			}
			else response = verb + " what?";
		}
		else if (verb === 'drop') {
			if (objectName !== '') {
				// Find the index of the item to drop
				let itemToDropIndex = socket.data.inventory.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
				if (itemToDropIndex != -1) {
					// Remove the item from the player's inventory
					let droppedItem = socket.data.inventory.splice(itemToDropIndex, 1)[0];
					// Push the item to the gameRoom
					gameRoom.interactables.push(droppedItem);

					await updateUser(username, {$set: {inventory: socket.data.inventory}});
					response = "You dropped the " + droppedItem.name + " on the ground.";
					droppedItem.positionalPhrase = " on the ground."
					for (user of await getSocketsInGameRoom(gameRoom)) {
						socket.to(user.id).emit('event', socket.data.name + " just dropped " + droppedItem.name, 'user');
					}

					await updateLobby(lobbyName, { $set:{gameRooms: freshLobby.gameRooms}});
					//alpha server n.3
		// 		} else response = "You don't seem to be carrying \"" + objectName + "\"";
		// 	}
		// 	else response = verb + " what?";
		// }
		// else if (['put', 'place'].includes(verb)) {
		// 	if (objectName !== '') {
		// 		// Find the index of the item to drop
		// 		let itemToPlaceIndex = socket.data.inventory.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
		// 		// TODO: make it so you can 'place' items from the room and not just from your inventory, and also be able to put items from inventory/room into items that are in your inventory such as putting something into a bottle.
		// 		let container = gameRoom.interactables.find(item => item.name === secondaryObjectName || item.altNames?.includes(secondaryObjectName));
		// 		if (itemToPlaceIndex != -1) {
		// 			if (container) {
		// 				if (container.inventory) {
		// 					// Remove the item from the player's inventory
		// 					let placedItem = socket.data.inventory.splice(itemToPlaceIndex, 1)[0];
		// 					// Push the item to the container
		// 					container.inventory.push(placedItem);
		// 					response = "You put the " + placedItem.name + " in the " + container.name;
		// 					for (user of await getSocketsInGameRoom(gameRoom)) {
		// 						socket.to(user.id).emit('event', socket.data.name + " just put " + placedItem.name + ' in the ' + container.name, 'user');
		// 					}
		// 				} else response = secondaryObjectName + " doesn't seem to be a container";
		// 			} else response = "There doesn't seem to be a " + secondaryObjectName + " here.";
				} else response = "You don't seem to be carrying that.";
			}
			else response = verb + " what?";
		}
		else if (['use'].includes(verb)) {
			// TODO(?): rename these variables to all use item instead of "object"
			let itemToUse = socket.data.inventory.find(item => item.name === objectName || item.altNames?.includes(objectName));
			if (!itemToUse) // if it doesn't exist in the inventory, look for it in the room.
				itemToUse = gameRoom.interactables.find(item => item.name === objectName || item.altNames?.includes(objectName));
			if (itemToUse) {
				if (itemToUse.useAction) {
					// TODO: the useAction variable will indicate what kind of thing
					// will happen if the item is used on its own without a secondary object.
				} else {
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
						let events = secondaryItem.actions?.find(action => action.commands.includes(verb))?.events;
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
			let primaryItem = socket.data.inventory.find(item => item.name === objectName || item.altNames?.includes(objectName));
			if (!primaryItem) // if it doesn't exist in the inventory, look for it in the room.
				primaryItem = gameRoom.interactables.find(item => item.name === objectName || item.altNames?.includes(objectName));
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

		await logCommand(socket.data.lobbyName, username, command, response);
	}

	//socket.data is a convenience object where we can store application data
	socket.data.name = randomFromList(adjectives) +" "+ randomFromList(nouns);
	socket.data.lobbyName = null;
	socket.data.roomName = null;
	
	socket.on("reconnectUser", async (username, token, callback)=>{
		const user = await getUserFromDB(username);
		const lobbyName = user.lobbyName;
		if(!user) return callback(false, "User not found.");
		if (user.reconnectToken !== token) {
			return callback(false, "Unauthorized.");
		}

		await updateUser(username, {$set: {socketId: socket.id}});

		socket.data.name = user.username;
		socket.data.lobbyName = lobbyName;
		socket.data.currentWorldRoomName = user.currentWorldRoomName || INITIAL_WORLD_START_ROOM;
		socket.data.inventory = user.inventory || [];

		socket.join(lobbyName);

		await updateLobby(lobbyName, {$addToSet:{username: username}});
		await updateRoomState(lobbyName, user.roomName, {$addToSet:{username:username}});
		await emitUserList(lobbyName);
		io.to(lobbyName).emit("userJoinedLobby", username);

		callback(true, "Reconnected");
 	})

	//얘 프론트에 연결해야함***********
	socket.on("disconnect", async function() {
		await cleanupUserSession(socket);
	});


	socket.on("joinLobby", async function (lobbyName, username, token, callback) {
		let user = await db.collection("users").findOne({ username });
		let lobby = await db.collection("lobbies").findOne({ lobbyName });
		
		if (!user) {
			token = await createUser({username, lobbyName, socketId: socket.id});
			socket.data.currentWorldRoomName = INITIAL_WORLD_START_ROOM;
			socket.data.inventory = [];
		}else{
			if (user.reconnectToken !== token) {
				return callback(false, "Unauthorized.");
			}
			if (user?.socketId){
				const oldSocket = io.sockets.sockets.get(user.socketId);
				if (oldSocket && oldSocket.connected && oldSocket.id !== socket.id){
					return callback(false, "User already logged in.");
				}
			}
			token = user.reconnectToken;
			await updateUser(username, {$set:{lobbyName, socketId: socket.id}});

			socket.data.currentWorldRoomName = user.currentWorldRoomName || INITIAL_WORLD_START_ROOM;
			socket.data.inventory = user.inventory || [];
		}

		socket.data.name = username;
		socket.data.lobbyName = lobbyName;

		if (!lobby) {
			await createLobby({lobbyName, createdBy: username});
		}else{
			if(!lobby.users.includes(username)){
				await updateLobby(lobbyName, { $addToSet: { users: username } });
			}
		}

		socket.join(lobbyName);
		io.to(lobbyName).emit("userJoinedLobby", username);
		await emitUserList(lobbyName);

		callback(true, "logged in", {token});
	});


	// socket.on("joinRoom", async function(roomName, callback) {
	// 	const lobbyName = socket.data.lobbyName;
	// 	const username = socket.data.name;

	// 	if (!lobbyName){
	// 		if (callback) callback(false, "Join a lobby first");
	// 		return;
	// 	}

	// 	socket.join(roomName);

	// 	socket.data.roomName = roomName; //TODO: Be wary of ANY data coming from the client.
		
	// 	await updateUser(username, {$set:{
	// 			currentWorldRoomName: roomName,
	// 			lobbyName: lobbyName,
	// 			updatedAt: new Date()
	// 		}});

	// 	await saveRoomState(lobbyName, roomName, {
	// 		$addToSet: { players: username },
	// 		$set: { updatedAt: new Date() }
	// 	});

	// 	await updateLobby(lobbyName, { $addToSet: { users: username } });

	// 	const updatedLobby = await db.collection("lobbies")
	// 		.findOne({lobbyName});

	// 	await emitUserList(lobbyName);

	// 	// the "callback" below calls the method that the client side gave
	// 	if (callback) callback(true, "Joined successfully");
	// });

	// ********* 얘 처리하ㅣㄱ*************************
	// Handle leave lobby request
	socket.on("leaveLobby", async function(callback){
		const lobbyName = socket.data.lobbyName;
		if (lobbyName) socket.leave(lobbyName);

		await cleanupUserSession(socket);
		
		socket.data.lobbyName = null;
		socket.data.roomName = null;
		socket.data.currentWorldRoomName = null;
		socket.data.inventory = [];
		socket.data.name = null;
		if (callback) {
			callback(true, "Left lobby successfully.");
		}
	});

	// sendChat is no longer used on the client side. (users use the "say" command)
	// socket.on("sendChat", async function(chatMessage) {
	// 	let lobbyName = socket.data.lobbyName;
	// 	let currentLobby = socket.data.lobbyName;
	// 	let messageObj = {
	// 		room: currentLobby,
	// 		user: socket.data.name,
	// 		text: chatMessage,

	// 	}
		
	// 	await db.collection("messages").insertOne(messageObj);

	// 	io.to(currentLobby).emit("messageSent", 
	// 		`${messageObj.user}:${messageObj.text}`
	// 	);
	// });
	//3번 수정
	// socket.on("sendChat", async function(chatMessage) {
	// 	const lobbyName = socket.data.lobbyName;

	// 	const messageObj = {
	// 		lobbyName,
	// 		user: socket.data.name,
	// 		text: chatMessage,
	// 		time: new Date()
	// 	};

	// 	await db.collection("messages").insertOne(messageObj);

	// 	io.to(lobbyName).emit("messageSent", `${messageObj.user}:${messageObj.text}`);
	// });

	socket.on("directMessage", function(targetUser, text) {
		for(id of Array.from(io.sockets.sockets.keys())) {
			if (io.sockets.sockets.get(id).data.name == targetUser.name) {
				let m = socket.data.name + " just whispered to " + targetUser.name + ": " + text;
				io.sockets.sockets.get(id).emit("messageSent", m);
				socket.emit("messageSent", m); //also informs the one who sent the whisper
			}
		}
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
	// socket.on("showChatHistory", async function(callback){
	// 	const lobbyName = socket.data.lobbyName;
	// 	if (!lobbyName){
	// 		if (callback) callback(false, "You are not in a lobby.", []);
	// 		return;
	// 	}

	// 	// const history = lobbyMessages[lobbyName] || [];
	// 	const history = await db.collection("messages")
	// 		.find({room:roomName})
	// 		.sort({time:1})
	// 		.toArray();

	// 	if (callback) callback(true, history);
	// });
	//4번 수정
	// *********************이거 처리하기*******
	socket.on("showChatHistory", async function(callback){
		const lobbyName = socket.data.lobbyName;
		if (!lobbyName){
			if (callback) callback(false, "You are not in a lobby.", []);
			return;
		}

		const history = await db.collection("messages")
			.find({ lobbyName })
			.sort({ time: 1 })
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
	const state = await getRoomState(lobbyName, roomName);
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
