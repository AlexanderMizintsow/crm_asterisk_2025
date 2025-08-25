import { pool, log, safeQuery } from "./shared-functions.js";

console.log("🔧 Настройка базы данных для тестирования...");

const setupDatabase = async () => {
  try {
    // 1. Создаем пользователя Ирину Алигаджиеву (ID 17)
    log.info("Создание пользователя Ирина Алигаджиева...");

    const userResult = await safeQuery(
      `INSERT INTO users (id, first_name, last_name, username, password, email, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (id) DO UPDATE SET 
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         username = EXCLUDED.username,
         email = EXCLUDED.email,
         status = EXCLUDED.status
       RETURNING id`,
      [
        17,
        "Ирина",
        "Алигаджиева",
        "aligadzhieva",
        "password123",
        "aligadzhieva@test.com",
        "active",
      ],
      "создание пользователя Ирина Алигаджиева"
    );

    let userId = 17;
    log.success("Пользователь Ирина Алигаджиева создан/обновлен", { userId });

    // 2. Привязываем номер 777 к Ирине
    log.info("Привязка номера 777 к пользователю...");

    // Сначала удаляем старую привязку номера 777
    await safeQuery(
      `DELETE FROM user_phones WHERE phone_number = $1`,
      ["777"],
      "удаление старой привязки номера 777"
    );

    // Создаем новую привязку
    await safeQuery(
      `INSERT INTO user_phones (user_id, phone_number, phone_type) 
       VALUES ($1, $2, $3)`,
      [userId, "777", "extension"],
      "привязка номера 777 к Ирине"
    );

    log.success("Номер 777 привязан к Ирине", { userId, phoneNumber: "777" });

    // 2.1. Создаем второго пользователя (Петр Петров)
    log.info("Создание второго пользователя (Петр Петров)...");

    const user2Result = await safeQuery(
      `INSERT INTO users (first_name, last_name, username, password, email, status) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       ON CONFLICT DO NOTHING 
       RETURNING id`,
      ["Петр", "Петров", "petrov", "password123", "petrov@test.com", "active"],
      "создание второго пользователя"
    );

    let userId2;
    if (user2Result.rows.length > 0) {
      userId2 = user2Result.rows[0].id;
      log.success("Второй пользователь создан", { userId2 });
    } else {
      const existingUser2 = await safeQuery(
        "SELECT id FROM users WHERE username = 'petrov'",
        [],
        "поиск существующего второго пользователя"
      );
      userId2 = existingUser2.rows[0].id;
      log.info("Второй пользователь уже существует", { userId2 });
    }

    // 2.2. Привязываем номер 888 к Петрову
    log.info("Привязка номера 888 к Петрову...");

    // Сначала удаляем старую привязку номера 888
    await safeQuery(
      `DELETE FROM user_phones WHERE phone_number = $1`,
      ["888"],
      "удаление старой привязки номера 888"
    );

    // Создаем новую привязку
    await safeQuery(
      `INSERT INTO user_phones (user_id, phone_number, phone_type) 
       VALUES ($1, $2, $3)`,
      [userId2, "888", "extension"],
      "привязка номера 888 к Петрову"
    );

    log.success("Номер 888 привязан к Петрову", {
      userId2,
      phoneNumber: "888",
    });

    // 3. Создаем тестовую компанию
    log.info("Создание тестовой компании...");

    const companyResult = await safeQuery(
      `INSERT INTO companies (name_companies) 
       VALUES ($1) 
       ON CONFLICT DO NOTHING 
       RETURNING id`,
      ["ООО Тестовая Компания"],
      "создание тестовой компании"
    );

    let companyId;
    if (companyResult.rows.length > 0) {
      companyId = companyResult.rows[0].id;
      log.success("Компания создана", { companyId });
    } else {
      const existingCompany = await safeQuery(
        "SELECT id FROM companies WHERE name_companies = $1",
        ["ООО Тестовая Компания"],
        "поиск существующей компании"
      );
      companyId = existingCompany.rows[0].id;
      log.info("Компания уже существует", { companyId });
    }

    // 4. Привязываем номер звонящего к компании
    log.info("Привязка номера звонящего к компании...");

    // Сначала удаляем старую привязку
    await safeQuery(
      `DELETE FROM phone_numbers_companies WHERE phone_number = $1`,
      ["+7 (495) 123-45-67"],
      "удаление старой привязки номера компании"
    );

    // Создаем новую привязку
    await safeQuery(
      `INSERT INTO phone_numbers_companies (company_id, phone_number, phone_type) 
       VALUES ($1, $2, $3)`,
      [companyId, "+7 (495) 123-45-67", "main"],
      "привязка номера к компании"
    );

    log.success("Номер звонящего привязан к компании", {
      companyId,
      phoneNumber: "+7 (495) 123-45-67",
    });

    // 5. Проверяем результат
    log.info("Проверка настроенных данных...");

    const checkUsers = await safeQuery(
      `SELECT u.id, u.first_name, u.last_name, up.phone_number 
       FROM users u 
       JOIN user_phones up ON u.id = up.user_id 
       WHERE up.phone_number IN ($1, $2)
       ORDER BY up.phone_number`,
      ["777", "888"],
      "проверка пользователей с номерами 777 и 888"
    );

    if (checkUsers.rows.length >= 2) {
      const user1 = checkUsers.rows.find((u) => u.phone_number === "777");
      const user2 = checkUsers.rows.find((u) => u.phone_number === "888");

      log.success("✅ База данных настроена успешно!", {
        user1: {
          id: user1.id,
          name: `${user1.first_name} ${user1.last_name}`,
          phone: user1.phone_number,
        },
        user2: {
          id: user2.id,
          name: `${user2.first_name} ${user2.last_name}`,
          phone: user2.phone_number,
        },
        companyId,
        companyName: "ООО Тестовая Компания",
      });

      console.log("\n📋 Готово к тестированию:");
      console.log(
        `👤 Пользователь 1: ${user1.first_name} ${user1.last_name} (ID: ${user1.id}) - номер ${user1.phone_number}`
      );
      console.log(
        `👤 Пользователь 2: ${user2.first_name} ${user2.last_name} (ID: ${user2.id}) - номер ${user2.phone_number}`
      );
      console.log(`🏢 Компания: ООО Тестовая Компания`);
      console.log(`📞 Тестовый номер звонящего: +7 (495) 123-45-67`);
      console.log("\n🚀 Для тестирования запустите:");
      console.log("1. npm run servers");
      console.log("2. npm run dev");
      console.log("3. Откройте: http://localhost:5173");
      console.log(
        "\n📝 Примечание: В App.jsx используется CURRENT_USER_ID = 17 (Ирина Алигаджиева)"
      );
    } else {
      log.error("❌ Ошибка: не все пользователи найдены");
    }
  } catch (error) {
    log.error("Ошибка при настройке базы данных", error);
  } finally {
    await pool.end();
  }
};

setupDatabase();
