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
			maxPlayers: 4,
			showOffline: false,

			username: null,
			requestedUsername: "",
			lobbyName : null,
			requestedLobbyName: "",

			historyLimit: 200,

			debugFakeReconnecting: true
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

				if (e.command === 'join') this.chatHistory.push({text: respLine, type: "command"});
				else this.chatHistory.push({ text: `${cmdLine}\n${respLine}`, type: "command" });
        		return;
			}

			if (e.type === "whisper"){
				const label = (e.from === this.username) ? `[TO: ${e.to}]` : `[FROM: ${e.from}]`;
				if (e.from===e.to) {
					this.chatHistory.push({ text: `[FROM: ${e.from}] ${e.text}`, type: "whisper" });
					this.chatHistory.push({ text: `[TO: ${e.to}] ${e.text}`, type: "whisper" });
				}
				else this.chatHistory.push({ text: `${label} ${e.text}`, type: "whisper" });
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
				this.lobbyName = lobbyName;
				localStorage.setItem("mud_last_lobby", lobbyName);

				if (payload?.token) localStorage.setItem(`mud_token:${username}`, payload.token);
				if (payload?.maxPlayers) this.maxPlayers = payload.maxPlayers;
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
				localStorage.removeItem("mud_last_lobby");

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

			if (this.debugFakeReconnecting) {
				this.userList.push({
					name: "debug",
					status: "reconnecting"
				})
			}
		});
		socket.on("connect", () => {
			const username = localStorage.getItem("mud_last_username");
			const lobbyName = localStorage.getItem("mud_last_lobby");
			const token = localStorage.getItem(`mud_token:${username}`);
			if (!username || !token) return;

			socket.emit("reconnectUser", username, token, (ok, msg) => {
				if (!ok) return;
				this.username = username;
				this.lobbyName = lobbyName;

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
	},
	computed: {
		onlineCount(){
			return (this.userList || []).filter(u=>u.status === "online"|| u.status ==="reconnecting").length;
		},
		offlineCount(){
			return (this.userList || []).filter(u=>u.status==="offline").length;
		}
	}
}
</script>
<template>
	<div id="app">
		<div  id="online">
			<div class="top-bar">
				<div id="top-spacer"></div>
				<p id="lobbyName">=== {{ lobbyName }} ===</p>
				<button id="logout" v-if="username" @click="leaveLobby">Logout</button>
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
					<p id="playersCount">Online ({{onlineCount}}/{{ maxPlayers }})</p>
					<hr>
					<template v-for="(user, index) of userList" :key="user.name">
						<p @click="directMessage(index)" v-if="user.name === username" class="clickable me">
							▶ {{user.name}} - {{user.room}}
						</p>
					</template>
					<template v-for="(user, index) of userList" :key="user.name">
						<p @click="directMessage(index)" v-if="user.name !== username && user.status==='online'" class="clickable online">
							{{user.name}} - {{user.room}}
						</p>
					</template>
					<template v-for="(user, index) of userList" :key="user.name">
						<p @click="directMessage(index)" v-if="user.status==='reconnecting'" class="clickable reconnecting">
							{{user.name}} - (reconnecting)
						</p>
					</template>
					<br>
					<div class="offline-toggle clickable" @click="showOffline =!showOffline" > 
						{{showOffline?'Hide':'Show'}} offline({{ offlineCount }})
					</div>
					<template v-for="(user, index) of userList" :key="user.name">
						<p @click="directMessage(index)" v-if="user.status === 'offline' && showOffline" class="clickable offline">
							{{user.name}} - (offline)
						</p>
					</template>
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
			</div>

		<div v-if="!username" id="offline" class="overlay" style="position: absolute; inset: 0;">
			<p>Enter a username</p>
			<input v-model="requestedUsername" type="text">
			<p>Enter a lobby name to join or create new one</p>
			<input v-model="requestedLobbyName" type="text"></input>
			<br></br>
			<button @click="joinLobby">Submit</button>
		</div>
	</div>
</template>



