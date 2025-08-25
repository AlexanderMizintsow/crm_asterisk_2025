import { pool, safeQuery, log } from "./shared-functions.js";

const createUser109 = async () => {
  try {
    console.log("🔍 Проверка пользователя с номером 109...");

    // Проверяем, есть ли уже пользователь с номером 109
    const existingUser = await safeQuery(
      `SELECT u.*, up.phone_number 
       FROM users u 
       JOIN user_phones up ON u.id = up.user_id 
       WHERE up.phone_number = '109'`,
      [],
      "проверка существующего пользователя 109"
    );

    if (existingUser.rows.length > 0) {
      console.log("✅ Пользователь с номером 109 уже существует:");
      console.log(JSON.stringify(existingUser.rows[0], null, 2));
      return existingUser.rows[0];
    }

    console.log("🔄 Создание нового пользователя...");

    // Создаем нового пользователя
    const newUser = await safeQuery(
      `INSERT INTO users (
        first_name, 
        last_name, 
        username, 
        email, 
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        "Ирина",
        "Алигаджиева",
        "aligadzhieva_irina",
        "irina.aligadzhieva@example.com",
        "active",
        new Date().toISOString(),
      ],
      "создание пользователя Алигаджиева Ирина"
    );

    const userId = newUser.rows[0].id;
    console.log("✅ Создан пользователь с ID:", userId);

    // Добавляем номер телефона
    await safeQuery(
      `INSERT INTO user_phones (
        user_id, 
        phone_number, 
        phone_type, 
        is_primary
      ) VALUES ($1, $2, $3, $4)`,
      [userId, "109", "extension", true],
      "добавление номера 109 пользователю"
    );

    console.log("✅ Номер 109 добавлен пользователю");

    // Получаем полную информацию о созданном пользователе
    const userInfo = await safeQuery(
      `SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.username,
        u.email,
        u.status,
        up.phone_number,
        up.phone_type,
        up.is_primary
       FROM users u 
       JOIN user_phones up ON u.id = up.user_id 
       WHERE up.phone_number = '109'`,
      [],
      "получение информации о созданном пользователе"
    );

    console.log("✅ Пользователь успешно создан:");
    console.log(JSON.stringify(userInfo.rows[0], null, 2));

    return userInfo.rows[0];
  } catch (error) {
    console.error("❌ Ошибка при создании пользователя:", error.message);
    throw error;
  } finally {
    await pool.end();
  }
};

// Показываем всех пользователей
const showAllUsers = async () => {
  try {
    console.log("\n📋 Все пользователи в системе:");

    const result = await safeQuery(
      `SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.status,
        up.phone_number,
        up.phone_type,
        up.is_primary
       FROM users u 
       JOIN user_phones up ON u.id = up.user_id 
       WHERE up.phone_type IN ('extension', 'work')
       ORDER BY up.phone_number`,
      [],
      "получение всех пользователей"
    );

    result.rows.forEach((row, index) => {
      console.log(
        `${index + 1}. ${row.phone_number} - ${row.first_name} ${
          row.last_name
        } (${row.status})`
      );
    });

    return result.rows;
  } catch (error) {
    console.error("❌ Ошибка при получении пользователей:", error.message);
    return [];
  }
};

// Основная функция
const main = async () => {
  try {
    console.log(
      "=== Создание пользователя Алигаджиева Ирина (номер 109) ===\n"
    );

    // Создаем пользователя
    const newUser = await createUser109();

    // Показываем всех пользователей
    await showAllUsers();

    console.log("\n✅ Операция завершена успешно!");
  } catch (error) {
    console.error("❌ Ошибка в основной функции:", error.message);
  }
};

// Запуск скрипта
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { createUser109, showAllUsers };
