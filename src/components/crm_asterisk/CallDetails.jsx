import React, { useState } from 'react';
import { User, Phone, Clock, MessageSquare, Save, X, Play, Pause, Volume2, Download } from 'lucide-react';

const CallDetails = ({ call, onClose, onUpdate }) => {
  const [notes, setNotes] = useState(call?.notes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);
  const [audioRef, setAudioRef] = useState(null);

  const handleSave = async () => {
    if (!call) return;
    
    setIsSaving(true);
    try {
      //***** ЗАМЕНИТЕ НА РЕАЛЬНЫЙ API ЗАПРОС *****
      // PUT /api/calls/:id
      // Body: { notes }
      // Response: { success: true, data: updatedCall }
      
      const updatedCall = { ...call, notes };
      onUpdate(updatedCall);
      onClose();
    } catch (error) {
      console.error('Error updating call notes:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePlayRecording = () => {
    if (!call.recording_url) {
      alert('Запись недоступна');
      return;
    }

    if (isPlayingRecording) {
      // Остановить воспроизведение
      if (audioRef) {
        audioRef.pause();
        audioRef.currentTime = 0;
      }
      setIsPlayingRecording(false);
    } else {
      // Начать воспроизведение
      const audio = new Audio(call.recording_url);
      audio.onended = () => setIsPlayingRecording(false);
      audio.onerror = () => {
        alert('Ошибка воспроизведения записи');
        setIsPlayingRecording(false);
      };
      
      setAudioRef(audio);
      audio.play();
      setIsPlayingRecording(true);
    }
  };

  const handleDownloadRecording = () => {
    if (!call.recording_url) {
      alert('Запись недоступна');
      return;
    }
    
    const link = document.createElement('a');
    link.href = call.recording_url;
    link.download = `call_${call.id}_${call.caller_number}_${new Date(call.accepted_at).toISOString().split('T')[0]}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'accepted':
        return 'Принят';
      case 'rejected':
        return 'Отклонен';
      case 'missed':
        return 'Пропущен';
      case 'incoming':
        return 'Входящий';
      default:
        return 'Неизвестно';
    }
  };

  if (!call) return null;

  return (
    <div className="call-details">
      <div className="call-details__content">
        {/* Header */}
        <div className="call-details__header">
          <h2>Детали звонка</h2>
          <button onClick={onClose} className="close-btn">
            <X size={24} />
          </button>
        </div>

        {/* Caller Information */}
        <div className="call-details__caller-info">
          <div className="avatar">
            <User size={32} />
          </div>
          <div className="info">
            <div className="number">
              {call.caller_number || 'Неизвестный номер'}
            </div>
            <div className="receiver">
              <Phone size={16} />
              <span>→ {call.receiver_number || 'Ваш номер'}</span>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="call-details__stats">
          <div className="stat-card">
            <div className="label">
              <Clock size={16} />
              <span>Время</span>
            </div>
            <div className="value">
              {new Date(call.accepted_at).toLocaleString('ru-RU')}
            </div>
          </div>
          
          <div className="stat-card">
            <div className="label">
              <Phone size={16} />
              <span>Статус</span>
            </div>
            <div className="value">
              <span className={`status-badge status-badge--${call.status}`}>
                {getStatusText(call.status)}
              </span>
            </div>
          </div>
        </div>

        {/* Customer Info */}
        {(call.customerName || call.company || call.email) && (
          <div className="call-details__customer-info">
            <div className="name">
              {call.customerName}
              {call.company && ` • ${call.company}`}
            </div>
            {call.email && (
              <div className="email">{call.email}</div>
            )}
          </div>
        )}

        {/* Call Recording */}
        {call.recording_url && (
          <div className="call-details__recording">
            <h3>Запись разговора</h3>
            <div className="recording-controls">
              <button
                onClick={handlePlayRecording}
                className={`btn btn--primary ${isPlayingRecording ? 'playing' : ''}`}
              >
                {isPlayingRecording ? <Pause size={16} /> : <Play size={16} />}
                <span>{isPlayingRecording ? 'Остановить' : 'Прослушать'}</span>
              </button>
              
              <button
                onClick={handleDownloadRecording}
                className="btn btn--secondary"
              >
                <Download size={16} />
                <span>Скачать</span>
              </button>
              
              <div className="recording-info">
                <Volume2 size={16} />
                <span>Длительность: {Math.floor(call.duration / 60)}:{(call.duration % 60).toString().padStart(2, '0')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Notes Section */}
        <div className="call-details__notes">
          <label>
            <MessageSquare size={16} />
            <span>Заметки</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Добавьте заметки о звонке..."
          />
        </div>

        {/* Action Buttons */}
        <div className="call-details__actions">
          <button onClick={onClose} className="btn btn--secondary">
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn btn--primary"
          >
            <Save size={16} />
            <span>{isSaving ? 'Сохранение...' : 'Сохранить'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CallDetails;