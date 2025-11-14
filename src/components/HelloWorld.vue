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
      chatHistory: []
    };
  },
  methods: {
    sendText() {
			socket.emit("sendChat", "this is a test message sent from a vue page");
			// this.inputText = "";
		},
    joinRoom() {
      socket.emit("joinRoom", "myTestRoom" + Math.round(Math.random()), (success, message) => {
        console.log(message);
      });
    }
  },
	mounted() {
		socket.on("messageSent", (chatMessage) => {
			this.chatHistory.push(chatMessage);
		});
		// socket.on("updateUserList", (userList) => {
		// 	this.userList = userList;
		// });
	}
}
</script>

<template>

  <div v-for="chat in chatHistory">{{ chat }}</div>
  <button @click="sendText">test</button>
  <button @click="joinRoom">join "myTestRoom"</button>

  <!-- <h1>{{ msg }}</h1> -->
</template>
