// This file was copied from the CS365 notes

var express = require("express");
var app = express();
var http = require("http");
var server = http.Server(app);
var socketio = require("socket.io");
var io = socketio(server);
app.use(express.static("pub"));

let messages = []; //a full list of all chat made on this server
let roomMessages = {}; // a list of chats made on specific room

let adjectives = ["Best", "Happy", "Creepy", "Sappy"];
let nouns = ["Programmer", "Developer", "Web dev", "Student", "Person"];

const MAX_USERS_PER_ROOM = 4;

// This is the initial game data that each server-room starts with:
const INITIAL_WORLD_DATA = [
	{
		name: 'kitchen',
		description: 'You are standing in a kitchen. There is a refridgerator here. There is a door to the north leading outside.',
		exits: [
			{
				name: 'outside',
				direction: 'north'
			}
		],
		interactable: [
			{
				name: 'fridge',
				description: 'It is a refridgerator with two doors, a freezer being on the bottom'
			}
		]
	},
	{
		name: 'outside',
		description: 'You are outside. There is a door to the south leading to the kitchen',
		exits: [
			{
				name: 'kitchen',
				direction: 'south'
			}
		]
	}
];

let rooms = [];

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

function updateGameWorld(roomName) {
	let currentRoom = rooms.find(r => r.name === roomName);
	io.to(roomName).emit("updateGameWorld", currentRoom);
}

let verbs = ['l', 'look', 'examine', 'north', 'n', 'south', 's', 'east', 'e', 'west',
	'w', 'up', 'u', 'down', 'd', 'get', 'grab', 'take', 'drop', 'use', 'attack', 'hit',
	'read', 'eat', 'drink', 'throw', 'jump', 'sit', 'whisper', 'say', 'yell', 'talk',
	'speak', 'open', 'close', 'put', 'place', 'set', 'unlock', 'lock', 'turn',
	'help', 'h',]; // Make sure to handle "look at"

let prepositions = ['with', 'at', 'on', 'in', 'to'];

//Every time a client connects (visits the page) this function(socket) {...} gets executed.
//The socket is a different object each time a new client connects.
io.on("connection", function(socket) {
	// console.log("Somebody connected.");
	

	//socket.data is a convenience object where we can store application data
	socket.data.name = randomFromList(adjectives) +" "+ randomFromList(nouns);


	// Leave the current room
	function leaveRoomInternal(socket){
		const roomName = socket.data.roomName;
		if (!roomName) return;

		// Find room by name
		const roomIndex = rooms.findIndex(r => r.name === roomName);
		if (roomIndex === -1) {
			socket.data.roomName = null;
			return;
		}

		const room = rooms[roomIndex];

		// Remove this user from the room
		room.users = room.users.filter(s => s.id !== socket.id);

		socket.leave(roomName);
		console.log(socket.data.name + " left " + roomName);

		// TODO (optional): If the room is empty, delete the room

		socket.data.roomName = null;
	}

	function parseCommand(command) {
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
		let verb = '';
		let object = '';
		let preposition = '';
		let secondaryObject = '';

		// Find the verb
		for (word of words) {
			if (prepositions.includes(word)) {

			}
			if (verbs.includes(word)) {
				verb = word;
			}
		}

		let response = '';
		if (['l', 'look'].includes(verb)) {
			let currentRoom = rooms.find(r => r.name === socket.data.roomName);
			response = currentRoom.gameRooms[0].description;
		} else {
			response = "I didn't understand that.";
		}

		socket.emit('commandResponse', response);
	}

	socket.on("disconnect", function() {
		//This particular socket connection was terminated (probably the client went to a different page
		//or closed their browser).
		console.log("Somebody disconnected.");

		// Remove user from their room
		leaveRoomInternal(socket);

		io.emit("updateUserList", mapSocketsToUsernames(io.sockets.sockets));
		// TODO: remove the user from their room and if the room is empty, delete the room.
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

	//Events coming from client going to server...
	socket.on("sendUsername", function(username, callback) {
		let allIds = Array.from(io.sockets.sockets.keys());
		let duplicate = false;
		for(id of allIds) {
			if(io.sockets.sockets.get(id).data.name == username) {
				duplicate = true;
			}
		}

		if (!duplicate) {
			socket.data.name = username; //TODO: Be wary of ANY data coming from the client.
			callback(true, messages);

			io.emit("updateUserList", mapSocketsToUsernames(io.sockets.sockets));
			let h = username + " logged in!";
			messages.push(h);
			io.emit("messageSent", h);
		}
		else {
			callback(false, null);
		}
	});

	socket.on("joinRoom", function(roomName, callback) {
		socket.data.roomName = roomName; //TODO: Be wary of ANY data coming from the client.

		// Place the new user/socket in a room
		socket.join(roomName);
		console.log(socket.data.name + ' joined ' + roomName);

		let roomToJoin = rooms.filter(room => room.name == roomName)[0];
		if (roomToJoin) {
			if (roomToJoin?.users?.length >= MAX_USERS_PER_ROOM) {
				callback(false, "That room is full!");
				return;
			}

			roomToJoin.users.push(socket.data.name);
			// console.log(roomToJoin.users.map(socket => socket.data.name));
		} else {
			// Note the difference between a server room and a game room
			let newRoom = {
				name: roomName,
				gameRooms: structuredClone(INITIAL_WORLD_DATA),
				users: [socket.data.name]
			};
			rooms.push(newRoom);
		}

		if (!roomMessages[roomName]){
			roomMessages[roomName] = [];
		}

		// the "callback" below calls the method that the client side gave
		callback(true, "Joined successfully");

		updateGameWorld(roomName);
	});

	// Handle leave room request
	socket.on("leaveRoom", function(callback){
		leaveRoomInternal(socket);

		if (callback) {
			callback(true, "Left room successfully.");
		}
	});

	socket.on("sendChat", function(chatMessage) {
		let roomName = socket.data.roomName;
		console.log(socket.rooms)
		// let currentRoom = Array.from(socket.rooms)[0]; // The users can only be in one room at a time, so just take the first room that they are in
		let currentRoom = socket.data.roomName;
		let m = socket.data.name + " just said: " + chatMessage + " from room: " + currentRoom;
		messages.push(m);
		roomMessages[roomName].push(m);
		console.log(m);
		io.to(currentRoom).emit("messageSent", m);
	});

	//retrieve stored chat history for this room
	socket.on("showChatHistory", function(callback){
		const roomName = socket.data.roomName;
		if (!roomName){
			if (callback) callback(false, "You are not in a room.", []);
			return;
		}

		const history = roomMessages[roomName] || [];
		if (callback) callback(true, history);
	});


	socket.on("sendCommand", function(command, callback) {
		const roomName = socket.data.roomName;
		if (!roomName){
			callback(false, "You are not in a room.");
			return;
		}

		const room = rooms.find(r => r.name === roomName);
		if (!room) {
			callback(false, "Room not found.");
			return;
		}
		parseCommand(command);
		callback(true, "");
	});


	// List players in the current room
	socket.on("listPlayers", function(callback){
		const roomName = socket.data.roomName;
		if (!roomName){
			if (callback) callback(false, "You are not in a room.", []);
			return;
		}

		const room = rooms.find(r => r.name === roomName);
		if (!room) {
			if (callback) callback(false, "Room not found.", []);
			return;
		}

		const playerNames = room.users.map (s => s.data.name);
		if (callback) callback(true, playerNames);
	});
});

server.listen(8080, function() {
	console.log("Server with socket.io is ready.");
});

