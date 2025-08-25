import { pool, safeQuery, log } from "./shared-functions.js";

const checkAndCreateUser109 = async () => {
  try {
    console.log("🔍 Проверка пользователя с номером 109...");

    // Проверяем, есть ли пользователь с номером 109
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
       WHERE up.phone_number = '109'`,
      [],
      "проверка пользователя 109"
    );

    if (result.rows.length > 0) {
      console.log("✅ Пользователь с номером 109 найден:");
      console.log(JSON.stringify(result.rows[0], null, 2));
    } else {
      console.log("❌ Пользователь с номером 109 не найден");

      // Создаем пользователя
      console.log("🔄 Создание пользователя Алигаджиева Ирина...");

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
        "добавление номера 109"
      );

      console.log("✅ Номер 109 добавлен пользователю");
    }

    // Показываем всех пользователей
    console.log("\n📞 Все внутренние номера:");
    const allNumbers = await safeQuery(
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
      "получение всех номеров"
    );

    allNumbers.rows.forEach((row, index) => {
      console.log(
        `${index + 1}. ${row.phone_number} - ${row.first_name} ${
          row.last_name
        } (${row.status})`
      );
    });
  } catch (error) {
    console.error("❌ Ошибка:", error.message);
  } finally {
    await pool.end();
  }
};

checkAndCreateUser109();
