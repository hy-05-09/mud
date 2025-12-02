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
			requestedLobbyName: ""
		};
	},
	methods: {
		sendText() {
			// socket.emit("sendChat", this.inputText);
			this.addChatHistory(">" + this.inputText); // This line shows the command that the user typed
			socket.emit("sendCommand", this.inputText, (success, msg) => {
				if (success) {
					this.inputText = "";
				}
				else {
					this.addChatHistory(msg);
				}
			});
		},
		directMessage(index) {
			socket.emit("directMessage", this.userList[index], this.inputText);
			this.inputText = "";
		},
		joinLobby() {
			socket.emit("joinLobby", this.requestedLobbyName, this.requestedUsername, (success, message) => {
				if (success) {
					this.username = this.requestedUsername;
					// this.chatHistory = previousChatMessages;
					console.log("Joined lobby successfully!");
				} else {
					alert("Failed to join lobby: " + message);
				}
			});
		},
		handleIntro(){
			this.joinLobby();
		},
		requestPlayersInLobby() {
			socket.emit('listPlayers', (success, message) => {
				if (success) {
					console.log(message);
				}
			})
		},
		addChatHistory(msg, type = '') {
			this.chatHistory.push({
				text: msg,
				type: type
			});
			// Set a 50 milisecond timer so that enough time has passed for the new msg to be added and then scroll to the bottom.
			setTimeout(() => {
				this.$refs.chatBox.scrollTop = this.$refs.chatBox.scrollHeight;
			}, 50);
		}
	},
	mounted() {
		socket.on("messageSent", (chatMessage) => {
			this.addChatHistory(chatMessage, 'message');
		});
		socket.on("commandResponse", (chatMessage) => {
			this.addChatHistory(chatMessage);
		});
		socket.on("updateUserList", (userList) => {
			this.userList = userList;
		});
		socket.on("userLeftLobby", (username) => {
			this.addChatHistory(username + " left the game.", 'user');
		});
		socket.on("userJoinedLobby", (username) => {
			if (username == this.username) {
				this.addChatHistory("Welcome, " + this.username + ", you joined successfully.");
			} else {
				this.addChatHistory(username + " joined the game.", 'user');
			}
		});
		socket.on('event', (msg, type = '') => {
			this.addChatHistory(msg, type);
		})
	}
}
</script>
<template>
    <div id="container">
      	<div id="chat" ref="chatBox">
        	<template v-for="chat of chatHistory" :key="chat.text">
				<p :class="[
					'chat-line',
					chat.type == 'user' ? 'text-user' : 
					chat.type == 'message' ? 'text-message' : '',
				]">
					{{ chat.text }}
				</p>
			</template>
      	</div>
		<div id="userList">
			<!-- <p class="clickable" @click="directMessage(index)" v-for="(user, index) of userList">{{user.name}} - {{user.room}}<br></p> -->
			 <p class="clickable" @click="directMessage(index)" v-for="(user, index) of userList">{{user}}<br></p>
		</div>
    </div>
	<form
		id="controls"
		autocomplete="off"
		@submit.prevent="sendText"
	>
		<input id="inputText" type="text" v-model="inputText"/>
		<button id="sendButton" type="submit">Submit</button>
	</form>
	<div v-if="username==null" class="overlay" style="position: absolute; inset: 0;">
		<p>Enter a username</p>
		<input v-model="requestedUsername" type="text">
		<p>Enter a lobby name to join or create new one</p>
		<input v-model="requestedLobbyName" type="text"></input>
		<br></br>
		<button @click="handleIntro">Submit</button>
	</div>
	<!-- <p class="clickable" @click="directMessage(index)" v-for="(user, index) of userList">{{user}}<br></p> -->
</template>