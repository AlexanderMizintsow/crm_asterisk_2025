import { io } from "socket.io-client";

console.log("🧪 Тест изоляции пользователей");
console.log(
  "🎯 Проверяем: звонок на 888 НЕ должен приходить пользователю с номером 777"
);

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
    console.log(
      "\n📞 Отправляем звонок на номер 888 (должен получить только Петр)"
    );
    console.log("📋 Данные звонка:", {
      caller_number: "+7 (812) 555-12-34",
      receiver_number: "888",
      assigned_user_id: 15, // Петр
    });

    const testCall = {
      caller_number: "+7 (812) 555-12-34",
      receiver_number: "888",
      timestamp: new Date().toISOString(),
      status: "incoming",
      assigned_user_id: 15, // Петр (номер 888)
      caller_company_name: "ООО Тестовая Компания",
    };

    socket.emit("incoming-call", testCall);
    console.log("📤 Звонок отправлен на сервер");

    // Проверяем результат через 5 секунд
    setTimeout(() => {
      console.log(`\n🔍 РЕЗУЛЬТАТ: получено ${notifications} уведомлений`);

      if (notifications === 0) {
        console.log(
          "✅ ТЕСТ ПРОШЕЛ! Иван НЕ получил уведомление о звонке на 888"
        );
        console.log("✅ Изоляция пользователей работает корректно");
        process.exit(0);
      } else {
        console.log(
          `❌ ТЕСТ НЕ ПРОШЕЛ! Иван получил ${notifications} уведомлений о звонке на 888`
        );
        console.log("❌ Проблема с изоляцией пользователей");
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
