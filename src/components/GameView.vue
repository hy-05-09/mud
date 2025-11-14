<script>
import { io } from "socket.io-client";

var socket = io();

export default {
  emits: ['countIsBig'],
  props: {
    msg: String,
  },
  data() {
		return {
			inputText: "",
			chatHistory: [],
			username: null,
			requestedUsername: "",
			userList: [],
			requestedRoomName: ""
		};
	},
	methods: {
		sendText() {
			socket.emit("sendChat", this.inputText);
			this.inputText = "";
		},
		requestUsername() {
			socket.emit("sendUsername", this.requestedUsername, (usernameValid, previousChatMessages) => {
				if (usernameValid) {
					this.username = this.requestedUsername;
					this.chatHistory = previousChatMessages;
				}
				else {
					alert("Username" + this.requestedUsername +" is already taken.  Try another.");
				}
			});
		},
		directMessage(index) {
			socket.emit("directMessage", this.userList[index], this.inputText);
			this.inputText = "";
		},
		joinRoom() {
			socket.emit("joinRoom", this.requestedRoomName, (success, message) => {
				if (success) {
					console.log("Joined room successfully!");
				} else {
					console.log("Failed to join room: " + message);
				}
			});
		},
		handleIntro(){
			this.requestUsername();
			this.joinRoom();
		}
	},
	mounted() {
		socket.on("messageSent", (chatMessage) => {
			this.chatHistory.push(chatMessage);
		});
		socket.on("updateUserList", (userList) => {
			this.userList = userList;
		});

	}
}
</script>
<template>
    <div id="container">
      <span id="chat">
        <p v-for="chat of chatHistory" :key="chat">{{ chat }}</p>
      </span>
      <span id="map">Map</span>
    </div> 
    <div id="controls">
      <input id="inputText" type="text" v-model="inputText"/>
      <button id="sendButton" @click="sendText">test</button>
    </div>
	<div v-if="username==null" class="overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
		<p>Enter a username</p>
		<input v-model="requestedUsername" type="text">
		<p>Enter a room name to join or create new one</p>
		<input v-model="requestedRoomName" type="text"></input>
		<br></br>
		<button @click="handleIntro">Submit</button>
	</div>
	<p class="clickable" @click="directMessage(index)" v-for="(user, index) of userList">{{user}}<br></p>
</template>