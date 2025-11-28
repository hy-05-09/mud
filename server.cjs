// This file was copied from the CS365 notes

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

let messages = []; //a full list of all chat made on this server
let lobbyMessages = {}; // a list of chats made on specific room

let adjectives = ["Best", "Happy", "Creepy", "Sappy"];
let nouns = ["Programmer", "Developer", "Web dev", "Student", "Person"];

const MAX_USERS_PER_LOBBY = 4;

const INITIAL_WORLD_START_ROOM = 'outside';

// This is the initial game data that each server-room starts with:
const INITIAL_WORLD_DATA = [
	{
		name: 'kitchen',
		description: 'You are standing in a kitchen with a table in the middle. There is a refrigerator here. There is a door to the north leading outside.',
		exits: [
			{
				destination: 'outside',
				direction: 'north'
			},
			{
				destination: 'locked-room',
				direction: 'east'
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
				name: 'key',
				description: 'It is an old key',
				positionalPhrase: ' sitting on the table.', // This is used to describe where the object is in the room.
				canGet: true,
				listOnLook: true, // If this is true, the item will be tacked on to the room description
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
				direction: 'west'
			}
		],
		interactables: []
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

let verbs = ['l', 'look', 'examine', 'north', 'n', 'south', 's', 'east', 'e', 'west',
	'w', 'up', 'u', 'down', 'd', 'get', 'grab', 'take', 'drop', 'use', 'attack', 'hit',
	'read', 'eat', 'drink', 'throw', 'jump', 'sit', 'whisper', 'say', 'yell', 'talk',
	'speak', 'open', 'close', 'put', 'place', 'set', 'unlock', 'lock', 'turn',
	'help', 'h', 'inventory', 'i']; // Make sure to handle "look at"

let prepositions = ['with', 'at', 'on', 'in', 'to'];

//Every time a client connects (visits the page) this function(socket) {...} gets executed.
//The socket is a different object each time a new client connects.
io.on("connection", function(socket) {
	// console.log("Somebody connected.");
	

	//socket.data is a convenience object where we can store application data
	socket.data.name = randomFromList(adjectives) +" "+ randomFromList(nouns);


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

		// Split the command by spaces into an array
		let words = command.split(" ");
		let unmodifiedWords = words;
		words = words.map(word => word.toLowerCase());
		let verb = '';
		let verbIndex = 0;
		// let object = '';
		let objectStartIndex = -1; // For game items that have names with spaces
		let objectEndIndex = -1;
		let preposition = '';
		let secondaryObject = '';

		// Find the verb
		let index = 0;
		for (word of words) {
			if (prepositions.includes(word)) {
				if (verb === '') {
					socket.emit('commandResponse', 'Your command cannot start with a proposition.');
					return;
				}
				if (preposition === '') {
					if (objectStartIndex !== -1) {
						preposition = word;
						objectEndIndex = index; // use the index as-is because it hasn't been incremented yet
					} else {
						socket.emit('commandResponse', verb + " " + word + " what?");
						return;
					}
				} else {
					socket.emit('commandResponse', 'There is more than one preposition in that sentence.');
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
			else if (verb !== '') {
				if (objectStartIndex === -1) {
					// object = word;
					objectStartIndex = index;
				} else {
					objectEndIndex = index;
				}
			}
			index += 1;
		}

		let currentLobby = lobbies.find(r => r.name === socket.data.lobbyName);
		let gameRoom = currentLobby.gameRooms.find(r => r.name == socket.data.currentWorldRoomName);
		let response = '';
		if (['l', 'look'].includes(verb)) {
			response = getRoomDescription(gameRoom);
		}
		else if (['help', 'h'].includes(verb)) {
			response = "TODO: output some text to help the user.";
		}
		else if (['north', 'n', 'south', 's', 'east', 'e', 'west', 'w', 'up', 'u', 'down', 'd'].includes(verb)) {
			// Extend the shortcut direction commands to their full word so that they can be used to filter the array
			if (verb === 'n') verb = 'north';
			else if (verb === 's') verb = 'south';
			else if (verb === 'e') verb = 'east';
			else if (verb === 'w') verb = 'west';
			else if (verb === 'u') verb = 'up';
			else if (verb === 'd') verb = 'down';

			let exit = gameRoom.exits.find(exit => exit.direction === verb);
			if (exit) {
				let destinationRoom = currentLobby.gameRooms.find(r => r.name == exit.destination);
				socket.data.currentWorldRoomName = exit.destination;
				response = getRoomDescription(destinationRoom);

				// Notify the relevant users that this user changed game rooms
				let socketsInLobby = await io.in(socket.data.lobbyName).fetchSockets();
				let usersInExitedRoom = socketsInLobby.filter(s => s.data.currentWorldRoomName == gameRoom.name);
				let usersInDestinationRoom = socketsInLobby.filter(s => s.data.currentWorldRoomName == destinationRoom.name);
				for (user of usersInExitedRoom) {
					socket.to(user.id).emit('event', socket.data.name + " just went " + verb, 'user');
				}
				for (user of usersInDestinationRoom) {
					socket.to(user.id).emit('event', socket.data.name + " just entered from the " + verb, 'user');
				}
			} else
				response = "There is no exit in that direction";
		}
		else if (['inventory', 'i'].includes(verb)) {
			socket.emit('commandResponse',
				"You are carrying: " + (socket.data.inventory.length ? socket.data.inventory.map(item => item?.name).join(", ") : 'nothing')
			);
		}
		else if (['get', 'take'].includes(verb)) {
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
			if (objectName !== '') {
				let itemToTakeIndex = gameRoom.interactables.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
				if (itemToTakeIndex != -1) {
					if (gameRoom.interactables[itemToTakeIndex].canGet) {
						// Remove the item from the gameRoom
						let takenItem = gameRoom.interactables.splice(itemToTakeIndex, 1)[0];
						// Push the item to the player's inventory
						socket.data.inventory.push(takenItem);
						response = "You took the " + takenItem.name;
						// Remove the positionalPhrase from the item
						takenItem.positionalPhrase = '';
						for (user of await getSocketsInGameRoom(gameRoom)) {
							socket.to(user.id).emit('event', socket.data.name + " just took the " + takenItem.name, 'user');
						}
					} else response = "You can't take that!";
				} else response = "There doesn't seem to be one of those here.";
			}
			else response = verb + " what?";
		}
		else if (verb === 'drop') {
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
			if (objectName !== '') {
				// Find the index of the item to drop
				let itemToDropIndex = socket.data.inventory.findIndex(item => item.name === objectName || item.altNames?.includes(objectName));
				if (itemToDropIndex != -1) {
					// Remove the item from the player's inventory
					let droppedItem = socket.data.inventory.splice(itemToDropIndex, 1)[0];
					// Push the item to the gameRoom
					gameRoom.interactables.push(droppedItem);
					response = "You dropped the " + droppedItem.name + " on the ground.";
					droppedItem.positionalPhrase = " on the ground."
					for (user of await getSocketsInGameRoom(gameRoom)) {
						socket.to(user.id).emit('event', socket.data.name + " just dropped " + droppedItem.name, 'user');
					}
				} else response = "You don't seem to be carrying that.";
			}
			else response = verb + " what?";
		}
		else if (['say', 'speak', 'talk'].includes(verb)) {
			let quote = unmodifiedWords.slice(verbIndex + 1).join(' ');
			let m = socket.data.name + " says \"" + quote + "\"";
			socket.to(socket.data.lobbyName).emit("messageSent", m);
			let response = "You said \"" + quote + "\"";
			socket.emit('commandResponse', response);
			response = '';
			// TODO: make the players only able to talk to the players in the same game world room?
		}
		else response = "I didn't understand that.";

		if (response != '')
			socket.emit('commandResponse', response);
	}

	socket.on("disconnect", function() {
		//This particular socket connection was terminated (probably the client went to a different page
		//or closed their browser).

		let username = socket.data.username;
		// Remove user from their room
		leaveLobbyInternal(socket);

		let currentLobby = lobbies.filter(room => room.name == socket.data.lobbyName)[0];
		if (currentLobby) {
			io.to(socket.data.lobbyName).emit("updateUserList", currentLobby.users);
		}
	});

	socket.on("directMessage", function(targetUser, text) {
		for(id of Array.from(io.sockets.sockets.keys())) {
			if (io.sockets.sockets.get(id).data.name == targetUser) {
				let m = socket.data.name + " just whispered to " + targetUser + ": " + text;
				io.sockets.sockets.get(id).emit("messageSent", m);
				socket.emit("messageSent", m); //also informs the one who sent the whisper
			}
		}
	});

	socket.on("joinLobby", function(lobbyName, username, callback) {
		let allIds = Array.from(io.sockets.sockets.keys());
		let duplicate = false;
		for(id of allIds) {
			if(io.sockets.sockets.get(id).data.name == username) {
				duplicate = true;
			}
		}

		if (!duplicate) {
			socket.data.name = username; //TODO: Be wary of ANY data coming from the client.
		}
		else {
			callback(false, "Username " + username + " is already taken. Try another.");
			return;
		}

		socket.data.lobbyName = lobbyName; //TODO: Be wary of ANY data coming from the client.

		// Place the new user/socket in a room
		socket.join(lobbyName);

		socket.data.currentWorldRoomName = INITIAL_WORLD_START_ROOM

		let lobbyToJoin = lobbies.filter(lobby => lobby.name == lobbyName)[0];
		if (lobbyToJoin) {
			if (lobbyToJoin?.users?.length >= MAX_USERS_PER_LOBBY) {
				callback(false, "That lobby is full!");
				return;
			}

			lobbyToJoin.users.push(socket.data.name);
			io.to(lobbyName).emit("updateUserList", lobbyToJoin.users);
		} else {
			// Note the difference between a server room (now called a lobby) and a game room
			let newLobby = {
				name: lobbyName,
				gameRooms: structuredClone(INITIAL_WORLD_DATA),
				users: [socket.data.name]
			};
			lobbies.push(newLobby);
			lobbyToJoin = newLobby;
		}

		if (!lobbyMessages[lobbyName]){
			lobbyMessages[lobbyName] = [];
		}

		socket.data.inventory = [
			// Default starting inventory
			{
				name: "scrap of paper",
				altNames: ['paper'],
				description: "It's a tattered piece of blank paper.",
				canGet: true,
				listOnLook: true,
			},
			{
				name: "pencil",
				description: "It's a yellow wooden pencil with a dried out eraser.",
				canGet: true,
				listOnLook: true,
			}
		];

		// the "callback" below calls the method that the client side gave
		callback(true, "Joined successfully");
		io.to(socket.data.lobbyName).emit("userJoinedLobby", socket.data.name);
		let currentGameRoom = lobbyToJoin.gameRooms.find(r => r.name == socket.data.currentWorldRoomName)
		socket.emit('event', getRoomDescription(currentGameRoom));
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
		// let m = socket.data.name + ": " + chatMessage;
		// messages.push(m);
		// lobbyMessages[lobbyName].push(m);
		let messageObj = {
			room: currentLobby,
			user: socket.data.name,
			text: chatMessage,
			time: new Date()
		};

		await db.collection("messages").insertOne(messageObj);

		io.to(currentLobby).emit("messageSent", 
			`${messageObj.user}:${messageObj.text}`
		);
	});

	//retrieve stored chat history for this lobby
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


	socket.on("sendCommand", function(command, callback) {
		const lobbyName = socket.data.lobbyName;
		if (!lobbyName){
			callback(false, "You are not in a lobby.");
			return;
		}

		const lobby = lobbies.find(r => r.name === lobbyName);
		if (!lobby) {
			callback(false, "Lobby not found.");
			return;
		}
		parseCommand(command);
		callback(true, "");
	});


	// List players in the current lobby
	socket.on("listPlayers", function(callback){
		const lobbyName = socket.data.lobbyName;
		if (!lobbyName){
			if (callback) callback(false, "You are not in a lobby.", []);
			return;
		}

		const lobby = lobbies.find(r => r.name === lobbyName);
		if (!lobby) {
			if (callback) callback(false, "Lobby not found.", []);
			return;
		}

		const playerNames = lobby.users;
		if (callback) callback(true, playerNames);
	});
});


async function run() {
	// Connect the client to the server (optional starting in v4.7)
	await client.connect();
	// Send a ping to confirm a successful connection
	db = client.db("mudGame");
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