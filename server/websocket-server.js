import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import {
  pool,
  log,
  safeQuery,
  getUserByPhone,
  getCompanyByPhone,
} from "./shared-functions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Хранение активных звонков и подключений
let activeCalls = new Map();
let connectedClients = new Map();
let userSockets = new Map();

// WebSocket соединения
io.on("connection", (socket) => {
  log.info("Новое подключение клиента", { socketId: socket.id });

  // Аутентификация пользователя
  socket.on("authenticate", async (data) => {
    const { userId } = data;

    if (!userId) {
      socket.emit("auth_error", { message: "ID пользователя не указан" });
      log.error("Попытка аутентификации без ID пользователя");
      return;
    }

    try {
      const userResult = await safeQuery(
        "SELECT u.*, up.phone_number FROM users u LEFT JOIN user_phones up ON u.id = up.user_id WHERE u.id = $1",
        [userId],
        `проверка пользователя ${userId}`
      );

      if (userResult.rows.length === 0) {
        socket.emit("auth_error", { message: "Пользователь не найден" });
        log.error(`Пользователь с ID ${userId} не найден`);
        return;
      }

      const user = userResult.rows[0];
      connectedClients.set(userId, socket);
      userSockets.set(socket.id, userId);

      socket.emit("authenticated", { userId });
      socket.emit("active-calls", Array.from(activeCalls.values()));

      log.success(`Пользователь аутентифицирован`, {
        userId,
        name: `${user.first_name} ${user.last_name}`,
        phone: user.phone_number,
      });
    } catch (error) {
      socket.emit("auth_error", { message: "Ошибка аутентификации" });
      log.error("Ошибка при аутентификации пользователя", error);
    }
  });

  // Обработка ответа на звонок (из интерфейса)
  socket.on("answer-call", async (data) => {
    const { callId, action, initialData } = data;
    const userId = userSockets.get(socket.id);

    if (!userId || !callId || !action) {
      log.error("Неполные данные для ответа на звонок", {
        userId,
        callId,
        action,
      });
      return;
    }

    try {
      const status = action === "accept" ? "accepted" : "rejected";
      const answeredAt = new Date().toISOString();

      await safeQuery(
        `UPDATE calls SET 
         status = $1, 
         answered_at = $2, 
         answered_by_user_id = $3,
         notes = $4
         WHERE id = $5`,
        [status, answeredAt, userId, initialData?.quickNotes || "", callId],
        `${action === "accept" ? "принятие" : "отклонение"} звонка ${callId}`
      );

      if (action === "accept") {
        // Если звонок принят, добавляем его в активные звонки
        if (!activeCalls.has(callId)) {
          // Получаем данные звонка из базы данных
          const callResult = await safeQuery(
            `SELECT * FROM calls WHERE id = $1`,
            [callId],
            `получение данных звонка ${callId}`
          );

          if (callResult.rows.length > 0) {
            const callData = callResult.rows[0];
            activeCalls.set(callId, {
              ...callData,
              status: status,
              answered_at: answeredAt,
              answered_by_user_id: userId,
            });
            log.info(`Звонок ${callId} добавлен в активные`);
          }
        } else {
          // Обновляем существующий активный звонок
          const call = activeCalls.get(callId);
          call.status = status;
          call.answered_at = answeredAt;
          call.answered_by_user_id = userId;
        }
      } else {
        // Если звонок отклонен, удаляем из активных
        if (activeCalls.has(callId)) {
          activeCalls.delete(callId);
          log.info(`Звонок ${callId} удален из активных (отклонен)`);
        }
      }

      io.emit("call-answered", { callId, action, initialData, userId });

      // Отправляем обновленный список активных звонков
      io.emit("active-calls", Array.from(activeCalls.values()));

      log.success(
        `Звонок ${callId} ${action === "accept" ? "принят" : "отклонен"}`,
        {
          userId,
          callId,
        }
      );
    } catch (error) {
      socket.emit("error", { message: "Не удалось ответить на звонок" });
      log.error(`Ошибка при ответе на звонок ${callId}`, error);
    }
  });

  // Завершение звонка
  socket.on("end-call", async (data) => {
    const { callId, callData } = data;
    const userId = userSockets.get(socket.id);

    if (!userId || !callId) {
      log.error("Неполные данные для завершения звонка", { userId, callId });
      return;
    }

    try {
      const endedAt = new Date().toISOString();

      await safeQuery(
        `UPDATE calls SET 
         status = 'completed',
         ended_at = $1,
         duration = $2,
         notes = $3
         WHERE id = $4`,
        [endedAt, callData?.duration || 0, callData?.notes || "", callId],
        `завершение звонка ${callId}`
      );

      activeCalls.delete(callId);

      // Отправляем уведомление о завершении звонка всем клиентам
      io.emit("call-ended", {
        callId,
        callData,
        userId,
        endedAt,
        duration: callData?.duration || 0,
      });

      // Также уведомляем всех клиентов об обновлении списка активных звонков
      io.emit("active-calls", Array.from(activeCalls.values()));

      log.success(`Звонок ${callId} завершен`, {
        duration: callData?.duration || 0,
        userId,
      });
    } catch (error) {
      socket.emit("error", { message: "Не удалось завершить звонок" });
      log.error(`Ошибка при завершении звонка ${callId}`, error);
    }
  });

  // Обновление заметок во время звонка
  socket.on("update-call-notes", async (data) => {
    const { callId, notes, customerData } = data;
    const userId = userSockets.get(socket.id);

    if (!userId || !callId) {
      log.error("Неполные данные для обновления заметок", { userId, callId });
      return;
    }

    try {
      await safeQuery(
        "UPDATE calls SET notes = $1 WHERE id = $2",
        [notes || "", callId],
        `обновление заметок звонка ${callId}`
      );

      io.emit("call-notes-updated", { callId, notes, customerData, userId });

      log.success(`Заметки звонка ${callId} обновлены`, { userId });
    } catch (error) {
      log.error(`Ошибка при обновлении заметок звонка ${callId}`, error);
    }
  });

  // Обработка входящего звонка от клиента (для тестирования)
  socket.on("incoming-call", async (data) => {
    const userId = userSockets.get(socket.id);

    if (!userId) {
      log.error("Пользователь не аутентифицирован для обработки звонка");
      return;
    }

    log.info("Получен входящий звонок от клиента", {
      callData: data,
      userId: userId,
    });

    log.info("ОТЛАДКА: Ищем пользователя для номера", {
      receiverNumber: data.receiver_number,
    });

    // Находим пользователя, которому принадлежит номер получателя
    const assignedUser = await getUserByPhone(data.receiver_number);

    log.info("ОТЛАДКА: Результат поиска пользователя", {
      receiverNumber: data.receiver_number,
      assignedUser: assignedUser
        ? {
            id: assignedUser.id,
            name: `${assignedUser.first_name} ${assignedUser.last_name}`,
            phone: assignedUser.phone_number,
          }
        : null,
    });

    if (!assignedUser) {
      log.warning("Пользователь не найден для номера", {
        receiverNumber: data.receiver_number,
      });
      return;
    }

    // Создаем запись в базе данных
    try {
      const result = await safeQuery(
        `INSERT INTO calls (caller_number, receiver_number, status, assigned_user_id, accepted_at) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id`,
        [
          data.caller_number,
          data.receiver_number,
          "incoming",
          assignedUser.id, // Используем ID пользователя, которому принадлежит номер
          new Date(),
        ],
        "создание записи входящего звонка"
      );

      const callId = result.rows[0].id;

      // Находим сокет пользователя, которому принадлежит номер
      const targetSocketId = Array.from(userSockets.entries()).find(
        ([socketId, userId]) => userId === assignedUser.id
      )?.[0];

      const senderUserId = userSockets.get(socket.id);

      log.info("Отправка уведомления", {
        callId,
        receiverNumber: data.receiver_number,
        assignedUserId: assignedUser.id,
        assignedUserName: `${assignedUser.first_name} ${assignedUser.last_name}`,
      });

      // Отправляем уведомление только пользователю, которому принадлежит номер
      if (targetSocketId) {
        io.to(targetSocketId).emit("incoming-call", {
          ...data,
          id: callId,
          status: "incoming",
          assigned_user_id: assignedUser.id, // Используем правильный ID
        });

        log.success("Уведомление отправлено пользователю", {
          targetUserId: assignedUser.id,
          targetSocketId,
          callId,
        });
      } else {
        log.warning("Пользователь не подключен", {
          targetUserId: assignedUser.id,
          callId,
        });
      }

      log.success("Входящий звонок обработан", {
        callId: callId,
        userId: userId,
        caller: data.caller_number,
        receiver: data.receiver_number,
      });
    } catch (error) {
      log.error("Ошибка при обработке входящего звонка", error);
    }
  });

  socket.on("disconnect", () => {
    const userId = userSockets.get(socket.id);
    if (userId) {
      connectedClients.delete(userId);
      userSockets.delete(socket.id);
      log.info(`Пользователь ${userId} отключился`, { socketId: socket.id });
    }
  });
});

// API маршруты
app.get("/api/calls", async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search, userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "ID пользователя обязателен для получения звонков",
      });
    }

    // Проверяем существование пользователя
    const userCheck = await safeQuery(
      "SELECT id FROM users WHERE id = $1",
      [userId],
      `проверка существования пользователя ${userId}`
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Пользователь с ID ${userId} не найден`,
      });
    }

    const offset = (page - 1) * limit;

    let query = `
      SELECT c.*, 
             u_assigned.first_name as assigned_user_first_name, 
             u_assigned.last_name as assigned_user_last_name,
             u_answered.first_name as answered_user_first_name, 
             u_answered.last_name as answered_user_last_name,
             comp.name_companies as caller_company_name,
             cp.customer_name,
             cp.company as customer_company,
             cp.email as customer_email
      FROM calls c
      LEFT JOIN users u_assigned ON c.assigned_user_id = u_assigned.id
      LEFT JOIN users u_answered ON c.answered_by_user_id = u_answered.id
      LEFT JOIN companies comp ON c.caller_company_id = comp.id
      LEFT JOIN call_participants cp ON c.id = cp.call_id
      WHERE c.assigned_user_id = $1 OR c.answered_by_user_id = $1
    `;

    const params = [userId];
    let paramIndex = 2;

    if (status) {
      query += ` AND c.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (search) {
      query += ` AND (c.caller_number ILIKE $${paramIndex} OR c.notes ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY c.accepted_at DESC LIMIT $${paramIndex} OFFSET $${
      paramIndex + 1
    }`;
    params.push(limit, offset);

    const result = await safeQuery(query, params, "получение списка звонков");

    let countQuery = `SELECT COUNT(*) as total FROM calls c WHERE c.assigned_user_id = $1`;
    countQuery = `SELECT COUNT(*) as total FROM calls c WHERE c.assigned_user_id = $1 OR c.answered_by_user_id = $1`;
    const countParams = [userId];
    let countParamIndex = 2;

    if (status) {
      countQuery += ` AND c.status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    if (search) {
      countQuery += ` AND (c.caller_number ILIKE $${countParamIndex} OR c.notes ILIKE $${countParamIndex})`;
      countParams.push(`%${search}%`);
    }

    const countResult = await safeQuery(
      countQuery,
      countParams,
      "подсчет звонков"
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    log.error("Ошибка при получении списка звонков", error);
    res
      .status(500)
      .json({ success: false, error: "Не удалось получить список звонков" });
  }
});

/*  if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'ID пользователя обязателен для получения активных звонков'
      });
    }*/

// Получение пользователей для перевода звонков
app.get("/api/users/available", async (req, res) => {
  try {
    const result = await safeQuery(
      `SELECT u.id, u.first_name, u.last_name, u.status 
       FROM users u 
       WHERE c.status IN ('incoming', 'accepted') 
       AND (c.assigned_user_id = $1 OR c.answered_by_user_id = $1)
       ORDER BY u.first_name`,
      [userId],
      "получение доступных пользователей"
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    log.error("Ошибка при получении списка пользователей", error);
    res.status(500).json({
      success: false,
      error: "Не удалось получить список пользователей",
    });
  }
});

// Проверка здоровья сервера
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "CRM сервер работает",
    timestamp: new Date().toISOString(),
    database: "TestA",
  });
});

// Функция для создания нового звонка (вызывается из AMI сервера)
export const createNewCall = async (callData) => {
  try {
    log.info("Создание нового звонка", {
      caller: callData.caller_number,
      receiver: callData.receiver_number,
    });

    const assignedUser = await getUserByPhone(callData.receiver_number);
    const callerCompany = await getCompanyByPhone(callData.caller_number);

    const call = {
      id: callData.id,
      caller_number: callData.caller_number,
      receiver_number: callData.receiver_number,
      timestamp: callData.timestamp,
      status: "incoming",
      assigned_user_id: assignedUser?.id || null,
      caller_company_id: callerCompany?.id || null,
      caller_company_name: callerCompany?.name_companies || null,
      is_on_hold: false,
      recording_url: callData.recording_url || null,
    };

    activeCalls.set(callData.id, call);

    // НЕ отправляем уведомления из createNewCall, поскольку они уже отправляются из обработчика incoming-call
    log.info(
      "createNewCall: уведомления обрабатываются в incoming-call обработчике",
      {
        callId: callData.id,
        assignedUserId: assignedUser?.id || "не найден",
        userFound: !!assignedUser,
        userConnected: assignedUser
          ? connectedClients.has(assignedUser.id)
          : false,
      }
    );
  } catch (error) {
    log.error("Ошибка при создании нового звонка", error);
  }
};

// Проверка доступности порта
const checkPort = (port) => {
  return new Promise((resolve) => {
    const testServer = http.createServer();
    testServer
      .listen(port, () => {
        testServer.close(() => resolve(true));
      })
      .on("error", () => resolve(false));
  });
};

// Запуск сервера с проверкой порта
const startServer = async () => {
  const PORT = 3771;

  /* const isPortAvailable = await checkPort(PORT);
  if (!isPortAvailable) {
    log.error(
      `Порт ${PORT} уже используется. Остановите процесс на этом порту или измените порт.`
    );
    process.exit(1);
  }*/

  server.listen(PORT, () => {
    log.success(`WebSocket сервер запущен на порту ${PORT}`);
    log.info("База данных: testA");
    log.info(`API доступен по адресу: http://localhost:${PORT}/api`);
  });
};

// Graceful shutdown
process.on("SIGINT", () => {
  log.info("Завершение работы WebSocket сервера...");
  server.close();
  pool.end();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log.info("Завершение работы WebSocket сервера...");
  server.close();
  pool.end();
  process.exit(0);
});

// Запускаем сервер только если этот файл запущен напрямую
if (process.argv[1] && process.argv[1].endsWith("websocket-server.js")) {
  startServer();
}
