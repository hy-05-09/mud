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
			userList: [],

			username: null,
			requestedUsername: "",
			requestedLobbyName: "",

			historyLimit: 200
		};
	},
	methods: {
		addChatHistoryFromLog(e){
			//e: server logEntry document
			//{ type, visibility, from, to, text, command, response, time, ...}

			if (!e) return;

			if (e.type === "command"){
				const cmdLine = e.command ? `> ${e.command}` : "> (command)";
				const respLine = e.response ?? "";
				this.chatHistory.push({ text: `${cmdLine}\n${respLine}`, type: "command" });
        		return;
			}

			if (e.type === "whisper"){
				const label = (e.from === this.username) ? `[TO: ${e.to}]` : `[FROM: ${e.from}]`;
				this.chatHistory.push({ text: `${label} ${e.text}`, type: "whisper" });
        		return;
			}

			if (e.type === "system") {
				this.chatHistory.push({ text: e.text, type: "system" });
				return;
			}

			if (e.type === "chat") {
				this.chatHistory.push({ text: `${e.from}: ${e.text}`, type: "chat" });
				return;
			}

			// fallback
      		this.chatHistory.push({ text: JSON.stringify(e), type: "system" });
		},
		scrollToBottom(){
			this.$nextTick(() => {
				if (this.$refs.chatBox) {
					this.$refs.chatBox.scrollTop = this.$refs.chatBox.scrollHeight;
				}
			});
		},
		sendText() {
			const cmd = this.inputText?.trim();
			if (!cmd) return;

			socket.emit("sendCommand", cmd, (ok, msg) => {
				if (!ok) alert(msg || "Command failed");
			});

			this.inputText = "";
		},
		directMessage(index) {
			const target = this.userList[index];
			const text = this.inputText?.trim();
			if (!target || !text) return;

			socket.emit("directMessage", {name: target.name}, text);
			this.inputText = "";
		},
		requestHistory() {
			socket.emit("showChatHistory", this.historyLimit, (ok, logsOrMsg, maybeLogs) => {
				if (!ok) return;

				const logs = Array.isArray(logsOrMsg) ? logsOrMsg : (Array.isArray(maybeLogs) ? maybeLogs : []);
				this.chatHistory = [];
				for (const e of logs) this.addChatHistoryFromLog(e);
				this.scrollToBottom();
			})
		},
		joinLobby() {
			const username = this.requestedUsername?.trim();
			const lobbyName = this.requestedLobbyName?.trim();
			if (!username || !lobbyName) return alert("Enter username and lobby name.");

			const savedToken = localStorage.getItem(`mud_token:${username}`) || null;

			socket.emit("joinLobby", lobbyName, username, savedToken, (success, message, payload) => {
				console.log("token:", savedToken);

				if (!success) return alert("Failed to join lobby: " + message);

				this.username = username;
				localStorage.setItem("mud_last_username", username);

				if (payload?.token) localStorage.setItem(`mud_token:${username}`, payload.token);
				this.requestHistory();
			});
			
		},
		leaveLobby(){
			socket.emit("leaveLobby", (ok, msg) => {
				if (!ok) return alert(msg || "Failed to leave lobby");

				this.inputText="";
				this.chatHistory=[];
				this.userList = [];

				localStorage.removeItem("mud_last_username");

				this.username = null;
				this.requestedUsername = "";
				this.requestedLobbyName = "";
			});
		}
	},
	mounted() {
		socket.on("logEntry", (e) => {
			this.addChatHistoryFromLog(e);
			this.scrollToBottom();
		});
		socket.on("updateUserList", (userList) => {
			this.userList = userList || [];
		});
		socket.on("connect", () => {
			const username = localStorage.getItem("mud_last_username");
			const token = localStorage.getItem(`mud_token:${username}`);
			if (!username || !token) return;

			socket.emit("reconnectUser", username, token, (ok, msg) => {
				if (!ok) return;
				this.username = username;

				this.requestHistory();
			});
		});
		// socket.on("messageSent", (chatMessage) => {
		// 	this.addChatHistory(chatMessage, 'message');
		// });
		// socket.on("commandResponse", (chatMessage) => {
		// 	this.addChatHistory(chatMessage);
		// });
		
		// socket.on("userLeftLobby", (username) => {
		// 	this.addChatHistory(username + " left the game.", 'user');
		// });
		// socket.on("userJoinedLobby", (username) => {
		// 	if (username == this.username) {
		// 		this.addChatHistory("Welcome, " + this.username + ", you joined successfully.");
		// 	} else {
		// 		this.addChatHistory(username + " joined the game.", 'user');
		// 	}
		// });
		// socket.on('event', (msg, type = '') => {
		// 	this.addChatHistory(msg, type);
		// })
	}
}
</script>
<template>
	<div class="top-bar">
		<button v-if="username" @click="leaveLobby">Logout</button>
	</div>
    <div id="container">
      	<div id="chat" ref="chatBox">
        	<template v-for="(chat, idx) of chatHistory" :key="idx">
				<p :class="[
					'chat-line',
					chat.type === 'system' ? 'text-user' : 
					chat.type === 'chat' ? 'text-message' : 
					chat.type === 'whisper' ? 'text-message' :
					chat.type === 'command' ? 'text-command' : ''
				]">
					{{ chat.text }}
				</p>
			</template>
      	</div>
		<div id="userList">
			<p class="clickable" @click="directMessage(index)" v-for="(user, index) of userList">{{user.name}} - {{user.room}}<br></p>
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
		<button @click="joinLobby">Submit</button>
	</div>
</template>



