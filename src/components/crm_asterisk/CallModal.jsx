import React, { useState, useEffect } from "react";
import { Phone, PhoneCall, Clock, X, Building, Bell } from "lucide-react";

const CallModal = ({ call, onClose, isVisible, onCallStarted }) => {
  const [callDuration, setCallDuration] = useState(0);
  const [isRinging, setIsRinging] = useState(true);

  useEffect(() => {
    if (!isVisible || !call) return;

    setIsRinging(true);

    // Звонок автоматически "принимается" через 30 секунд (имитация поднятия трубки)
    const ringTimeout = setTimeout(() => {
      setIsRinging(false);
      if (onCallStarted) {
        onCallStarted(call.id, {
          answeredAt: new Date().toISOString(),
        });
      }
    }, 30000);

    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(ringTimeout);
    };
  }, [isVisible, call, onCallStarted]);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const handleClose = () => {
    setCallDuration(0);
    setIsRinging(false);
    onClose();
  };

  if (!isVisible || !call) return null;

  return (
    <div className="call-modal">
      <div className="call-modal__content">
        {/* Header */}
        <div className="call-modal__header">
          <div className="status">
            <div
              className={`dot ${isRinging ? "dot--ringing" : "dot--active"}`}
            ></div>
            <span>{isRinging ? "Входящий звонок" : "Звонок активен"}</span>
          </div>
          <button onClick={handleClose} className="close-btn">
            <X size={20} />
          </button>
        </div>

        {/* Caller Info */}
        <div className="call-modal__caller">
          <div className="avatar">
            <Bell size={40} className="ringing-icon" />
          </div>

          <h2 className="number">
            {call.caller_number || "Неизвестный номер"}
          </h2>

          {call.caller_company_name && (
            <div className="company">
              <Building size={16} />
              <span>{call.caller_company_name}</span>
            </div>
          )}

          <div className="receiver">
            <Phone size={16} />
            <span>→ {call.receiver_number || "Ваш номер"}</span>
          </div>

          <div className="duration">
            <Clock size={16} />
            <span>{formatDuration(callDuration)}</span>
          </div>
        </div>

        {/* Info Message */}
        <div className="call-modal__info">
          <div className="info-message">
            <PhoneCall size={20} />
            <div>
              <strong>Поднимите трубку стационарного телефона</strong>
              <p>
                Звонок автоматически перейдет в активный режим для ввода данных
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="call-modal__footer">
          {new Date(call.timestamp).toLocaleString("ru-RU")}
        </div>
      </div>
    </div>
  );
};

export default CallModal;
