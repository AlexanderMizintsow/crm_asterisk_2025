import net from "net";
import {
  pool,
  log,
  safeQuery,
  getUserByPhone,
  getCompanyByPhone,
} from "./shared-functions.js";
import { io } from "socket.io-client";

// Функция отправки уведомления о завершении звонка
const sendCallEndedNotification = async (callId, callData) => {
  // Не отправляем уведомления с null callId
  if (!callId) {
    amiLog.warning(
      "Попытка отправить уведомление о завершении звонка без callId",
      {
        callData: callData,
      }
    );
    return;
  }

  try {
    const socket = io("http://localhost:3771");

    await new Promise((resolve, reject) => {
      socket.on("connect", () => {
        socket.emit("asterisk-call-ended", {
          callId: callId,
          endedAt: new Date().toISOString(),
          duration: callData.duration || 0,
          status: "completed",
        });
        socket.disconnect();
        resolve();
      });

      socket.on("connect_error", (error) => {
        amiLog.error(
          "Ошибка подключения к WebSocket серверу для отправки call-ended",
          error
        );
        reject(error);
      });

      setTimeout(() => {
        reject(new Error("Таймаут подключения к WebSocket серверу"));
      }, 5000);
    });
  } catch (error) {
    amiLog.error("Ошибка отправки уведомления call-ended", error);
  }
};

// Функция отправки уведомления о пропущенном звонке
const sendMissedCallNotification = async (callData) => {
  try {
    const socket = io("http://localhost:3771");

    await new Promise((resolve, reject) => {
      socket.on("connect", () => {
        socket.emit("asterisk-missed-call", {
          id: callData.id || null,
          caller_number: callData.callerNumber,
          receiver_number: callData.receiverNumber,
          timestamp: callData.timestamp,
          status: "missed",
          assigned_user_id:
            callData.assigned_user_id || callData.assignedUserId || null,
        });
        socket.disconnect();
        resolve();
      });

      socket.on("connect_error", (error) => {
        amiLog.error(
          "Ошибка подключения к WebSocket серверу для отправки missed-call-created",
          error
        );
        reject(error);
      });

      setTimeout(() => {
        reject(new Error("Таймаут подключения к WebSocket серверу"));
      }, 5000);
    });
  } catch (error) {
    amiLog.error("Ошибка отправки уведомления missed-call-created", error);
  }
};

// Настройки Asterisk AMI
const amiHost = "192.168.57.165";
const amiPort = 5038;
const amiUser = "ats";
const amiPassword = "S2s14q98svf32a";

const client = new net.Socket();
let currentCall = {};
// Map для хранения данных звонков по каналам
const callDataMap = new Map();

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
        // Ищем строку с Channel: для получения реального канала
        let channel = null;
        let uniqueId = null;
        for (let i = 0; i < response.length; i++) {
          if (response[i].startsWith("Channel:")) {
            channel = response[i].split(": ")[1];
          }
          if (response[i].startsWith("Uniqueid:")) {
            uniqueId = response[i].split(": ")[1];
          }
        }

        if (!channel || !uniqueId) {
          amiLog.warning(
            "Не удалось найти канал или Uniqueid в событии Newchannel",
            {
              channel: channel,
              uniqueId: uniqueId,
              response: response,
            }
          );
          return;
        }

        // Создаем данные для нового канала
        const callData = {
          channel: channel,
          uniqueId: uniqueId,
          timestamp: new Date().toISOString(),
          processed: false,
        };
        callDataMap.set(channel, callData);
        currentCall = callData;

        amiLog.info("Обнаружен новый канал, создали данные", {
          channel: channel,
          uniqueId: uniqueId,
          callData: { ...callData },
          totalCalls: callDataMap.size,
        });
      } else if (line.startsWith("CallerIDNum:")) {
        const callerNumber = line.split(": ")[1];

        // Ищем канал и Uniqueid в текущем событии
        let channel = null;
        let uniqueId = null;
        for (let i = 0; i < response.length; i++) {
          if (response[i].startsWith("Channel:")) {
            channel = response[i].split(": ")[1];
          }
          if (response[i].startsWith("Uniqueid:")) {
            uniqueId = response[i].split(": ")[1];
          }
        }

        // Если канал не найден в событии, ищем по Uniqueid
        if (!channel && uniqueId) {
          for (const [existingChannel, existingData] of callDataMap.entries()) {
            if (existingData.uniqueId === uniqueId) {
              channel = existingChannel;
              break;
            }
          }
        }

        // Если все еще не найден, используем последний созданный
        if (!channel) {
          channel = Array.from(callDataMap.keys()).pop();
        }

        if (!channel || !callDataMap.has(channel)) {
          amiLog.warning("Канал не найден для CallerIDNum", {
            callerNumber: callerNumber,
            uniqueId: uniqueId,
            availableChannels: Array.from(callDataMap.keys()),
            response: response,
          });
          return;
        }

        // Проверяем, что Uniqueid совпадает (если есть)
        const callData = callDataMap.get(channel);
        if (uniqueId && callData.uniqueId && uniqueId !== callData.uniqueId) {
          amiLog.warning("Uniqueid не совпадает для CallerIDNum", {
            channel: channel,
            callerNumber: callerNumber,
            eventUniqueId: uniqueId,
            callDataUniqueId: callData.uniqueId,
          });
          return;
        }
        if (callData.processed) {
          amiLog.warning("Попытка обновить данные уже обработанного звонка", {
            channel: channel,
            newCallerNumber: callerNumber,
            callData: { ...callData },
          });
          return;
        }

        callData.callerNumber = callerNumber;
        currentCall = callData;

        amiLog.info("Определен номер звонящего", {
          channel: channel,
          callerNumber: callerNumber,
          callData: { ...callData },
        });
      } else if (line.startsWith("Exten:")) {
        const receiverNumber = line.split(": ")[1];

        // Ищем канал и Uniqueid в текущем событии
        let channel = null;
        let uniqueId = null;
        for (let i = 0; i < response.length; i++) {
          if (response[i].startsWith("Channel:")) {
            channel = response[i].split(": ")[1];
          }
          if (response[i].startsWith("Uniqueid:")) {
            uniqueId = response[i].split(": ")[1];
          }
        }

        // Если канал не найден в событии, ищем по Uniqueid
        if (!channel && uniqueId) {
          for (const [existingChannel, existingData] of callDataMap.entries()) {
            if (existingData.uniqueId === uniqueId) {
              channel = existingChannel;
              break;
            }
          }
        }

        // Если все еще не найден, используем последний созданный
        if (!channel) {
          channel = Array.from(callDataMap.keys()).pop();
        }

        if (!channel || !callDataMap.has(channel)) {
          amiLog.warning("Канал не найден для Exten", {
            receiverNumber: receiverNumber,
            uniqueId: uniqueId,
            availableChannels: Array.from(callDataMap.keys()),
            response: response,
          });
          return;
        }

        // Проверяем, что Uniqueid совпадает (если есть)
        const callData = callDataMap.get(channel);
        if (uniqueId && callData.uniqueId && uniqueId !== callData.uniqueId) {
          amiLog.warning("Uniqueid не совпадает для Exten", {
            channel: channel,
            receiverNumber: receiverNumber,
            eventUniqueId: uniqueId,
            callDataUniqueId: callData.uniqueId,
          });
          return;
        }
        if (callData.processed) {
          amiLog.warning("Попытка обновить данные уже обработанного звонка", {
            channel: channel,
            newReceiverNumber: receiverNumber,
            callData: { ...callData },
          });
          return;
        }

        callData.receiverNumber = receiverNumber;
        currentCall = callData;

        amiLog.info("Определен номер получателя", {
          channel: channel,
          receiverNumber: receiverNumber,
          callData: { ...callData },
        });

        // Когда получили полную информацию о звонке, создаем уведомление
        if (
          callData.callerNumber &&
          callData.receiverNumber &&
          !callData.processed
        ) {
          await processIncomingCall(channel);
        }
      } else if (line.startsWith("Event: Answer")) {
        // Звонок принят
        let channel = null;
        let uniqueId = null;
        for (let i = 0; i < response.length; i++) {
          if (response[i].startsWith("Channel:")) {
            channel = response[i].split(": ")[1];
          }
          if (response[i].startsWith("Uniqueid:")) {
            uniqueId = response[i].split(": ")[1];
          }
        }
        if (channel) {
          await processCallAnswered(channel, uniqueId);
        }
      } else if (line.startsWith("Event: Hangup")) {
        // Звонок завершен
        let channel = null;
        let uniqueId = null;
        let callerIdNum = null;
        let hangupCause = null;
        for (let i = 0; i < response.length; i++) {
          if (response[i].startsWith("Channel:")) {
            channel = response[i].split(": ")[1];
          }
          if (response[i].startsWith("Uniqueid:")) {
            uniqueId = response[i].split(": ")[1];
          }
          if (response[i].startsWith("CallerIDNum:")) {
            callerIdNum = response[i].split(": ")[1];
          }
          if (response[i].startsWith("Cause:")) {
            hangupCause = response[i].split(": ")[1];
          }
        }

        // Если есть CallerIDNum в событии Hangup, обновляем данные канала
        if (channel && callerIdNum) {
          const callData = callDataMap.get(channel);
          if (callData && !callData.callerNumber) {
            callData.callerNumber = callerIdNum;
            amiLog.info("Обновлен номер звонящего из события Hangup", {
              channel: channel,
              uniqueId: uniqueId,
              callerNumber: callerIdNum,
            });
          }
        }

        if (channel) {
          await processCallEnd(channel, uniqueId, hangupCause);
        }
      }
    } catch (error) {
      amiLog.error("Ошибка при обработке AMI события", error);
    }
  }
});

// Обработка входящего звонка
const processIncomingCall = async (channel) => {
  try {
    const callData = callDataMap.get(channel);
    if (!callData) {
      amiLog.error("Данные звонка не найдены для канала", { channel });
      return;
    }

    // Проверяем, что у нас есть все необходимые данные
    if (!callData.callerNumber || !callData.receiverNumber) {
      amiLog.warning("Неполные данные звонка, пропускаем", {
        caller: callData.callerNumber,
        receiver: callData.receiverNumber,
        channel: callData.channel,
      });
      return;
    }

    // Проверяем, что номера звонящего и получателя разные
    if (callData.callerNumber === callData.receiverNumber) {
      amiLog.warning("Номера звонящего и получателя одинаковые, пропускаем", {
        caller: callData.callerNumber,
        receiver: callData.receiverNumber,
        channel: callData.channel,
      });
      return;
    }

    amiLog.info("Обработка входящего звонка", {
      channel: channel,
      caller: callData.callerNumber,
      receiver: callData.receiverNumber,
    });

    const assignedUser = await getUserByPhone(callData.receiverNumber);
    const callerCompany = await getCompanyByPhone(callData.callerNumber);

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
        callData.callerNumber,
        callData.receiverNumber,
        callData.timestamp,
        "incoming",
        assignedUser?.id || null,
        callerCompany?.id || null,
        callData.channel,
      ],
      "создание записи входящего звонка"
    );

    const newCallId = result.rows[0].id;

    // Обновляем callData с новым ID
    callData.id = newCallId;
    callData.processed = true;

    // Отправляем уведомление пользователю через WebSocket
    if (assignedUser) {
      const wsCallData = {
        id: newCallId,
        caller_number: callData.callerNumber,
        receiver_number: callData.receiverNumber,
        timestamp: callData.timestamp,
        status: "incoming",
        assigned_user_id: assignedUser.id,
        caller_company_id: callerCompany?.id || null,
        caller_company_name: callerCompany?.name_companies || null,
        channel_id: callData.channel,
      };

      // Отправляем уведомление через WebSocket клиент
      try {
        const { io } = await import("socket.io-client");
        const wsClient = io("http://localhost:3771");

        wsClient.on("connect", () => {
          amiLog.info("WebSocket клиент подключен для отправки уведомления");

          // Отправляем уведомление всем подключенным клиентам
          wsClient.emit("asterisk-incoming-call", {
            id: wsCallData.id,
            caller_number: wsCallData.caller_number,
            receiver_number: wsCallData.receiver_number,
            timestamp: wsCallData.timestamp,
            status: "incoming",
            assigned_user_id: wsCallData.assigned_user_id,
            caller_company_id: wsCallData.caller_company_id,
            caller_company_name: wsCallData.caller_company_name,
          });

          amiLog.success("Уведомление о звонке отправлено через WebSocket", {
            callId: newCallId,
            userId: wsCallData.assigned_user_id,
          });

          // Отключаемся после отправки
          setTimeout(() => {
            wsClient.disconnect();
          }, 1000);
        });

        wsClient.on("connect_error", (error) => {
          amiLog.error("Ошибка подключения WebSocket клиента", error);
        });
      } catch (error) {
        amiLog.error("Ошибка при отправке уведомления через WebSocket", error);
      }

      amiLog.success("Уведомление о звонке отправлено пользователю", {
        callId: newCallId,
        channel: channel,
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
    callData.callId = newCallId;

    // Помечаем звонок как обработанный
    callData.processed = true;

    amiLog.info("Звонок обработан и помечен как processed", {
      callId: newCallId,
      channel: channel,
      callData: { ...callData },
    });
  } catch (error) {
    amiLog.error("Ошибка при обработке входящего звонка", error);
  }
};

// Обработка принятого звонка
const processCallAnswered = async (channel, uniqueId) => {
  const callData = callDataMap.get(channel);
  if (!callData) {
    amiLog.warning("Данные звонка не найдены для канала", { channel });
    return;
  }

  // Проверяем Uniqueid, если он есть
  if (uniqueId && callData.uniqueId && uniqueId !== callData.uniqueId) {
    amiLog.warning("Uniqueid не совпадает для Answer", {
      channel: channel,
      eventUniqueId: uniqueId,
      callDataUniqueId: callData.uniqueId,
    });
    return;
  }

  amiLog.info("Обработка принятого звонка", {
    channel: channel,
    callData: { ...callData },
  });

  if (!callData.callId) {
    amiLog.warning("Нет ID звонка для обновления статуса", { channel });
    return;
  }

  try {
    const answeredAt = new Date().toISOString();

    await safeQuery(
      `UPDATE calls SET 
       status = 'answered', 
       answered_at = $1 
       WHERE id = $2`,
      [answeredAt, callData.callId],
      "обновление статуса звонка на 'answered'"
    );

    amiLog.success("Звонок отмечен как принятый", {
      callId: callData.callId,
      channel: channel,
      answeredAt,
    });
  } catch (error) {
    amiLog.error("Ошибка при обновлении статуса звонка", error);
  }
};

// Обработка завершения звонка
const processCallEnd = async (channel, uniqueId, hangupCause) => {
  const callData = callDataMap.get(channel);
  if (!callData) {
    amiLog.warning("Данные звонка не найдены для канала", { channel });
    return;
  }

  // Проверяем Uniqueid, если он есть
  if (uniqueId && callData.uniqueId && uniqueId !== callData.uniqueId) {
    amiLog.warning("Uniqueid не совпадает для Hangup", {
      channel: channel,
      eventUniqueId: uniqueId,
      callDataUniqueId: callData.uniqueId,
    });
    return;
  }

  amiLog.info("Обработка завершения звонка", {
    channel: channel,
    callData: { ...callData },
  });

  if (!callData.callerNumber || !callData.receiverNumber) {
    amiLog.warning("Звонок завершен с неполными данными, пропускаем", {
      channel: channel,
      caller: callData.callerNumber,
      receiver: callData.receiverNumber,
    });
    callDataMap.delete(channel);
    return;
  }

  try {
    const endedAt = new Date().toISOString();

    if (callData.callId) {
      // Проверяем текущий статус звонка
      const callStatusResult = await safeQuery(
        `SELECT status, answered_at FROM calls WHERE id = $1`,
        [callData.callId],
        "проверка статуса звонка"
      );

      if (callStatusResult.rows.length > 0) {
        const currentStatus = callStatusResult.rows[0].status;
        const answeredAt = callStatusResult.rows[0].answered_at;

        if (currentStatus === "incoming" && !answeredAt) {
          // Проверяем причину завершения для определения пропущенного звонка
          const isMissedCall =
            hangupCause === "NO ANSWER" ||
            hangupCause === "16" || // NO ANSWER в Asterisk
            hangupCause === "17" || // USER BUSY
            hangupCause === "19" || // NO USER RESPONSE
            hangupCause === "21" || // CALL REJECTED
            hangupCause === "102" || // RECOVERY ON TIMER EXPIRE
            !hangupCause; // Если причина не указана, считаем пропущенным

          if (isMissedCall) {
            // Звонок не был принят - помечаем как пропущенный
            await safeQuery(
              `UPDATE calls SET 
               status = 'missed',
               ended_at = $1
               WHERE id = $2`,
              [endedAt, callData.callId],
              "помечаем звонок как пропущенный"
            );

            amiLog.success("Звонок помечен как пропущенный", {
              callId: callData.callId,
              channel: channel,
              caller: callData.callerNumber,
              receiver: callData.receiverNumber,
              endedAt,
              hangupCause,
            });

            // Отправляем уведомление о пропущенном звонке
            await sendMissedCallNotification({
              ...callData,
              id: callData.callId,
            });
          } else {
            // Звонок был завершен по другой причине (например, отменен)
            await safeQuery(
              `UPDATE calls SET 
               status = 'cancelled',
               ended_at = $1
               WHERE id = $2`,
              [endedAt, callData.callId],
              "помечаем звонок как отмененный"
            );

            amiLog.success("Звонок помечен как отмененный", {
              callId: callData.callId,
              channel: channel,
              caller: callData.callerNumber,
              receiver: callData.receiverNumber,
              endedAt,
              hangupCause,
            });
          }
        } else {
          // Звонок был принят - завершаем нормально
          await safeQuery(
            `UPDATE calls SET 
             status = 'completed',
             ended_at = $1,
             duration = EXTRACT(EPOCH FROM ($1::timestamp - accepted_at::timestamp))
             WHERE id = $2`,
            [endedAt, callData.callId],
            "завершение звонка"
          );

          amiLog.success("Звонок завершен", {
            callId: callData.callId,
            channel: channel,
            caller: callData.callerNumber,
            receiver: callData.receiverNumber,
            endedAt,
          });

          // Отправляем уведомление о завершении звонка
          await sendCallEndedNotification(callData.callId, callData);
        }

        // Получаем информацию о записи звонка
        if (callData.channel) {
          await getCallRecording(callData.channel, callData.callId);
        }
      }
    } else {
      // Если нет ID звонка, создаем новую запись
      const assignedUser = await getUserByPhone(callData.receiverNumber);
      const callerCompany = await getCompanyByPhone(callData.callerNumber);

      // Определяем статус на основе причины завершения
      const isMissedCall =
        hangupCause === "NO ANSWER" ||
        hangupCause === "16" || // NO ANSWER в Asterisk
        hangupCause === "17" || // USER BUSY
        hangupCause === "19" || // NO USER RESPONSE
        hangupCause === "21" || // CALL REJECTED
        hangupCause === "102" || // RECOVERY ON TIMER EXPIRE
        !hangupCause; // Если причина не указана, считаем пропущенным

      const callStatus = isMissedCall ? "missed" : "cancelled";

      const result = await safeQuery(
        `INSERT INTO calls (
          caller_number, 
          receiver_number, 
          accepted_at, 
          status, 
          assigned_user_id,
          caller_company_id,
          channel_id,
          ended_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          callData.callerNumber,
          callData.receiverNumber,
          callData.timestamp,
          callStatus,
          assignedUser?.id || null,
          callerCompany?.id || null,
          callData.channel,
          endedAt,
        ],
        `запись ${callStatus} звонка`
      );

      const newCallId = result.rows[0].id;

      amiLog.success(
        `${
          callStatus === "missed" ? "Пропущенный" : "Отмененный"
        } звонок записан`,
        {
          callId: newCallId,
          channel: channel,
          caller: callData.callerNumber,
          receiver: callData.receiverNumber,
          endedAt,
          hangupCause,
        }
      );

      // Отправляем уведомление только для пропущенных звонков
      if (isMissedCall) {
        await sendMissedCallNotification({
          ...callData,
          id: newCallId,
        });
      }
    }
  } catch (error) {
    amiLog.error("Ошибка при обработке завершения звонка", error);
  } finally {
    // Отправляем call-ended уведомление только если звонок не был обработан выше
    // и у нас есть callId
    try {
      if (callData.callId && !callData.processed) {
        await sendCallEndedNotification(callData.callId, {
          callerNumber: callData.callerNumber,
          receiverNumber: callData.receiverNumber,
          timestamp: callData.timestamp,
          duration: 0,
          status: "completed",
        });
      }
    } catch (notificationError) {
      amiLog.error(
        "Ошибка отправки дополнительного уведомления call-ended",
        notificationError
      );
    }

    amiLog.info("Сброс данных звонка после завершения", {
      channel: channel,
      finalCallData: { ...callData },
    });

    // Удаляем канал с задержкой, чтобы обработать все события
    setTimeout(() => {
      if (callDataMap.has(channel)) {
        callDataMap.delete(channel);
        amiLog.info("Канал удален из Map", { channel });
      }
    }, 5000); // 5 секунд задержки
  }
};

// Функция получения информации о записи звонка
const getCallRecording = async (channelId, callId) => {
  try {
    // Получаем информацию о записи через AMI
    const recordingInfo = await getRecordingInfoFromAMI(channelId);

    if (recordingInfo.success && recordingInfo.recordingPath) {
      // Обновляем запись в БД с путем к аудиофайлу
      await safeQuery(
        `UPDATE calls SET recording_url = $1, recording_status = 'available' WHERE id = $2`,
        [recordingInfo.recordingPath, callId],
        "обновление пути к записи звонка"
      );

      amiLog.success("Информация о записи обновлена", {
        callId,
        recordingPath: recordingInfo.recordingPath,
        channelId,
      });
    } else {
      // Записываем причину отсутствия записи
      const reason = recordingInfo.reason || "Неизвестная причина";
      await safeQuery(
        `UPDATE calls SET recording_status = 'unavailable', recording_reason = $1 WHERE id = $2`,
        [reason, callId],
        "обновление статуса записи звонка"
      );

      amiLog.warning("Запись звонка недоступна", {
        callId,
        channelId,
        reason,
      });
    }
  } catch (error) {
    amiLog.error("Ошибка при получении информации о записи", error);

    // В случае ошибки также обновляем статус
    try {
      await safeQuery(
        `UPDATE calls SET recording_status = 'error', recording_reason = $1 WHERE id = $2`,
        [error.message, callId],
        "обновление статуса записи при ошибке"
      );
    } catch (dbError) {
      amiLog.error("Ошибка при обновлении статуса записи", dbError);
    }
  }
};

// Получение информации о записи через AMI
const getRecordingInfoFromAMI = (channelId) => {
  return new Promise((resolve) => {
    // Создаем уникальный ActionID для отслеживания ответа
    const actionId = `getrecording_${Date.now()}`;
    const command = `Action: GetVar\r\nActionID: ${actionId}\r\nChannel: ${channelId}\r\nVariable: RECORDED_FILE\r\n\r\n`;

    // Временный обработчик для этого конкретного запроса
    const handleResponse = (data) => {
      const response = data.toString();

      // Проверяем, что это ответ на наш запрос
      if (response.includes(`ActionID: ${actionId}`)) {
        if (response.includes("Value: ")) {
          const recordingPath = response.split("Value: ")[1].trim();
          client.removeListener("data", handleResponse);
          resolve({ recordingPath, channelId, success: true });
        } else if (response.includes("Response: Error")) {
          client.removeListener("data", handleResponse);
          resolve({
            recordingPath: null,
            channelId,
            success: false,
            reason: "Запись не найдена",
          });
        }
      }
    };

    client.on("data", handleResponse);
    client.write(command);

    // Таймаут на случай, если ответ не придет
    setTimeout(() => {
      client.removeListener("data", handleResponse);
      resolve({
        recordingPath: null,
        channelId,
        success: false,
        reason: "Таймаут ответа AMI",
      });
    }, 5000);
  });
};

// Функция для получения аудиофайла записи через AMI
const getRecordingAudio = async (recordingPath) => {
  try {
    // Если Asterisk доступен по HTTP, используем ARI
    if (recordingPath.startsWith("http")) {
      const response = await fetch(recordingPath);
      return await response.arrayBuffer();
    }

    // Если путь относительный, добавляем базовый путь Asterisk
    if (!recordingPath.startsWith("/") && !recordingPath.startsWith("http")) {
      // Предполагаем, что записи хранятся в /var/spool/asterisk/monitor/
      recordingPath = `/var/spool/asterisk/monitor/${recordingPath}`;
    }

    // Читаем файл напрямую с сервера Asterisk
    // В реальной среде здесь может быть SSH или другой способ доступа
    const fs = await import("fs");

    // Проверяем существование файла
    if (!fs.existsSync(recordingPath)) {
      amiLog.warning("Файл записи не найден", { recordingPath });
      return null;
    }

    const audioBuffer = fs.readFileSync(recordingPath);
    return audioBuffer;
  } catch (error) {
    amiLog.error("Ошибка при получении аудиофайла", error);
    return null;
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
