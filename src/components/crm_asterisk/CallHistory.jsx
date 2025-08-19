import React from 'react';
import { Phone, PhoneIncoming, PhoneOff, Clock, MessageSquare, User, Search, Play, Pause, Volume2 } from 'lucide-react';

const CallHistory = ({ calls, onCallSelect, loading, error }) => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState('all');
  const [playingRecording, setPlayingRecording] = React.useState(null);
  const [audioRefs, setAudioRefs] = React.useState({});
  
  const filteredCalls = (calls || []).filter(call => {
    const matchesSearch = call.caller_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         call.notes?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         call.customerName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || call.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'accepted':
        return <PhoneIncoming size={16} />;
      case 'rejected':
        return <PhoneOff size={16} />;
      case 'missed':
        return <Phone size={16} />;
      default:
        return <Phone size={16} />;
    }
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

  const handlePlayRecording = (call, event) => {
    event.stopPropagation();
    
    if (!call.recording_url) {
      alert('Запись недоступна');
      return;
    }

    if (playingRecording === call.id) {
      // Остановить воспроизведение
      const audio = audioRefs[call.id];
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      setPlayingRecording(null);
    } else {
      // Остановить другие записи
      Object.values(audioRefs).forEach(audio => {
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
      });
      
      // Начать воспроизведение
      const audio = new Audio(call.recording_url);
      audio.onended = () => setPlayingRecording(null);
      audio.onerror = () => {
        alert('Ошибка воспроизведения записи');
        setPlayingRecording(null);
      };
      
      setAudioRefs(prev => ({ ...prev, [call.id]: audio }));
      audio.play();
      setPlayingRecording(call.id);
    }
  };

  return (
    <div className="call-history">
      <div className="call-history__header">
        <Clock size={20} />
        <h2>История звонков</h2>
        <span className="count">({filteredCalls.length})</span>
      </div>

      {/* Search and Filters */}
      <div className="call-history__filters">
        <div className="search-input">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Поиск по номеру, имени или заметкам..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={loading}
          />
        </div>
        
        <div className="filter-buttons">
          {[
            { value: 'all', label: 'Все', count: (calls || []).length },
            { value: 'accepted', label: 'Принятые', count: (calls || []).filter(c => c.status === 'accepted').length },
            { value: 'rejected', label: 'Отклоненные', count: (calls || []).filter(c => c.status === 'rejected').length },
            { value: 'missed', label: 'Пропущенные', count: (calls || []).filter(c => c.status === 'missed').length }
          ].map(filter => (
            <button
              key={filter.value}
              onClick={() => setFilterStatus(filter.value)}
              className={`btn btn--small ${
                filterStatus === filter.value ? 'btn--primary' : 'btn--secondary'
              }`}
              disabled={loading}
            >
              {filter.label} ({filter.count})
            </button>
          ))}
        </div>
      </div>

      <div className="call-history__list">
        {loading ? (
          <div className="call-history__empty">
            <Clock className="icon" />
            <p>Загрузка истории звонков...</p>
          </div>
        ) : error ? (
          <div className="call-history__empty">
            <Phone className="icon" />
            <p>Ошибка загрузки: {error}</p>
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="call-history__empty">
            <Phone className="icon" />
            <p>
              {searchTerm || filterStatus !== 'all' 
                ? 'Ничего не найдено' 
                : calls && calls.length === 0 
                  ? 'История звонков пуста' 
                  : 'Нет записей о звонках'
              }
            </p>
          </div>
        ) : (
          filteredCalls.map((call) => (
            <div
              key={call.id}
              onClick={() => onCallSelect(call)}
              className={`call-item call-item--${call.status}`}
            >
              <div className="call-item__content">
                <div className="call-item__left">
                  <div className="call-item__avatar">
                    <User size={20} />
                  </div>
                  
                  <div className="call-item__info">
                    <div className="caller">
                      <span>{call.caller_number || 'Неизвестный'}</span>
                      {getStatusIcon(call.status)}
                    </div>
                    <div className="receiver">
                      → {call.receiver_number || 'Ваш номер'}
                    </div>
                    {call.notes && (
                      <div className="notes">
                        <MessageSquare size={12} />
                        <span className="text">{call.notes}</span>
                      </div>
                    )}
                    {call.customerName && (
                      <div className="customer-info">
                        {call.customerName}
                        {call.company && ` • ${call.company}`}
                      </div>
                    )}
                    {call.duration && call.duration > 0 && (
                      <div className="duration">
                        Длительность: {Math.floor(call.duration / 60)}:{(call.duration % 60).toString().padStart(2, '0')}
                      </div>
                    )}
                  </div>
                </div>

                <div className="call-item__right">
                  {call.recording_url && (
                    <div className="call-item__recording">
                      <button
                        onClick={(e) => handlePlayRecording(call, e)}
                        className={`recording-btn ${playingRecording === call.id ? 'playing' : ''}`}
                        title={playingRecording === call.id ? 'Остановить запись' : 'Прослушать запись'}
                      >
                        {playingRecording === call.id ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                    </div>
                  )}
                  <div className="date">
                    {new Date(call.accepted_at).toLocaleDateString('ru-RU')}
                  </div>
                  <div className="time">
                    {new Date(call.accepted_at).toLocaleTimeString('ru-RU', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </div>
                  <div className={`status status--${call.status}`}>
                    {getStatusText(call.status)}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CallHistory;