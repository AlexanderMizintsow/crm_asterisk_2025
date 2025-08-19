import { Pool } from "pg";

// Подключение к базе данных TestA
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "testA",
  password: "postgres",
  port: 5432,
});

// Логирование
const log = {
  info: (message, data = {}) => {
    console.log(`🔵 [INFO] ${message}`, Object.keys(data).length ? data : "");
  },
  error: (message, error = null) => {
    console.error(`🔴 [ОШИБКА] ${message}`, error ? error.message : "");
  },
  success: (message, data = {}) => {
    console.log(`🟢 [УСПЕХ] ${message}`, Object.keys(data).length ? data : "");
  },
  warning: (message, data = {}) => {
    console.warn(
      `🟡 [ПРЕДУПРЕЖДЕНИЕ] ${message}`,
      Object.keys(data).length ? data : ""
    );
  },
};

// Безопасное выполнение запроса к БД
const safeQuery = async (query, params = [], operation = "операция") => {
  try {
    const result = await pool.query(query, params);
    log.success(`${operation} выполнена успешно`, {
      rowCount: result.rowCount,
    });
    return result;
  } catch (error) {
    log.error(`Ошибка при выполнении ${operation}`, error);
    throw error;
  }
};

// Получение пользователя по номеру телефона
const getUserByPhone = async (phoneNumber) => {
  if (!phoneNumber) {
    log.warning("Попытка поиска пользователя без номера телефона");
    return null;
  }

  try {
    const result = await safeQuery(
      `SELECT u.id, u.first_name, u.last_name, up.phone_number 
       FROM users u 
       JOIN user_phones up ON u.id = up.user_id 
       WHERE up.phone_number = $1`,
      [phoneNumber],
      `поиск пользователя по номеру ${phoneNumber}`
    );

    if (result.rows.length > 0) {
      log.success(`Найден пользователь для номера ${phoneNumber}`, {
        userId: result.rows[0].id,
        name: `${result.rows[0].first_name} ${result.rows[0].last_name}`,
      });
      return result.rows[0];
    }

    log.warning(`Пользователь не найден для номера ${phoneNumber}`);
    return null;
  } catch (error) {
    log.error(`Ошибка поиска пользователя по номеру ${phoneNumber}`, error);
    return null;
  }
};

// Получение компании по номеру телефона
const getCompanyByPhone = async (phoneNumber) => {
  if (!phoneNumber) return null;

  try {
    const result = await safeQuery(
      `SELECT c.id, c.name_companies, pnc.phone_number 
       FROM companies c 
       JOIN phone_numbers_companies pnc ON c.id = pnc.company_id 
       WHERE pnc.phone_number = $1`,
      [phoneNumber],
      `поиск компании по номеру ${phoneNumber}`
    );

    if (result.rows.length > 0) {
      log.success(`Найдена компания для номера ${phoneNumber}`, {
        companyId: result.rows[0].id,
        name: result.rows[0].name_companies,
      });
      return result.rows[0];
    }

    return null;
  } catch (error) {
    log.error(`Ошибка поиска компании по номеру ${phoneNumber}`, error);
    return null;
  }
};

export { pool, log, safeQuery, getUserByPhone, getCompanyByPhone };
