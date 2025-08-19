import { io } from "socket.io-client";

console.log("📞 Тест звонка для номера 777");
console.log("🎯 Логика: звонок → принятие → активный звонок (5с) → завершение");

const socket = io("http://localhost:3771");

let callId777 = null;
let currentUserId = null; // Добавляем переменную для хранения ID пользователя
// let callId888 = null; // Закомментировано - тест только для 777

socket.on("connect", async () => {
  console.log("✅ Подключение к серверу установлено");

  try {
    const { pool } = await import("./shared-functions.js");

    // Получаем информацию о пользователе с номером 777 (Иван)
    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, up.phone_number 
       FROM users u 
       JOIN user_phones up ON u.id = up.user_id 
       WHERE up.phone_number = $1`,
      ["777"]
    );

    if (result.rows.length > 0) {
      const userId = result.rows[0].id;
      currentUserId = userId; // Сохраняем ID пользователя
      const user = result.rows[0];
      console.log(
        `👤 Аутентификация как: ${user.first_name} ${user.last_name} (ID: ${userId})`
      );
      console.log(`📞 Номер: ${user.phone_number}`);

      // Аутентификация
      socket.emit("authenticate", { userId });
    } else {
      console.error("❌ Пользователь с номером 777 не найден!");
      console.log("💡 Запустите: node server/setup-database.js");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Ошибка:", error.message);
    process.exit(1);
  }
});

socket.on("authenticated", (data) => {
  console.log("✅ Аутентификация успешна");

  // Начинаем тест через 2 секунды
  setTimeout(() => {
    console.log("\n🎯 НАЧИНАЕМ ТЕСТ ЗВОНКОВ");
    console.log("=" * 50);

    // ТЕСТ: Звонок на номер 777
    console.log("\n📞 ТЕСТ: Звонок на номер 777");
    const testCall777 = {
      caller_number: "+7 (495) 123-45-67",
      receiver_number: "777",
      timestamp: new Date().toISOString(),
      status: "incoming",
      assigned_user_id: currentUserId, // Используем ID аутентифицированного пользователя
      caller_company_name: "ООО Тестовая Компания",
    };

    socket.emit("incoming-call", testCall777);

    // Отправляем звонок и ждем его ID перед принятием
    console.log("\n📞 Ожидаем ID звонка для принятия...");

    // Функция для принятия звонка после получения ID
    const acceptCallAfterId = () => {
      if (callId777) {
        console.log("\n📞 Принимаем звонок 777 (ID:", callId777, ")");
        socket.emit("answer-call", {
          callId: callId777,
          action: "accept",
          initialData: {
            notes: "Тестовые заметки при принятии",
            customerName: "Тестовый клиент",
            company: "ООО Тестовая Компания",
          },
        });
      } else {
        console.log("⏳ Ожидаем ID звонка для принятия...");
        setTimeout(acceptCallAfterId, 500); // Проверяем каждые 500мс
      }
    };

    // Начинаем ожидание ID звонка через 1 секунду
    setTimeout(acceptCallAfterId, 3000);

    // Ждем получения ID звонка и затем завершаем его
    const waitForCallIdAndEnd = () => {
      if (callId777) {
        console.log("\n⏱️ Активный звонок длится 5 секунд...");

        // Через 5 секунд завершаем звонок
        setTimeout(() => {
          console.log("\n📞 Завершаем звонок 777 (ID:", callId777, ")");
          socket.emit("end-call", {
            callId: callId777,
            callData: {
              duration: 5, // 5 секунд длительность
              notes: "Тестовые заметки",
              endTime: new Date().toISOString(),
            },
          });

          // Завершаем тест
          setTimeout(() => {
            console.log("\n🏁 ТЕСТ ЗАВЕРШЕН");
            console.log("✅ Звонок 777 обработан");
            socket.disconnect();
            process.exit(0);
          }, 2000);
        }, 5000); // 5 секунд активного звонка
      } else {
        console.log("⏳ Ожидаем ID звонка для завершения...");
        setTimeout(waitForCallIdAndEnd, 500); // Проверяем каждые 500мс
      }
    };

    // Начинаем ожидание ID звонка через 2 секунды
    setTimeout(waitForCallIdAndEnd, 2000);
  }, 2000);
});

socket.on("incoming-call", (call) => {
  console.log("\n📞 ПОЛУЧЕНО УВЕДОМЛЕНИЕ О ЗВОНКЕ!");
  console.log("📋 Данные звонка:", {
    id: call.id,
    caller: call.caller_number,
    receiver: call.receiver_number,
    assigned_user_id: call.assigned_user_id,
    company: call.caller_company_name,
  });

  // Сохраняем ID звонка для номера 777
  if (call.receiver_number === "777") {
    callId777 = call.id;
    console.log("💾 Сохранен ID звонка 777:", callId777);
    console.log("✅ Готов к принятию звонка!");
  }
  // else if (call.receiver_number === "888") {
  //   callId888 = call.id;
  //   console.log("💾 Сохранен ID звонка 888:", callId888);
  // }

  // Добавляем дополнительную отладочную информацию
  console.log("🔍 Текущий ID звонка:");
  console.log("  - callId777:", callId777);
  console.log("  - currentUserId:", currentUserId);
  console.log("  - call.assigned_user_id:", call.assigned_user_id);
  // console.log("  - callId888:", callId888); // Закомментировано
});

socket.on("call-answered", (data) => {
  console.log("✅ Звонок принят:", data);
  // Сохраняем ID звонка из события call-answered
  if (data.callId) {
    callId777 = data.callId;
    console.log("💾 Сохранен ID звонка из call-answered:", callId777);
  }
});

socket.on("call-ended", (data) => {
  console.log("✅ Звонок завершен:", data);
  console.log("🔍 Проверяем ID завершенного звонка:", data.callId);
  console.log("🔍 Сравниваем с сохраненным ID:");
  console.log("  - callId777:", callId777);
  console.log("🔍 Данные завершения:");
  console.log("  - endedAt:", data.endedAt);
  console.log("  - duration:", data.duration);
  console.log("  - userId:", data.userId);
  // console.log("  - callId888:", callId888); // Закомментировано
});

socket.on("connect_error", (error) => {
  console.error("❌ Ошибка подключения:", error.message);
  console.log("💡 Убедитесь, что сервер запущен: npm run servers");
  process.exit(1);
});

socket.on("error", (error) => {
  console.error("❌ Ошибка:", error);
});

// Таймаут
setTimeout(() => {
  console.log("\n⏰ Таймаут теста");
  socket.disconnect();
  process.exit(1);
}, 60000); // 60 секунд таймаут
