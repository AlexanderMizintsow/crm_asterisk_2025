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
        connectedClientsSize: connectedClients.size,
        userSocketsSize: userSockets.size,
        connectedClientsKeys: Array.from(connectedClients.keys()),
        socketId: socket.id,
      });

      // Проверяем, что пользователь действительно сохранен
      setTimeout(() => {
        log.info("Проверка сохранения пользователя", {
          userId,
          connectedClientsSize: connectedClients.size,
          userSocketsSize: userSockets.size,
          connectedClientsKeys: Array.from(connectedClients.keys()),
          userSocketsEntries: Array.from(userSockets.entries()),
          hasUser: connectedClients.has(userId),
        });
      }, 1000);
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

    // Находим пользователя, которому принадлежит номер получателя
    const assignedUser = await getUserByPhone(data.receiver_number);

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

  // Обработка входящих звонков от asterisk-server.js
  socket.on("asterisk-incoming-call", (data) => {
    log.info("Получено уведомление о звонке от asterisk-server", {
      callId: data.id,
      caller: data.caller_number,
      receiver: data.receiver_number,
      assignedUserId: data.assigned_user_id,
      socketId: socket.id,
    });

    // Отправляем уведомление всем подключенным клиентам
    io.emit("incoming-call", data);

    log.success("Уведомление о звонке отправлено всем клиентам", {
      callId: data.id,
      connectedClientsCount: connectedClients.size,
      connectedClientsKeys: Array.from(connectedClients.keys()),
    });
  });

  // Обработка пропущенных звонков от asterisk-server.js
  socket.on("asterisk-missed-call", (data) => {
    log.info("Получено уведомление о пропущенном звонке от asterisk-server", {
      caller: data.caller_number,
      receiver: data.receiver_number,
      assignedUserId: data.assigned_user_id,
      socketId: socket.id,
    });

    // Отправляем уведомление всем подключенным клиентам
    io.emit("missed-call-created", data);

    log.success("Уведомление о пропущенном звонке отправлено всем клиентам", {
      caller: data.caller_number,
      receiver: data.receiver_number,
      connectedClientsCount: connectedClients.size,
      connectedClientsKeys: Array.from(connectedClients.keys()),
    });
  });

  // Обработка завершения звонков от asterisk-server.js
  socket.on("asterisk-call-ended", (data) => {
    log.info("Получено уведомление о завершении звонка от asterisk-server", {
      callId: data.callId,
      duration: data.duration,
      status: data.status,
      socketId: socket.id,
    });

    // Отправляем уведомление всем подключенным клиентам
    io.emit("call-ended", data);

    log.success("Уведомление о завершении звонка отправлено всем клиентам", {
      callId: data.callId,
      duration: data.duration,
      status: data.status,
      connectedClientsCount: connectedClients.size,
      connectedClientsKeys: Array.from(connectedClients.keys()),
    });
  });

  // Тестовое событие
  socket.on("test-event", (data) => {
    log.info("Получено тестовое событие", {
      message: data.message,
      socketId: socket.id,
    });

    // Отправляем обратно клиенту
    socket.emit("test-event", {
      message: "Ответ от сервера: " + data.message,
      timestamp: new Date().toISOString(),
    });
  });

  // Обработка перевода звонка
  socket.on("transfer-call", async (data) => {
    const { callId, targetUserId, userId } = data;
    const currentUserId = userSockets.get(socket.id);

    if (!currentUserId || !callId || !targetUserId) {
      log.error("Неполные данные для перевода звонка", {
        currentUserId,
        callId,
        targetUserId,
      });
      return;
    }

    try {
      // Проверяем существование целевого пользователя
      const targetUserResult = await safeQuery(
        "SELECT id, first_name, last_name FROM users WHERE id = $1 AND status = 'active'",
        [targetUserId],
        `проверка целевого пользователя ${targetUserId}`
      );

      if (targetUserResult.rows.length === 0) {
        socket.emit("transfer-error", {
          message: "Целевой пользователь не найден или неактивен",
        });
        return;
      }

      // Обновляем звонок в базе данных
      await safeQuery(
        `UPDATE calls SET 
         assigned_user_id = $1,
         transferred_at = $2,
         transferred_by_user_id = $3
         WHERE id = $4 AND (assigned_user_id = $5 OR answered_by_user_id = $5)`,
        [
          targetUserId,
          new Date().toISOString(),
          currentUserId,
          callId,
          currentUserId,
        ],
        `перевод звонка ${callId}`
      );

      // Отправляем уведомление целевому пользователю
      const targetSocket = connectedClients.get(targetUserId);
      if (targetSocket) {
        targetSocket.emit("call-transferred", {
          callId,
          fromUserId: currentUserId,
          toUserId: targetUserId,
        });
      }

      // Уведомляем всех клиентов об обновлении
      io.emit("call-transferred", {
        callId,
        fromUserId: currentUserId,
        toUserId: targetUserId,
      });

      log.success(`Звонок ${callId} переведен`, {
        fromUserId: currentUserId,
        toUserId: targetUserId,
      });
    } catch (error) {
      socket.emit("transfer-error", { message: "Не удалось перевести звонок" });
      log.error(`Ошибка при переводе звонка ${callId}`, error);
    }
  });

  // Обработка постановки звонка на удержание
  socket.on("hold-call", async (data) => {
    const { callId, isOnHold } = data;
    const userId = userSockets.get(socket.id);

    if (!userId || !callId) {
      log.error("Неполные данные для постановки на удержание", {
        userId,
        callId,
      });
      return;
    }

    try {
      await safeQuery(
        `UPDATE calls SET is_on_hold = $1 WHERE id = $2 AND (assigned_user_id = $3 OR answered_by_user_id = $3)`,
        [isOnHold, callId, userId],
        `${isOnHold ? "постановка" : "снятие с"} удержания звонка ${callId}`
      );

      io.emit("call-hold-updated", { callId, isOnHold, userId });

      log.success(
        `Звонок ${callId} ${isOnHold ? "поставлен" : "снят с"} удержания`,
        {
          userId,
          isOnHold,
        }
      );
    } catch (error) {
      socket.emit("error", { message: "Не удалось изменить статус удержания" });
      log.error(
        `Ошибка при изменении статуса удержания звонка ${callId}`,
        error
      );
    }
  });

  // Обработка запроса статуса звонка
  socket.on("get-call-status", async (data) => {
    const { callId } = data;
    const userId = userSockets.get(socket.id);

    if (!userId || !callId) {
      log.error("Неполные данные для получения статуса", { userId, callId });
      return;
    }

    try {
      const result = await safeQuery(
        `SELECT * FROM calls WHERE id = $1 AND (assigned_user_id = $2 OR answered_by_user_id = $2)`,
        [callId, userId],
        `получение статуса звонка ${callId}`
      );

      if (result.rows.length > 0) {
        socket.emit("call-status", {
          callId,
          status: result.rows[0],
        });
      } else {
        socket.emit("call-status-error", {
          callId,
          message: "Звонок не найден или у вас нет доступа",
        });
      }
    } catch (error) {
      socket.emit("call-status-error", {
        callId,
        message: "Ошибка при получении статуса",
      });
      log.error(`Ошибка при получении статуса звонка ${callId}`, error);
    }
  });

  // Обработка запроса активных звонков
  socket.on("get-active-calls", async (data) => {
    const userId = userSockets.get(socket.id);

    if (!userId) {
      log.error(
        "Пользователь не аутентифицирован для получения активных звонков"
      );
      return;
    }

    try {
      const result = await safeQuery(
        `SELECT * FROM calls WHERE (assigned_user_id = $1 OR answered_by_user_id = $1) AND status IN ('incoming', 'accepted', 'active')`,
        [userId],
        `получение активных звонков для пользователя ${userId}`
      );

      socket.emit("active-calls", result.rows);
    } catch (error) {
      socket.emit("error", { message: "Не удалось получить активные звонки" });
      log.error(
        `Ошибка при получении активных звонков для пользователя ${userId}`,
        error
      );
    }
  });

  // Обработка запроса статистики
  socket.on("get-statistics", async (data) => {
    const userId = userSockets.get(socket.id);

    if (!userId) {
      log.error("Пользователь не аутентифицирован для получения статистики");
      return;
    }

    try {
      const result = await safeQuery(
        `SELECT 
          COUNT(*) as total_calls,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_calls,
          COUNT(CASE WHEN status = 'missed' THEN 1 END) as missed_calls,
          COUNT(CASE WHEN status = 'incoming' THEN 1 END) as incoming_calls,
          COUNT(CASE WHEN status = 'outgoing' THEN 1 END) as outgoing_calls,
          AVG(CASE WHEN duration > 0 THEN duration END) as avg_duration,
          SUM(CASE WHEN duration > 0 THEN duration END) as total_duration
        FROM calls
        WHERE assigned_user_id = $1 OR answered_by_user_id = $1`,
        [userId],
        `получение статистики для пользователя ${userId}`
      );

      socket.emit("statistics", result.rows[0]);
    } catch (error) {
      socket.emit("error", { message: "Не удалось получить статистику" });
      log.error(
        `Ошибка при получении статистики для пользователя ${userId}`,
        error
      );
    }
  });

  // Обработка инициации исходящего звонка
  socket.on("initiate-outgoing-call", async (data) => {
    const { fromNumber, toNumber } = data;
    const userId = userSockets.get(socket.id);

    if (!userId || !fromNumber || !toNumber) {
      log.error("Неполные данные для инициации исходящего звонка", {
        userId,
        fromNumber,
        toNumber,
      });
      return;
    }

    try {
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

      socket.emit("outgoing-call-initiated", {
        callId,
        fromNumber,
        toNumber,
      });

      log.success("Исходящий звонок инициирован", {
        callId,
        fromNumber,
        toNumber,
        userId,
      });
    } catch (error) {
      socket.emit("error", { message: "Не удалось инициировать звонок" });
      log.error("Ошибка при инициации исходящего звонка", error);
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
             cp.email as customer_email,
             CASE 
               WHEN c.recording_status = 'available' THEN true
               ELSE false
             END as has_recording,
             c.recording_status,
             c.recording_reason
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
       WHERE u.status = 'active'
       ORDER BY u.first_name`,
      [],
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

// API endpoint для получения аудиозаписи звонка
app.get("/api/calls/:callId/recording", async (req, res) => {
  try {
    const { callId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "ID пользователя обязателен",
      });
    }

    // Получаем информацию о звонке
    const callResult = await safeQuery(
      `SELECT * FROM calls WHERE id = $1 AND (assigned_user_id = $2 OR answered_by_user_id = $2)`,
      [callId, userId],
      "получение информации о звонке"
    );

    if (callResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Звонок не найден или у вас нет доступа",
      });
    }

    const call = callResult.rows[0];

    // Проверяем статус записи
    if (call.recording_status !== "available") {
      return res.status(404).json({
        success: false,
        error: "Запись звонка недоступна",
        reason: call.recording_reason || "Запись не найдена",
        status: call.recording_status,
      });
    }

    if (!call.recording_url) {
      return res.status(404).json({
        success: false,
        error: "Путь к записи не найден",
      });
    }

    // Получаем аудиофайл из Asterisk через AMI
    const { getRecordingAudio } = await import("./asterisk-server.js");
    const audioBuffer = await getRecordingAudio(call.recording_url);

    if (!audioBuffer) {
      return res.status(404).json({
        success: false,
        error: "Не удалось получить аудиофайл",
      });
    }

    // Отправляем аудиофайл
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="call-${callId}.wav"`
    );
    res.send(Buffer.from(audioBuffer));

    log.success("Аудиозапись звонка отправлена", {
      callId,
      userId,
      recordingPath: call.recording_url,
    });
  } catch (error) {
    log.error("Ошибка при получении аудиозаписи", error);
    res.status(500).json({
      success: false,
      error: "Не удалось получить аудиозапись",
    });
  }
});

// API endpoint для получения статуса записи звонка
app.get("/api/calls/:callId/recording-status", async (req, res) => {
  try {
    const { callId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "ID пользователя обязателен",
      });
    }

    // Получаем информацию о звонке
    const callResult = await safeQuery(
      `SELECT recording_status, recording_reason, recording_url FROM calls 
       WHERE id = $1 AND (assigned_user_id = $2 OR answered_by_user_id = $2)`,
      [callId, userId],
      "получение статуса записи звонка"
    );

    if (callResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Звонок не найден или у вас нет доступа",
      });
    }

    const call = callResult.rows[0];

    res.json({
      success: true,
      data: {
        status: call.recording_status,
        reason: call.recording_reason,
        hasRecording: call.recording_status === "available",
      },
    });
  } catch (error) {
    log.error("Ошибка при получении статуса записи", error);
    res.status(500).json({
      success: false,
      error: "Не удалось получить статус записи",
    });
  }
});

// API endpoint для получения статистики звонков
app.get("/api/statistics", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "ID пользователя обязателен для получения статистики",
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

    let query = `
      SELECT 
        COUNT(*) as total_calls,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_calls,
        COUNT(CASE WHEN status = 'missed' THEN 1 END) as missed_calls,
        COUNT(CASE WHEN status = 'incoming' THEN 1 END) as incoming_calls,
        COUNT(CASE WHEN status = 'outgoing' THEN 1 END) as outgoing_calls,
        AVG(CASE WHEN duration > 0 THEN duration END) as avg_duration,
        SUM(CASE WHEN duration > 0 THEN duration END) as total_duration
      FROM calls
      WHERE assigned_user_id = $1 OR answered_by_user_id = $1
    `;

    const result = await safeQuery(
      query,
      [userId],
      "получение статистики звонков"
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    log.error("Ошибка при получении статистики", error);
    res.status(500).json({
      success: false,
      error: "Не удалось получить статистику",
    });
  }
});

// API endpoint для получения активных звонков
app.get("/api/calls/active", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "ID пользователя обязателен для получения активных звонков",
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

    const result = await safeQuery(
      `SELECT 
        c.*,
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
       WHERE (c.assigned_user_id = $1 OR c.answered_by_user_id = $1)
       AND c.status IN ('incoming', 'accepted', 'active')
       ORDER BY c.created_at DESC`,
      [userId],
      "получение активных звонков"
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    log.error("Ошибка при получении активных звонков", error);
    res.status(500).json({
      success: false,
      error: "Не удалось получить активные звонки",
    });
  }
});

// API endpoint для инициации исходящего звонка
app.post("/api/calls/outgoing", async (req, res) => {
  try {
    const { fromNumber, toNumber, userId } = req.body;

    if (!fromNumber || !toNumber || !userId) {
      return res.status(400).json({
        success: false,
        error:
          "Необходимо указать номер отправителя, получателя и ID пользователя",
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

    log.success("Исходящий звонок создан", {
      callId,
      from: fromNumber,
      to: toNumber,
      userId,
    });

    res.json({
      success: true,
      callId,
      message: "Звонок инициирован",
    });
  } catch (error) {
    log.error("Ошибка при инициации звонка", error);
    res.status(500).json({
      success: false,
      error: "Внутренняя ошибка сервера",
    });
  }
});

// API endpoint для получения статуса звонка
app.get("/api/calls/:callId/status", async (req, res) => {
  try {
    const { callId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "ID пользователя обязателен",
      });
    }

    const result = await safeQuery(
      `SELECT * FROM calls 
       WHERE id = $1 AND (assigned_user_id = $2 OR answered_by_user_id = $2)`,
      [callId, userId],
      "получение статуса звонка"
    );

    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.status(404).json({
        success: false,
        error: "Звонок не найден или у вас нет доступа",
      });
    }
  } catch (error) {
    log.error("Ошибка при получении статуса звонка", error);
    res.status(500).json({
      success: false,
      error: "Внутренняя ошибка сервера",
    });
  }
});

// API endpoint для получения внутренних номеров
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
       AND u.status = 'active'
       ORDER BY up.phone_number`,
      [],
      "получение внутренних номеров"
    );

    log.success("Получены внутренние номера", { count: result.rows.length });
    res.json({ success: true, data: result.rows });
  } catch (error) {
    log.error("Ошибка при получении внутренних номеров", error);
    res.status(500).json({
      success: false,
      error: "Ошибка при получении внутренних номеров",
    });
  }
});

// API endpoint для обновления заметок звонка
app.put("/api/calls/:callId/notes", async (req, res) => {
  try {
    const { callId } = req.params;
    const { notes, userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "ID пользователя обязателен",
      });
    }

    if (notes === undefined || notes === null) {
      return res.status(400).json({
        success: false,
        error: "Заметки обязательны",
      });
    }

    const result = await safeQuery(
      `UPDATE calls SET notes = $1 
       WHERE id = $2 AND (assigned_user_id = $3 OR answered_by_user_id = $3)
       RETURNING id`,
      [notes, callId, userId],
      "обновление заметок звонка"
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Звонок не найден или у вас нет доступа",
      });
    }

    log.success("Заметки звонка обновлены", { callId, userId });
    res.json({ success: true, message: "Заметки обновлены" });
  } catch (error) {
    log.error("Ошибка при обновлении заметок", error);
    res.status(500).json({
      success: false,
      error: "Не удалось обновить заметки",
    });
  }
});

// API endpoint для завершения звонка
app.put("/api/calls/:callId/end", async (req, res) => {
  try {
    const { callId } = req.params;
    const { duration, notes, userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "ID пользователя обязателен",
      });
    }

    const endedAt = new Date().toISOString();

    const result = await safeQuery(
      `UPDATE calls SET 
       status = 'completed',
       ended_at = $1,
       duration = $2,
       notes = $3
       WHERE id = $4 AND (assigned_user_id = $5 OR answered_by_user_id = $5)
       RETURNING id`,
      [endedAt, duration || 0, notes || "", callId, userId],
      "завершение звонка"
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Звонок не найден или у вас нет доступа",
      });
    }

    log.success("Звонок завершен", {
      callId,
      duration: duration || 0,
      userId,
    });

    res.json({
      success: true,
      message: "Звонок завершен",
      endedAt,
      duration: duration || 0,
    });
  } catch (error) {
    log.error("Ошибка при завершении звонка", error);
    res.status(500).json({
      success: false,
      error: "Не удалось завершить звонок",
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

    // Отладочная информация
    log.info("Отладочная информация о подключениях", {
      callId: callData.id,
      assignedUserId: assignedUser?.id || "не найден",
      userFound: !!assignedUser,
      connectedClientsSize: connectedClients.size,
      userSocketsSize: userSockets.size,
      connectedClientsKeys: Array.from(connectedClients.keys()),
      userSocketsEntries: Array.from(userSockets.entries()),
    });

    // Отправляем уведомление пользователю, если он подключен
    if (assignedUser && connectedClients.has(assignedUser.id)) {
      const targetSocket = connectedClients.get(assignedUser.id);

      targetSocket.emit("incoming-call", {
        ...call,
        id: callData.id,
        status: "incoming",
        assigned_user_id: assignedUser.id,
      });

      log.success("Уведомление о звонке отправлено пользователю", {
        callId: callData.id,
        userId: assignedUser.id,
        userName: `${assignedUser.first_name} ${assignedUser.last_name}`,
        phone: assignedUser.phone_number,
      });
    } else {
      log.warning("Пользователь не подключен для получения уведомления", {
        callId: callData.id,
        assignedUserId: assignedUser?.id || "не найден",
        userFound: !!assignedUser,
        userConnected: assignedUser
          ? connectedClients.has(assignedUser.id)
          : false,
        connectedClientsSize: connectedClients.size,
        connectedClientsKeys: Array.from(connectedClients.keys()),
      });

      // Отправляем уведомление всем подключенным клиентам (fallback)
      io.emit("incoming-call", {
        ...call,
        id: callData.id,
        status: "incoming",
        assigned_user_id: assignedUser?.id || null,
      });

      log.info("Уведомление отправлено всем подключенным клиентам (fallback)", {
        callId: callData.id,
        assignedUserId: assignedUser?.id || "не найден",
      });
    }
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

  const isPortAvailable = await checkPort(PORT);
  if (!isPortAvailable) {
    log.error(
      `Порт ${PORT} уже используется. Остановите процесс на этом порту или измените порт.`
    );
    process.exit(1);
  }

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
