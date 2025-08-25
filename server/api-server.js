import express from "express";
import cors from "cors";
import { pool, safeQuery, log } from "./shared-functions.js";

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Логирование для API
const apiLog = {
  info: (message, data = {}) => {
    log.info(`[API] ${message}`, data);
  },
  error: (message, error = null) => {
    log.error(`[API] ${message}`, error);
  },
  success: (message, data = {}) => {
    log.success(`[API] ${message}`, data);
  },
};

// Middleware для логирования запросов
app.use((req, res, next) => {
  apiLog.info(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.body,
    ip: req.ip,
  });
  next();
});

// Получить данные пользователя по ID
app.get("/api/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await safeQuery(
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
       LEFT JOIN user_phones up ON u.id = up.user_id AND up.is_primary = true
       WHERE u.id = $1`,
      [userId],
      "получение данных пользователя"
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Пользователь не найден",
      });
    }

    const userData = result.rows[0];
    apiLog.success("Данные пользователя получены", { userId, userData });
    res.json({ success: true, data: userData });
  } catch (error) {
    apiLog.error("Ошибка при получении данных пользователя", error);
    res.status(500).json({
      success: false,
      error: "Ошибка при получении данных пользователя",
    });
  }
});

// Получить все доступные внутренние номера
app.get("/api/internal-numbers", async (req, res) => {
  try {
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
      "получение внутренних номеров"
    );

    apiLog.success("Получены внутренние номера", { count: result.rows.length });
    res.json({ success: true, data: result.rows });
  } catch (error) {
    apiLog.error("Ошибка при получении внутренних номеров", error);
    res
      .status(500)
      .json({
        success: false,
        error: "Ошибка при получении внутренних номеров",
      });
  }
});

// Инициация исходящего звонка
app.post("/api/calls/outgoing", async (req, res) => {
  try {
    const { fromNumber, toNumber, userId } = req.body;
    if (!fromNumber || !toNumber) {
      return res
        .status(400)
        .json({
          success: false,
          error: "Необходимо указать номер отправителя и получателя",
        });
    }

    // Создаем запись звонка в базе данных
    const result = await safeQuery(
      `INSERT INTO calls (
        caller_number, 
        receiver_number, 
        status, 
        assigned_user_id,
        created_at
      ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [fromNumber, toNumber, "outgoing", userId, new Date().toISOString()],
      "создание исходящего звонка"
    );

    const callId = result.rows[0].id;

    apiLog.success("Исходящий звонок создан", {
      callId,
      from: fromNumber,
      to: toNumber,
    });
    res.json({
      success: true,
      callId,
      message: "Звонок инициирован",
    });
  } catch (error) {
    apiLog.error("Ошибка при инициации звонка", error);
    res
      .status(500)
      .json({ success: false, error: "Внутренняя ошибка сервера" });
  }
});

// Получить статус звонка
app.get("/api/calls/:callId/status", async (req, res) => {
  try {
    const { callId } = req.params;
    const result = await safeQuery(
      `SELECT * FROM calls WHERE id = $1`,
      [callId],
      "получение статуса звонка"
    );

    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.status(404).json({ success: false, error: "Звонок не найден" });
    }
  } catch (error) {
    apiLog.error("Ошибка при получении статуса звонка", error);
    res
      .status(500)
      .json({ success: false, error: "Внутренняя ошибка сервера" });
  }
});

// Получить историю звонков
app.get("/api/calls", async (req, res) => {
  try {
    const { userId } = req.query;
    let query = `
      SELECT 
        c.*,
        u.first_name,
        u.last_name
      FROM calls c
      LEFT JOIN users u ON c.assigned_user_id = u.id
      ORDER BY c.created_at DESC
      LIMIT 100
    `;
    let params = [];

    if (userId) {
      query = `
        SELECT 
          c.*,
          u.first_name,
          u.last_name
        FROM calls c
        LEFT JOIN users u ON c.assigned_user_id = u.id
        WHERE c.assigned_user_id = $1
        ORDER BY c.created_at DESC
        LIMIT 100
      `;
      params = [userId];
    }

    const result = await safeQuery(query, params, "получение истории звонков");
    res.json({ success: true, data: result.rows });
  } catch (error) {
    apiLog.error("Ошибка при получении истории звонков", error);
    res
      .status(500)
      .json({ success: false, error: "Ошибка при получении истории звонков" });
  }
});

// Получить активные звонки
app.get("/api/calls/active", async (req, res) => {
  try {
    const result = await safeQuery(
      `SELECT 
        c.*,
        u.first_name,
        u.last_name
       FROM calls c
       LEFT JOIN users u ON c.assigned_user_id = u.id
       WHERE c.status IN ('incoming', 'accepted', 'active')
       ORDER BY c.created_at DESC`,
      [],
      "получение активных звонков"
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    apiLog.error("Ошибка при получении активных звонков", error);
    res
      .status(500)
      .json({ success: false, error: "Ошибка при получении активных звонков" });
  }
});

// Получить статистику звонков
app.get("/api/statistics", async (req, res) => {
  try {
    const { userId } = req.query;
    let query = `
      SELECT 
        COUNT(*) as total_calls,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_calls,
        COUNT(CASE WHEN status = 'missed' THEN 1 END) as missed_calls,
        AVG(CASE WHEN duration > 0 THEN duration END) as avg_duration
      FROM calls
    `;
    let params = [];

    if (userId) {
      query += ` WHERE assigned_user_id = $1`;
      params = [userId];
    }

    const result = await safeQuery(
      query,
      params,
      "получение статистики звонков"
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    apiLog.error("Ошибка при получении статистики", error);
    res
      .status(500)
      .json({ success: false, error: "Ошибка при получении статистики" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API сервер работает",
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  apiLog.error("Необработанная ошибка", error);
  res.status(500).json({
    success: false,
    error: "Внутренняя ошибка сервера",
    message: error.message,
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint не найден",
    path: req.originalUrl,
  });
});

// Start server
app.listen(PORT, () => {
  apiLog.success(`API сервер запущен на порту ${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  apiLog.info("Получен сигнал SIGINT, завершение работы API сервера");
  process.exit(0);
});

process.on("SIGTERM", () => {
  apiLog.info("Получен сигнал SIGTERM, завершение работы API сервера");
  process.exit(0);
});
