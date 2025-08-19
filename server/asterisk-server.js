import net from "net";
import {
  pool,
  log,
  safeQuery,
  getUserByPhone,
  getCompanyByPhone,
} from "./shared-functions.js";

// Настройки Asterisk AMI
const amiHost = "192.168.57.165";
const amiPort = 5038;
const amiUser = "ats";
const amiPassword = "S2s14q98svf32a";

const client = new net.Socket();
let currentCall = {};

// Логирование для AMI
const amiLog = {
  info: (message, data = {}) => {
    log.info(`[AMI] ${message}`, data);
  },
  error: (message, error = null) => {
    log.error(`[AMI] ${message}`, error);
  },
  success: (message, data = {}) => {
    log.success(`[AMI] ${message}`, data);
  },
  warning: (message, data = {}) => {
    log.warning(`[AMI] ${message}`, data);
  },
};

// Подключение к Asterisk AMI
const connectToAsterisk = () => {
  amiLog.info("Попытка подключения к Asterisk AMI", {
    host: amiHost,
    port: amiPort,
  });

  client.connect(amiPort, amiHost, () => {
    amiLog.success("Подключение к Asterisk AMI установлено");
    client.write(
      `Action: Login\r\nUsername: ${amiUser}\r\nSecret: ${amiPassword}\r\n\r\n`
    );
  });
};

client.on("data", async (data) => {
  const response = data.toString().split("\r\n");

  for (const line of response) {
    try {
      if (line.startsWith("Event: Newchannel")) {
        currentCall.channel = line.split(": ")[1];
        currentCall.timestamp = new Date().toISOString();
        amiLog.info("Обнаружен новый канал", { channel: currentCall.channel });
      } else if (line.startsWith("CallerIDNum:")) {
        currentCall.callerNumber = line.split(": ")[1];
        amiLog.info("Определен номер звонящего", {
          callerNumber: currentCall.callerNumber,
        });
      } else if (line.startsWith("Exten:")) {
        currentCall.receiverNumber = line.split(": ")[1];
        amiLog.info("Определен номер получателя", {
          receiverNumber: currentCall.receiverNumber,
        });

        // Когда получили полную информацию о звонке, создаем уведомление
        if (currentCall.callerNumber && currentCall.receiverNumber) {
          await processIncomingCall();
        }
      } else if (line.startsWith("Event: Answer")) {
        // Звонок принят
        await processCallAnswered();
      } else if (line.startsWith("Event: Hangup")) {
        // Звонок завершен
        await processCallEnd();
      }
    } catch (error) {
      amiLog.error("Ошибка при обработке AMI события", error);
    }
  }
});

// Обработка входящего звонка
const processIncomingCall = async () => {
  try {
    amiLog.info("Обработка входящего звонка", {
      caller: currentCall.callerNumber,
      receiver: currentCall.receiverNumber,
    });

    const assignedUser = await getUserByPhone(currentCall.receiverNumber);
    const callerCompany = await getCompanyByPhone(currentCall.callerNumber);

    // Создаем запись в БД со статусом "incoming"
    const result = await safeQuery(
      `INSERT INTO calls (
        caller_number, 
        receiver_number, 
        accepted_at, 
        status, 
        assigned_user_id,
        caller_company_id,
        channel_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        currentCall.callerNumber,
        currentCall.receiverNumber,
        currentCall.timestamp,
        "incoming",
        assignedUser?.id || null,
        callerCompany?.id || null,
        currentCall.channel,
      ],
      "создание записи входящего звонка"
    );

    const newCallId = result.rows[0].id;

    // Отправляем уведомление пользователю через WebSocket
    if (assignedUser) {
      const callData = {
        id: newCallId,
        caller_number: currentCall.callerNumber,
        receiver_number: currentCall.receiverNumber,
        timestamp: currentCall.timestamp,
        status: "incoming",
        assigned_user_id: assignedUser.id,
        caller_company_id: callerCompany?.id || null,
        caller_company_name: callerCompany?.name_companies || null,
        channel_id: currentCall.channel,
      };

      // Импортируем функцию из websocket-server
      const { createNewCall } = await import("./websocket-server.js");
      await createNewCall(callData);

      amiLog.success("Уведомление о звонке отправлено пользователю", {
        callId: newCallId,
        userId: assignedUser.id,
        userName: `${assignedUser.first_name} ${assignedUser.last_name}`,
      });
    } else {
      amiLog.warning("Пользователь для звонка не найден", {
        callId: newCallId,
        receiverNumber: currentCall.receiverNumber,
      });
    }

    // Сохраняем ID звонка для последующего обновления
    currentCall.callId = newCallId;
  } catch (error) {
    amiLog.error("Ошибка при обработке входящего звонка", error);
  }
};

// Обработка принятого звонка
const processCallAnswered = async () => {
  if (!currentCall.callId) {
    amiLog.warning("Нет ID звонка для обновления статуса");
    return;
  }

  try {
    const answeredAt = new Date().toISOString();

    await safeQuery(
      `UPDATE calls SET 
       status = 'answered', 
       answered_at = $1 
       WHERE id = $2`,
      [answeredAt, currentCall.callId],
      "обновление статуса звонка на 'answered'"
    );

    amiLog.success("Звонок отмечен как принятый", {
      callId: currentCall.callId,
      answeredAt,
    });
  } catch (error) {
    amiLog.error("Ошибка при обновлении статуса звонка", error);
  }
};

// Обработка завершения звонка
const processCallEnd = async () => {
  if (!currentCall.callerNumber) {
    amiLog.error("Звонок завершен без номера звонящего", currentCall);
    currentCall = {};
    return;
  }

  try {
    const endedAt = new Date().toISOString();

    if (currentCall.callId) {
      // Обновляем существующую запись
      await safeQuery(
        `UPDATE calls SET 
         status = 'completed',
         ended_at = $1,
         duration = EXTRACT(EPOCH FROM ($1::timestamp - accepted_at::timestamp))
         WHERE id = $2`,
        [endedAt, currentCall.callId],
        "завершение звонка"
      );

      amiLog.success("Звонок завершен", {
        callId: currentCall.callId,
        caller: currentCall.callerNumber,
        receiver: currentCall.receiverNumber,
        endedAt,
      });
    } else {
      // Если нет ID звонка, создаем новую запись (пропущенный звонок)
      const assignedUser = await getUserByPhone(currentCall.receiverNumber);
      const callerCompany = await getCompanyByPhone(currentCall.callerNumber);

      await safeQuery(
        `INSERT INTO calls (
          caller_number, 
          receiver_number, 
          accepted_at, 
          status, 
          assigned_user_id,
          caller_company_id,
          channel_id,
          ended_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          currentCall.callerNumber,
          currentCall.receiverNumber,
          currentCall.timestamp,
          "missed",
          assignedUser?.id || null,
          callerCompany?.id || null,
          currentCall.channel,
          endedAt,
        ],
        "запись пропущенного звонка"
      );

      amiLog.success("Пропущенный звонок записан", {
        caller: currentCall.callerNumber,
        receiver: currentCall.receiverNumber,
        endedAt,
      });
    }
  } catch (error) {
    amiLog.error("Ошибка при обработке завершения звонка", error);
  } finally {
    currentCall = {};
  }
};

client.on("error", (err) => {
  amiLog.error("Ошибка подключения к Asterisk AMI", err);

  // Переподключение через 10 секунд при ошибке
  setTimeout(() => {
    amiLog.info("Попытка переподключения к Asterisk AMI...");
    try {
      connectToAsterisk();
    } catch (error) {
      amiLog.error("Ошибка при переподключении к AMI", error);
    }
  }, 10000);
});

client.on("end", () => {
  amiLog.warning("AMI соединение завершено");
});

client.on("close", () => {
  amiLog.warning("AMI соединение закрыто. Переподключение через 5 секунд...");
  setTimeout(() => {
    try {
      amiLog.info("Переподключение к Asterisk AMI...");
      connectToAsterisk();
    } catch (error) {
      amiLog.error("Ошибка при переподключении", error);
    }
  }, 5000);
});

// Запуск подключения
connectToAsterisk();

// Graceful shutdown
process.on("SIGINT", () => {
  amiLog.info("Завершение работы Asterisk сервера...");
  client.end();
  pool.end();
  process.exit(0);
});

process.on("SIGTERM", () => {
  amiLog.info("Завершение работы Asterisk сервера...");
  client.end();
  pool.end();
  process.exit(0);
});
