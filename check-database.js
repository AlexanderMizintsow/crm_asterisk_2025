import { pool, safeQuery } from "./server/shared-functions.js";

console.log("🔍 Проверка данных в базе данных");

try {
  // Проверяем пользователей
  console.log("\n👥 Пользователи:");
  const usersResult = await safeQuery(
    "SELECT id, first_name, last_name FROM users ORDER BY id",
    [],
    "получение списка пользователей"
  );

  usersResult.rows.forEach((user) => {
    console.log(`  ID: ${user.id}, Имя: ${user.first_name} ${user.last_name}`);
  });

  // Проверяем номера телефонов пользователей
  console.log("\n📞 Номера телефонов пользователей:");
  const phonesResult = await safeQuery(
    `SELECT up.user_id, up.phone_number, u.first_name, u.last_name 
     FROM user_phones up 
     JOIN users u ON up.user_id = u.id 
     ORDER BY up.user_id`,
    [],
    "получение номеров телефонов пользователей"
  );

  phonesResult.rows.forEach((phone) => {
    console.log(
      `  Пользователь: ${phone.first_name} ${phone.last_name} (ID: ${phone.user_id}) → Номер: ${phone.phone_number}`
    );
  });

  // Проверяем функцию getUserByPhone для номера 777
  console.log("\n🔍 Тест функции getUserByPhone для номера '777':");
  const testResult = await safeQuery(
    `SELECT u.id, u.first_name, u.last_name, up.phone_number 
     FROM users u 
     JOIN user_phones up ON u.id = up.user_id 
     WHERE up.phone_number = $1`,
    ["777"],
    "тест поиска пользователя по номеру 777"
  );

  if (testResult.rows.length > 0) {
    const user = testResult.rows[0];
    console.log(
      `  ✅ Найден: ${user.first_name} ${user.last_name} (ID: ${user.id})`
    );
  } else {
    console.log("  ❌ Пользователь с номером '777' не найден");
  }

  // Проверяем функцию getUserByPhone для номера 888
  console.log("\n🔍 Тест функции getUserByPhone для номера '888':");
  const testResult2 = await safeQuery(
    `SELECT u.id, u.first_name, u.last_name, up.phone_number 
     FROM users u 
     JOIN user_phones up ON u.id = up.user_id 
     WHERE up.phone_number = $1`,
    ["888"],
    "тест поиска пользователя по номеру 888"
  );

  if (testResult2.rows.length > 0) {
    const user = testResult2.rows[0];
    console.log(
      `  ✅ Найден: ${user.first_name} ${user.last_name} (ID: ${user.id})`
    );
  } else {
    console.log("  ❌ Пользователь с номером '888' не найден");
  }
} catch (error) {
  console.error("❌ Ошибка при проверке базы данных:", error);
} finally {
  await pool.end();
  console.log("\n✅ Проверка завершена");
}
