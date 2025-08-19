import React, { useState, useEffect } from "react";
import { Phone, PhoneCall, Users, Play } from "lucide-react";
import CallModal from "./components/crm_asterisk/CallModal";
import ActiveCallCard from "./components/crm_asterisk/ActiveCallCard";
import CallHistory from "./components/crm_asterisk/CallHistory";
import CallDetails from "./components/crm_asterisk/CallDetails";

import useSocket from "./hooks/useSocket";

import "./styles/main.scss";

// Конфигурация системы
const CONFIG = {
  API_URL: "http://localhost:3771/api",
  WEBSOCKET_URL: "http://localhost:3771",
  TIMEOUT: 10000,
  RETRY_ATTEMPTS: 3,
};

// Утилита для API запросов
const apiRequest = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Превышено время ожидания ответа сервера");
    }
    throw error;
  }
};

function App() {
  const [incomingCall, setIncomingCall] = useState(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [activeCall, setActiveCall] = useState(null);
  const [showActiveCall, setShowActiveCall] = useState(false);
  const [calls, setCalls] = useState([]);
  const [selectedCall, setSelectedCall] = useState(null);
  const [showCallDetails, setShowCallDetails] = useState(false);
  const [activeCalls, setActiveCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [serverStatus, setServerStatus] = useState("checking");

  // ID текущего пользователя (замените на нужный)
  const CURRENT_USER_ID = 14; // Иван Иванов

  const { socket, isConnected, emit, on } = useSocket(CONFIG.WEBSOCKET_URL);

  // Загрузка истории звонков
  useEffect(() => {
    const fetchCalls = async () => {
      if (!CURRENT_USER_ID) {
        setError("ID пользователя не установлен");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setServerStatus("checking");

      try {
        const data = await apiRequest(
          `${CONFIG.API_URL}/calls?userId=${CURRENT_USER_ID}`
        );
        setCalls(data.data || []);
        setServerStatus("online");
        console.log(
          "✅ История звонков загружена:",
          data.data?.length || 0,
          "записей для пользователя",
          CURRENT_USER_ID
        );
      } catch (error) {
        console.error("❌ Ошибка загрузки звонков:", error.message);
        setServerStatus("offline");

        if (error.message.includes("Failed to fetch")) {
          setError(
            "Сервер недоступен. Убедитесь, что сервер запущен на порту 3771"
          );
        } else {
          setError(`Ошибка загрузки данных: ${error.message}`);
        }
        setCalls([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCalls();
  }, []);

  // Проверка статуса сервера
  useEffect(() => {
    if (isConnected && serverStatus !== "online") {
      setServerStatus("online");
    }
  }, [isConnected, serverStatus]);

  // Аутентификация пользователя при подключении
  useEffect(() => {
    if (socket && isConnected) {
      console.log("🔐 Аутентификация пользователя:", CURRENT_USER_ID);
      emit("authenticate", { userId: CURRENT_USER_ID });
    }
  }, [socket, isConnected, emit]);

  // Функция имитации входящего звонка
  const simulateIncomingCall = () => {
    const testNumbers = [
      "+7 (495) 123-45-67",
      "+7 (812) 555-12-34",
      "+7 (903) 777-88-99",
    ];

    const randomCaller =
      testNumbers[Math.floor(Math.random() * testNumbers.length)];
    const newCall = {
      id: Date.now(),
      caller_number: randomCaller,
      receiver_number: "777",
      timestamp: new Date().toISOString(),
      status: "incoming",
      assigned_user_id: CURRENT_USER_ID,
    };

    // Отправляем звонок на сервер
    emit("incoming-call", newCall);

    console.log(
      "🔔 Имитация входящего звонка от:",
      randomCaller,
      "для пользователя",
      CURRENT_USER_ID
    );
  };

  // Обработчик начала активного звонка
  const handleCallStarted = (callId, callData) => {
    console.log("📞 Звонок перешел в активный режим:", callId, callData);

    // Отправляем событие на сервер о принятии звонка
    emit("answer-call", {
      callId: callId,
      action: "accept",
    });

    // Переключаем в активный режим
    const callToActivate = activeCalls.find((call) => call.id === callId);
    if (callToActivate) {
      setActiveCall({
        ...callToActivate,
        status: "active",
      });
      setShowActiveCall(true);
      setShowCallModal(false);
      setIncomingCall(null);
    }
  };

  // Обработчики WebSocket событий
  useEffect(() => {
    if (!socket) return;

    const unsubscribeIncoming = on("incoming-call", (call) => {
      if (!call?.id) return;

      console.log(
        "📞 Входящий звонок:",
        call.caller_number,
        "→",
        call.receiver_number
      );
      console.log("👤 ID назначенного пользователя:", call.assigned_user_id);
      console.log("👤 ID текущего пользователя:", CURRENT_USER_ID);

      // Проверяем, что звонок предназначен текущему пользователю
      if (call.assigned_user_id === CURRENT_USER_ID) {
        setIncomingCall(call);
        setShowCallModal(true);
        setActiveCalls((prev) => [...prev, call]);
        console.log(
          "✅ Звонок назначен текущему пользователю - показываем уведомление"
        );
      } else {
        console.log(
          "❌ Звонок не предназначен текущему пользователю - игнорируем"
        );
      }
    });

    const unsubscribeAnswered = on("call-answered", (data) => {
      if (!data?.callId) return;

      console.log(
        "✅ Звонок обработан сервером:",
        data.action,
        "для",
        data.callId
      );
      console.log("📋 Полные данные события:", data);

      // Обновляем статус в истории звонков
      setCalls((prev) =>
        prev.map((call) =>
          call.id === data.callId
            ? {
                ...call,
                status: data.action === "accept" ? "accepted" : "rejected",
                notes: data.notes || "",
              }
            : call
        )
      );

      // Если звонок отклонен, закрываем модальное окно
      if (data.action !== "accept") {
        setActiveCalls((prev) =>
          prev.filter((call) => call.id !== data.callId)
        );
        setShowCallModal(false);
        setIncomingCall(null);
      }
    });

    const unsubscribeActiveCalls = on("active-calls", (calls) => {
      if (!Array.isArray(calls)) return;
      console.log("📋 Обновлен список активных звонков:", calls.length);
      console.log(
        "📋 ID активных звонков:",
        calls.map((c) => c.id)
      );
      setActiveCalls(calls);
    });

    const unsubscribeNotesUpdated = on("notes-updated", (data) => {
      if (!data?.callId) return;
      console.log("📝 Обновлены заметки для звонка:", data.callId);
      setCalls((prev) =>
        prev.map((call) =>
          call.id === data.callId ? { ...call, notes: data.notes } : call
        )
      );
    });

    // Обработчик завершения звонка от сервера (например, при положении трубки)
    const unsubscribeCallEnded = on("call-ended", (data) => {
      console.log("🎯 ПОЛУЧЕНО СОБЫТИЕ call-ended:", data);

      if (!data?.callId) {
        console.log("❌ Нет callId в данных события call-ended");
        return;
      }

      console.log("📞 Звонок завершен сервером:", data);

      // Если это активный звонок, обновляем его статус, но НЕ закрываем окно
      if (activeCall && activeCall.id === data.callId) {
        console.log("🔄 Обновляем статус активного звонка на 'completed'");
        setActiveCall((prev) => {
          const updated = {
            ...prev,
            status: "completed",
            ended_at: data.endedAt || new Date().toISOString(),
            duration: data.duration || 0,
          };
          console.log("✅ Новый статус активного звонка:", updated.status);
          console.log("✅ Обновленные данные звонка:", {
            id: updated.id,
            status: updated.status,
            ended_at: updated.ended_at,
            duration: updated.duration,
          });
          return updated;
        });
        console.log(
          "💡 Окно активного звонка остается открытым для завершения ввода данных"
        );
      } else {
        console.log("❌ Активный звонок не найден или ID не совпадает");
        console.log("Активный звонок:", activeCall);
        console.log("ID завершенного звонка:", data.callId);
        console.log("🔍 Проверяем все возможные места:");
        console.log("  - incomingCall:", incomingCall?.id);
        console.log(
          "  - activeCalls:",
          activeCalls.map((c) => c.id)
        );
      }

      // Также обновляем статус в списке активных звонков
      setActiveCalls((prev) =>
        prev.map((call) =>
          call.id === data.callId
            ? {
                ...call,
                status: "completed",
                ended_at: data.endedAt || new Date().toISOString(),
                duration: data.duration || 0,
              }
            : call
        )
      );

      // Обновляем статус в истории звонков
      setCalls((prev) =>
        prev.map((call) =>
          call.id === data.callId
            ? {
                ...call,
                status: "completed",
                ended_at: data.endedAt || new Date().toISOString(),
                duration: data.duration || 0,
              }
            : call
        )
      );
    });

    return () => {
      unsubscribeIncoming?.();
      unsubscribeAnswered?.();
      unsubscribeActiveCalls?.();
      unsubscribeNotesUpdated?.();
      unsubscribeCallEnded?.();
    };
  }, [socket, on, incomingCall]);

  const handleAnswerCall = (callId, action, initialData) => {
    if (!callId || !action) return;

    console.log("📞 Обработка ответа на звонок:", action, "для", callId);

    // Если звонок принят, сразу активируем его
    if (action === "accept") {
      console.log("🚀 Немедленная активация звонка:", callId);

      // Ищем звонок в incomingCall или activeCalls
      let callToActivate =
        incomingCall && incomingCall.id === callId
          ? incomingCall
          : activeCalls.find((call) => call.id === callId);

      if (callToActivate) {
        setActiveCall({
          ...callToActivate,
          ...initialData,
          status: "active",
        });
        setShowActiveCall(true);
        setShowCallModal(false);
        setIncomingCall(null);

        // Удаляем из активных звонков
        setActiveCalls((prev) => prev.filter((call) => call.id !== callId));

        console.log("✅ Звонок немедленно активирован");
      } else {
        console.log("❌ Звонок для немедленной активации не найден");
      }
    } else {
      const newCallRecord = {
        ...incomingCall,
        status: "rejected",
        notes: initialData.quickNotes || "",
        accepted_at: new Date().toISOString(),
        ...initialData,
      };
      setCalls((prev) => [newCallRecord, ...prev]);
      setShowCallModal(false);
      setIncomingCall(null);
    }

    emit("answer-call", { callId, action, initialData });
  };

  const handleEndCall = (callId, callData) => {
    if (!callId || !activeCall) return;

    console.log("📞 Завершение звонка:", callId);

    // Обновляем статус активного звонка на "завершен", но НЕ закрываем окно
    setActiveCall((prev) => ({
      ...prev,
      status: "completed",
      ended_at: callData.endTime,
      duration: callData.duration,
    }));

    // Отправляем событие на сервер
    emit("end-call", { callId, callData });
  };

  // Новая функция для ручного закрытия окна активного звонка
  const handleCloseActiveCall = () => {
    if (!activeCall) return;

    console.log("📞 Ручное закрытие окна активного звонка:", activeCall.id);

    // Если звонок завершен, сохраняем его в историю
    if (activeCall.status === "completed") {
      const completedCall = {
        ...activeCall,
        status: "accepted",
        accepted_at: activeCall.answeredAt || new Date().toISOString(),
      };

      setCalls((prev) => [completedCall, ...prev]);
    }

    // Закрываем окно
    setActiveCall(null);
    setShowActiveCall(false);
  };

  const handleSaveActiveCall = (callId, callData) => {
    if (!activeCall || !callId) return;

    console.log("💾 Сохранение данных звонка:", callId);

    setActiveCall((prev) => ({ ...prev, ...callData }));
    emit("update-call-notes", {
      callId,
      notes: callData.notes,
      customerData: callData,
    });
  };

  const handleCallSelect = (call) => {
    if (!call) return;
    setSelectedCall(call);
    setShowCallDetails(true);
  };

  const handleCallUpdate = (updatedCall) => {
    if (!updatedCall?.id) return;
    setCalls((prev) =>
      prev.map((call) => (call.id === updatedCall.id ? updatedCall : call))
    );
  };

  const handleCloseCallModal = () => {
    setShowCallModal(false);
    setIncomingCall(null);
  };

  return (
    <div className="crm-app">
      {/* Header */}
      <header className="crm-header">
        <div className="crm-header__container">
          <div className="crm-header__logo">
            <div className="crm-header__logo-icon">
              <PhoneCall size={24} />
            </div>
            <div className="crm-header__logo-text">
              <h1>Asterisk CRM</h1>
              <p>Система управления звонками</p>
            </div>
          </div>

          <div className="crm-header__controls">
            {/* User Info */}
            <div className="user-info">
              <Users size={16} />
              <span>Иван Иванов (ID: {CURRENT_USER_ID})</span>
              <span className="phone">📞 777</span>
            </div>

            {/* Test Call Button */}
            <button
              onClick={simulateIncomingCall}
              className="btn btn--primary btn--small"
            >
              <Play size={16} />
              <span>Тест звонка</span>
            </button>

            {/* Connection Status */}
            <div
              className={`status-indicator ${
                serverStatus === "online" && isConnected
                  ? "status-indicator--connected"
                  : serverStatus === "checking"
                  ? "status-indicator--warning"
                  : "status-indicator--disconnected"
              }`}
            >
              <div
                className={`status-indicator__dot ${
                  serverStatus === "online" && isConnected
                    ? "status-indicator__dot--green"
                    : serverStatus === "checking"
                    ? "status-indicator__dot--yellow"
                    : "status-indicator__dot--red"
                }`}
              ></div>
              <span>
                {serverStatus === "online" && isConnected
                  ? "Подключено"
                  : serverStatus === "checking"
                  ? "Подключение..."
                  : "Отключено"}
              </span>
            </div>

            {/* Active Calls Counter */}
            {activeCalls.length > 0 && (
              <div className="status-indicator status-indicator--test">
                <Users size={16} />
                <span>Активных: {activeCalls.length}</span>
              </div>
            )}

            {/* Error indicator */}
            {error && (
              <div className="status-indicator status-indicator--error">
                <span title={error}>
                  {error.length > 50 ? `${error.substring(0, 50)}...` : error}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Statistics Cards */}
        <div className="stats-grid">
          <div className="stats-card">
            <div className="stats-card__content">
              <div className="stats-card__info">
                <p>Всего звонков</p>
                <p className="value value--primary">{calls.length}</p>
              </div>
              <Phone className="stats-card__icon" />
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card__content">
              <div className="stats-card__info">
                <p>Принятых</p>
                <p className="value value--success">
                  {calls.filter((call) => call.status === "accepted").length}
                </p>
              </div>
              <PhoneCall className="stats-card__icon" />
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card__content">
              <div className="stats-card__info">
                <p>Пропущенных</p>
                <p className="value value--warning">
                  {calls.filter((call) => call.status === "missed").length}
                </p>
              </div>
              <Phone className="stats-card__icon" />
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card__content">
              <div className="stats-card__info">
                <p>Активных</p>
                <p className="value value--primary">{activeCalls.length}</p>
              </div>
              <Users className="stats-card__icon" />
            </div>
          </div>
        </div>

        {/* Call History */}
        <CallHistory
          calls={calls}
          onCallSelect={handleCallSelect}
          loading={loading}
          error={error}
        />
      </main>

      {/* Modals and Cards */}
      <CallModal
        call={incomingCall}
        onCallStarted={handleCallStarted}
        onClose={handleCloseCallModal}
        isVisible={showCallModal}
      />

      {showCallDetails && (
        <CallDetails
          call={selectedCall}
          onClose={() => setShowCallDetails(false)}
          onUpdate={handleCallUpdate}
        />
      )}

      <ActiveCallCard
        call={activeCall}
        onEndCall={handleEndCall}
        onSave={handleSaveActiveCall}
        onClose={handleCloseActiveCall}
        isVisible={showActiveCall}
      />
    </div>
  );
}

export default App;
