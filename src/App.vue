<script setup>
import HelloWorld from './components/HelloWorld.vue'
import GameView from './components/GameView.vue'
</script>

<template>
  <!-- <HelloWorld msg="Vite + Vue" /> -->
  <!-- <h1>asdf asdf asd fasdf</h1> -->
  <GameView />
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
