# 🏰 MULTI-DUNGEON MUD (Multi-User Dungeon) — CS365 Final Project

**MULTI-DUNGEON MUD**는 브라우저에서 플레이 가능한 **실시간 멀티플레이 텍스트 RPG(MUD)** 입니다.  
여러 사용자가 같은 로비에 접속해 텍스트 커맨드로 이동/상호작용/대화를 수행하며, 프로젝트의 핵심은 **동시 접속 환경에서의 상태 일관성**과 **MongoDB 기반 영속화**입니다.

- 기간: **2025.11 (프로젝트 개발)** / **2026.01 (리팩토링·고도화)**
- 구성: **Vue + Vite(Client)** / **Node.js + Express + Socket.io(Server)** / **MongoDB(Database)**


<br>

## 🎥 Demo
https://github.com/user-attachments/assets/72b89e8d-8aeb-4efd-abd3-b9cb3cf420a7

<br>

## 🚀 How to Run

### Setup
1) Clone this repository  
2) Install dependencies
```bash
npm install
```
3) Install nodemon (global)
```bash
npm install -g nodemon
```
4) Run MongoDB locally (mongodb://localhost:27017)

Windows example:
```bash
cd "C:\Program Files\MongoDB\Server\8.2\bin"
mongod --dbpath C:\stuff\mongodb\

```


### Run

1. Start the Socket.io server (port 8080)

```bash
nodemon server.cjs
```

2. Start the Vite dev server (in another terminal)

```bash
npm run dev
```
