import { io } from "socket.io-client";

console.log("🧪 Тест правильного получения звонка");
console.log("🎯 Проверяем: звонок на 777 ДОЛЖЕН приходить Ивану (номер 777)");

const socket = io("http://localhost:3771");
let userId = 14; // Иван (номер 777)
let notifications = 0;

socket.on("connect", () => {
  console.log("✅ Подключение установлено");
  socket.emit("authenticate", { userId });
});

socket.on("authenticated", () => {
  console.log("✅ Аутентификация успешна");
  console.log("👤 Пользователь: Иван (ID: 14, номер: 777)");

  setTimeout(() => {
    console.log("\n📞 Отправляем звонок на номер 777 (должен получить Иван)");
    console.log("📋 Данные звонка:", {
      caller_number: "+7 (495) 123-45-67",
      receiver_number: "777",
      assigned_user_id: 14, // Иван
    });

    const testCall = {
      caller_number: "+7 (495) 123-45-67",
      receiver_number: "777",
      timestamp: new Date().toISOString(),
      status: "incoming",
      caller_company_name: "ООО Тестовая Компания",
    };

    socket.emit("incoming-call", testCall);
    console.log("📤 Звонок отправлен на сервер");

    // Проверяем результат через 5 секунд
    setTimeout(() => {
      console.log(`\n🔍 РЕЗУЛЬТАТ: получено ${notifications} уведомлений`);

      if (notifications === 1) {
        console.log("✅ ТЕСТ ПРОШЕЛ! Иван получил уведомление о звонке на 777");
        console.log("✅ Правильная маршрутизация звонков работает");
        process.exit(0);
      } else {
        console.log(
          `❌ ТЕСТ НЕ ПРОШЕЛ! Иван получил ${notifications} уведомлений о звонке на 777`
        );
        console.log("❌ Проблема с маршрутизацией звонков");
        process.exit(1);
      }
    }, 5000);
  }, 1000);
});

socket.on("incoming-call", (call) => {
  notifications++;
  console.log(`📞 Получено уведомление #${notifications}:`, {
    id: call.id,
    caller: call.caller_number,
    receiver: call.receiver_number,
    assigned_user_id: call.assigned_user_id,
  });
});

socket.on("connect_error", (error) => {
  console.error("❌ Ошибка подключения:", error.message);
  process.exit(1);
});

socket.on("error", (error) => {
  console.error("❌ Ошибка сокета:", error);
});

socket.on("disconnect", (reason) => {
  console.log("🔌 Отключение:", reason);
});

// Таймаут
setTimeout(() => {
  console.log("\n⏰ Таймаут теста");
  process.exit(1);
}, 10000);
