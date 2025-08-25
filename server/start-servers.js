import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🚀 Запуск серверов...");

// Запуск WebSocket сервера
const websocketServer = spawn("node", ["websocket-server.js"], {
  cwd: __dirname,
  stdio: "inherit",
});

console.log("✅ WebSocket сервер запущен на порту 3771");

// Запуск Asterisk сервера
const asteriskServer = spawn("node", ["asterisk-server.js"], {
  cwd: __dirname,
  stdio: "inherit",
});

console.log("✅ Asterisk сервер запущен");

// Запуск API сервера
const apiServer = spawn("node", ["api-server.js"], {
  cwd: __dirname,
  stdio: "inherit",
});

console.log("✅ API сервер запущен на порту 3001");

// Обработка завершения процессов
process.on("SIGINT", () => {
  console.log("\n🛑 Завершение работы серверов...");
  websocketServer.kill("SIGINT");
  asteriskServer.kill("SIGINT");
  apiServer.kill("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Завершение работы серверов...");
  websocketServer.kill("SIGTERM");
  asteriskServer.kill("SIGTERM");
  apiServer.kill("SIGTERM");
  process.exit(0);
});

// Обработка ошибок
websocketServer.on("error", (error) => {
  console.error("❌ Ошибка WebSocket сервера:", error);
});

asteriskServer.on("error", (error) => {
  console.error("❌ Ошибка Asterisk сервера:", error);
});

apiServer.on("error", (error) => {
  console.error("❌ Ошибка API сервера:", error);
});

console.log("📋 Для остановки серверов нажмите Ctrl+C");
