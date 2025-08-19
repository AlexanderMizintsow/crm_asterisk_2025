import React, { useState, useEffect } from "react";
import {
  Phone,
  PhoneOff,
  User,
  Clock,
  MessageSquare,
  Save,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Building,
  Tag,
  UserPlus,
  Pause,
  Play,
} from "lucide-react";

const ActiveCallCard = ({ call, onEndCall, onSave, onClose, isVisible }) => {
  // Отладочная информация при изменении пропсов
  useEffect(() => {
    console.log("🔄 ActiveCallCard: пропсы изменились:", {
      isVisible,
      callId: call?.id,
      callStatus: call?.status,
      hasCall: !!call,
    });
  }, [isVisible, call]);

  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [selectedTransferUser, setSelectedTransferUser] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [callData, setCallData] = useState({
    customerName: "",
    company: "",
    email: "",
    callPurpose: "",
    notes: "",
    tags: [],
    priority: "medium",
    followUpDate: "",
    outcome: "",
  });
  const [newTag, setNewTag] = useState("");

  // Отладочная информация при изменении статуса звонка
  useEffect(() => {
    if (call?.status) {
      console.log(
        "🔄 ActiveCallCard: статус звонка изменился на:",
        call.status
      );
      console.log("📋 Полные данные звонка:", call);
    }
  }, [call?.status]);

  useEffect(() => {
    if (!isVisible || !call) return;

    const interval = setInterval(() => {
      if (!isOnHold) {
        setCallDuration((prev) => prev + 1);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isVisible, call, isOnHold]);

  // Загрузка доступных пользователей для перевода
  useEffect(() => {
    if (showTransferModal) {
      fetch("/api/users/available")
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setAvailableUsers(data.data);
          } else {
            console.error("Ошибка загрузки пользователей:", data.error);
            setAvailableUsers([]);
          }
        })
        .catch((error) => {
          console.error("Ошибка загрузки пользователей:", error);
          setAvailableUsers([]);
        });
    }
  }, [showTransferModal]);

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const handleInputChange = (field, value) => {
    setCallData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAddTag = () => {
    if (newTag.trim() && !callData.tags.includes(newTag.trim())) {
      setCallData((prev) => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()],
      }));
      setNewTag("");
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setCallData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }));
  };

  const handleEndCall = () => {
    const finalCallData = {
      ...callData,
      duration: callDuration,
      endTime: new Date().toISOString(),
    };
    onEndCall(call.id, finalCallData);
  };

  const handleClose = () => {
    // Сначала сохраняем данные
    onSave(call.id, callData);
    // Затем закрываем окно
    onClose();
  };

  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    console.log("Микрофон:", !isMuted ? "отключен" : "включен");
  };

  const handleSpeakerToggle = () => {
    setIsSpeakerOn(!isSpeakerOn);
    console.log("Динамик:", !isSpeakerOn ? "включен" : "отключен");
  };

  const handleSave = () => {
    if (call && call.id) {
      onSave(call.id, callData);

      console.log("Сохранение данных звонка:", {
        callId: call.id,
        customerName: callData.customerName,
        company: callData.company,
        notes: callData.notes,
      });
      const saveBtn = document.querySelector(".save-btn");
      if (saveBtn) {
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = "✓ Сохранено!";
        saveBtn.style.background = "#10b981";

        setTimeout(() => {
          saveBtn.innerHTML = originalText;
          saveBtn.style.background = "";
        }, 2000);
      }
    } else {
      console.error("Не удалось сохранить: отсутствует информация о звонке");
    }
  };

  const handleHoldToggle = () => {
    if (!call || !call.id) return;

    const newHoldState = !isOnHold;
    setIsOnHold(newHoldState);

    //***** WEBSOCKET СОБЫТИЕ ДЛЯ ПОСТАНОВКИ НА ОЖИДАНИЕ *****
    if (window.socketEmit) {
      window.socketEmit("hold-call", { callId: call.id, isHold: newHoldState });
    }
    console.log("Статус ожидания изменен:", newHoldState);
  };

  const handleTransferCall = () => {
    if (!selectedTransferUser || !call || !call.id) return;

    //***** WEBSOCKET СОБЫТИЕ ДЛЯ ПЕРЕВОДА ЗВОНКА *****
    if (window.socketEmit) {
      window.socketEmit("transfer-call", {
        callId: call.id,
        targetUserId: selectedTransferUser,
        transferReason,
      });
    }

    console.log("Перевод звонка:", {
      callId: call.id,
      targetUserId: selectedTransferUser,
      transferReason,
    });

    setShowTransferModal(false);
    setSelectedTransferUser("");
    setTransferReason("");
  };

  // Отладочная информация перед рендерингом
  console.log("🎯 ActiveCallCard: проверка рендеринга:", {
    isVisible,
    hasCall: !!call,
    callId: call?.id,
    callStatus: call?.status,
    shouldRender: isVisible && !!call,
  });

  if (!isVisible || !call) {
    console.log("❌ ActiveCallCard: не рендерится - условия не выполнены");
    return null;
  }

  console.log("✅ ActiveCallCard: рендерится!");

  return (
    <div className="active-call-card">
      {/* Header */}
      <div className="active-call-card__header">
        <div className="status">
          <div className="indicator">
            <div
              className={`dot ${
                call.status === "completed" ? "dot--completed" : ""
              }`}
            ></div>
            <span>
              {call.status === "completed"
                ? "Звонок завершен"
                : "Активный звонок"}
            </span>
          </div>
          <div className="duration">
            <Clock size={16} />
            <span>{formatDuration(callDuration)}</span>
          </div>
        </div>

        <div className="caller-info">
          <div className="avatar">
            <User size={24} />
          </div>
          <div className="info">
            <div className="number">{call.caller_number}</div>
            <div className="receiver">→ {call.receiver_number}</div>
          </div>
        </div>
      </div>

      {/* Call Controls */}
      <div className="active-call-card__controls">
        <div className="control-buttons">
          <button
            onClick={handleHoldToggle}
            className={`control-btn control-btn--hold ${
              isOnHold ? "active" : ""
            }`}
            title={isOnHold ? "Снять с ожидания" : "Поставить на ожидание"}
            disabled={!call}
          >
            {isOnHold ? <Play size={20} /> : <Pause size={20} />}
          </button>

          <button
            onClick={handleMuteToggle}
            className={`control-btn control-btn--mute ${
              isMuted ? "active" : ""
            }`}
            title={isMuted ? "Включить микрофон" : "Отключить микрофон"}
            disabled={!call}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          <button
            onClick={handleSpeakerToggle}
            className={`control-btn control-btn--speaker ${
              isSpeakerOn ? "active" : ""
            }`}
            title={isSpeakerOn ? "Отключить динамик" : "Включить динамик"}
            disabled={!call}
          >
            {isSpeakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>

          <button
            onClick={() => setShowTransferModal(true)}
            className="control-btn control-btn--transfer"
            title="Перевести звонок"
            disabled={!call}
          >
            <UserPlus size={20} />
          </button>

          <button
            onClick={handleEndCall}
            className="control-btn control-btn--end"
            title="Завершить звонок"
            disabled={!call}
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>

      {/* Hold Status */}
      {isOnHold && (
        <div className="active-call-card__hold-status">
          <Pause size={16} />
          <span>Звонок на ожидании</span>
        </div>
      )}

      {/* Call Information Form */}
      <div className="active-call-card__form">
        <div className="form-section">
          {/* Customer Info */}
          <div className="form-row">
            <div className="form-group">
              <label>Имя клиента</label>
              <input
                type="text"
                value={callData.customerName}
                onChange={(e) =>
                  handleInputChange("customerName", e.target.value)
                }
                placeholder="Введите имя"
              />
            </div>
            <div className="form-group">
              <label>Компания</label>
              <input
                type="text"
                value={callData.company}
                onChange={(e) => handleInputChange("company", e.target.value)}
                placeholder="Название компании"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={callData.email}
              onChange={(e) => handleInputChange("email", e.target.value)}
              placeholder="email@example.com"
            />
          </div>

          {/* Priority and Purpose */}
          <div className="form-row">
            <div className="form-group priority-select">
              <label>Приоритет</label>
              <select
                value={callData.priority}
                onChange={(e) => handleInputChange("priority", e.target.value)}
              >
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
              </select>
            </div>
            <div className="form-group">
              <label>Цель звонка</label>
              <select
                value={callData.callPurpose}
                onChange={(e) =>
                  handleInputChange("callPurpose", e.target.value)
                }
              >
                <option value="">Выберите цель</option>
                <option value="sales">Продажи</option>
                <option value="support">Поддержка</option>
                <option value="consultation">Консультация</option>
                <option value="complaint">Жалоба</option>
                <option value="other">Другое</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div className="form-group tags-input">
            <label>Теги</label>
            <div className="tags-list">
              {callData.tags.map((tag, index) => (
                <span key={index} className="tag">
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="remove-btn"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="tag-input-row">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
                placeholder="Добавить тег"
              />
              <button type="button" onClick={handleAddTag} className="add-btn">
                <Tag size={16} />
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="form-group">
            <label>Заметки о звонке</label>
            <textarea
              value={callData.notes}
              onChange={(e) => handleInputChange("notes", e.target.value)}
              placeholder="Детали разговора, договоренности, следующие шаги..."
            />
          </div>

          {/* Follow-up */}
          <div className="form-group">
            <label>Дата следующего контакта</label>
            <input
              type="datetime-local"
              value={callData.followUpDate}
              onChange={(e) =>
                handleInputChange("followUpDate", e.target.value)
              }
            />
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="active-call-card__footer">
        <div className="footer-buttons">
          <button onClick={handleSave} className="save-btn">
            <Save size={16} />
            <span>Сохранить</span>
          </button>

          {call?.status === "completed" && (
            <button onClick={handleClose} className="close-btn">
              <span>Завершить и закрыть</span>
            </button>
          )}

          {/* Отладочная информация */}
          {process.env.NODE_ENV === "development" && (
            <div style={{ fontSize: "12px", color: "#666", marginTop: "10px" }}>
              Статус звонка: {call?.status || "неизвестен"}
            </div>
          )}
        </div>

        <div className="save-info">
          {call?.status === "completed" ? (
            <small>
              Звонок завершен. Завершите ввод данных и закройте окно
            </small>
          ) : (
            <small>Данные автоматически сохраняются каждые 30 сек</small>
          )}
        </div>
      </div>

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="transfer-modal">
          <div className="transfer-modal__content">
            <div className="transfer-modal__header">
              <h3>Перевести звонок</h3>
              <button
                onClick={() => setShowTransferModal(false)}
                className="close-btn"
              >
                ×
              </button>
            </div>

            <div className="transfer-modal__form">
              <div className="form-group">
                <label>Выберите сотрудника:</label>
                <select
                  value={selectedTransferUser}
                  onChange={(e) => setSelectedTransferUser(e.target.value)}
                >
                  <option value="">Выберите сотрудника</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.first_name} {user.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Причина перевода:</label>
                <textarea
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Укажите причину перевода звонка..."
                />
              </div>
            </div>

            <div className="transfer-modal__actions">
              <button
                onClick={() => setShowTransferModal(false)}
                className="btn btn--secondary"
              >
                Отмена
              </button>
              <button
                onClick={handleTransferCall}
                disabled={!selectedTransferUser}
                className="btn btn--primary"
              >
                Перевести
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActiveCallCard;
