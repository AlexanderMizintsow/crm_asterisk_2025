# Полная интеграция с Asterisk

## Обзор возможностей

Данная CRM система предоставляет полную интеграцию с Asterisk PBX, включая:

- **Мониторинг входящих/исходящих звонков**
- **Запись разговоров с автоматическим сохранением**
- **Управление звонками** (перевод, ожидание, завершение)
- **Привязка звонков к пользователям** по номерам телефонов
- **Определение звонящих** по базе компаний
- **Статистика и аналитика** звонков

## Настройка Asterisk

### 1. Конфигурация Manager Interface (AMI)

Файл `/etc/asterisk/manager.conf`:
```ini
[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0
displayconnects = yes

[crm_manager]
secret = your_secret_password
read = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan
write = system,call,log,verbose,command,agent,user,config,originate,reporting,cdr
```

### 2. Настройка записи звонков

Файл `/etc/asterisk/extensions.conf`:
```ini
[globals]
RECORDING_PATH=/var/spool/asterisk/monitor

[macro-record-call]
exten => s,1,Set(CALLFILENAME=${STRFTIME(${EPOCH},,%Y%m%d-%H%M%S)}-${CALLERID(num)}-${ARG1})
exten => s,n,Monitor(wav,${CALLFILENAME},m)
exten => s,n,Set(CDR(userfield)=${CALLFILENAME})

[from-internal]
; Исходящие звонки
exten => _X.,1,Macro(record-call,${EXTEN})
exten => _X.,n,Dial(SIP/${EXTEN},60)
exten => _X.,n,Hangup()

[from-external] 
; Входящие звонки
exten => _X.,1,Macro(record-call,${EXTEN})
exten => _X.,n,Dial(SIP/${EXTEN},60)
exten => _X.,n,Hangup()

[transfer-context]
; Контекст для переводов звонков
exten => _X.,1,Dial(SIP/${EXTEN})
exten => _X.,n,Hangup()
```

### 3. Настройка SIP каналов

Файл `/etc/asterisk/sip.conf`:
```ini
[general]
context=from-external
allowoverlap=no
bindport=5060
bindaddr=0.0.0.0
srvlookup=yes
disallow=all
allow=ulaw
allow=alaw
allow=gsm

[1001]
type=friend
context=from-internal
host=dynamic
secret=password123
canreinvite=no
nat=yes
qualify=yes

[1002]
type=friend
context=from-internal
host=dynamic
secret=password123
canreinvite=no
nat=yes
qualify=yes
```

## Серверная интеграция

### 1. Структура проекта
```
server/
├── asterisk-server.js     # AMI интеграция
├── websocket-server.js    # WebSocket сервер
├── database-schema.txt    # Схема БД
└── api-endpoints.txt      # API документация
```

### 2. Переменные окружения (.env)
```env
# Режим работы
TEST_MODE=false

# База данных PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=crm_calls
DB_USER=postgres
DB_PASSWORD=your_password

# Asterisk AMI
ASTERISK_HOST=192.168.1.100
ASTERISK_PORT=5038
ASTERISK_USER=crm_manager
ASTERISK_SECRET=your_secret_password

# WebSocket сервер
WEBSOCKET_PORT=3001
WEBSOCKET_CORS_ORIGIN=http://localhost:5173

# Записи звонков
RECORDINGS_PATH=/var/spool/asterisk/monitor
RECORDINGS_URL_BASE=http://localhost:3001/recordings

# JWT для аутентификации
JWT_SECRET=your_jwt_secret_key
```

### 3. Запуск серверов
```bash
# Разработка с автоперезагрузкой
npm run server:dev      # WebSocket сервер
npm run asterisk:dev    # AMI интеграция

# Продакшен
npm run server          # WebSocket сервер
npm run asterisk        # AMI интеграция

# Тестовый режим (без записи в БД)
npm run server:test     # Тестовый WebSocket
npm run asterisk:test   # Тестовый AMI
```

## События Asterisk и их обработка

### 1. Мониторинг событий AMI
```javascript
// Основные события, которые обрабатывает система:

// Newchannel - новый канал создан
Event: Newchannel
Channel: SIP/1001-00000001
CallerIDNum: 1001
CallerIDName: User 1001

// Dial - начало набора номера
Event: Dial
Channel: SIP/1001-00000001
Destination: SIP/1002-00000002

// Hangup - завершение звонка
Event: Hangup
Channel: SIP/1001-00000001
Cause: 16
Cause-txt: Normal Clearing

// MonitorStart - начало записи
Event: MonitorStart
Channel: SIP/1001-00000001

// MonitorStop - окончание записи
Event: MonitorStop
Channel: SIP/1001-00000001
```

### 2. Обработка в коде
```javascript
client.on('data', async (data) => {
  const response = data.toString().split('\r\n');
  
  for (const line of response) {
    if (line.startsWith('Event: Newchannel')) {
      // Обработка нового канала
      currentCall.channel = extractValue(line);
    } else if (line.startsWith('CallerIDNum:')) {
      // Номер звонящего
      currentCall.callerNumber = extractValue(line);
    } else if (line.startsWith('Event: MonitorStart')) {
      // Начало записи
      recordingStarted = true;
    } else if (line.startsWith('Event: Hangup')) {
      // Завершение звонка - сохранение в БД
      await saveCallToDatabase(currentCall);
    }
  }
});
```

## Функции управления звонками

### 1. Перевод звонка
```javascript
// WebSocket событие для перевода
socket.emit('transfer-call', {
  callId: 123,
  targetUserId: 2,
  transferReason: 'Специалист по данному вопросу'
});

// AMI команда для перевода в Asterisk
Action: Redirect
Channel: SIP/1001-00000001
Exten: 1002
Context: transfer-context
Priority: 1
```

### 2. Постановка на ожидание
```javascript
// WebSocket событие
socket.emit('hold-call', {
  callId: 123,
  isHold: true
});

// AMI команды
// Поставить на ожидание
Action: QueuePause
Interface: SIP/1001
Paused: true

// Снять с ожидания  
Action: QueuePause
Interface: SIP/1001
Paused: false
```

### 3. Управление записью
```javascript
// Начать запись
Action: Monitor
Channel: SIP/1001-00000001
File: recording_filename
Format: wav
Mix: true

// Остановить запись
Action: StopMonitor
Channel: SIP/1001-00000001
```

## Интеграция с базой данных

### 1. Основные таблицы
```sql
-- Пользователи системы
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(30),
    last_name VARCHAR(30),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(10) DEFAULT 'offline'
);

-- Телефоны пользователей
CREATE TABLE user_phones (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    phone_number VARCHAR(20) NOT NULL,
    phone_type VARCHAR(20) NOT NULL
);

-- Звонки
CREATE TABLE calls (
    id SERIAL PRIMARY KEY,
    caller_number VARCHAR(20) NOT NULL,
    receiver_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'incoming',
    duration INTEGER DEFAULT 0,
    recording_url VARCHAR(500),
    assigned_user_id INTEGER REFERENCES users(id),
    caller_company_id INTEGER REFERENCES companies(id)
);
```

### 2. Привязка звонков к пользователям
```javascript
// Определение пользователя по номеру телефона
const getUserByPhone = async (phoneNumber) => {
  const result = await pool.query(
    'SELECT user_id FROM user_phones WHERE phone_number = $1',
    [phoneNumber]
  );
  return result.rows[0]?.user_id;
};

// Назначение звонка пользователю
const assignedUserId = await getUserByPhone(currentCall.receiverNumber);
```

## Безопасность и производительность

### 1. Аутентификация
- JWT токены для API запросов
- WebSocket аутентификация при подключении
- Проверка прав доступа к записям звонков

### 2. Оптимизация
- Индексы на часто используемые поля
- Пагинация для больших списков
- Кэширование пользовательских данных
- Сжатие записей звонков

### 3. Мониторинг
- Логирование всех действий
- Метрики производительности
- Отслеживание ошибок подключения к Asterisk

## Тестирование

### 1. Тестовый режим
```bash
# Запуск в тестовом режиме
TEST_MODE=true npm run server:dev
TEST_MODE=true npm run asterisk:dev

# Все операции логируются, но не записываются в БД
# Можно безопасно тестировать на реальных звонках
```

### 2. Симуляция звонков
```javascript
// Кнопка "Тест звонка" в интерфейсе
// Создает виртуальный входящий звонок для тестирования
const simulateIncomingCall = () => {
  const testCall = {
    id: Date.now(),
    caller_number: '+7 (495) 123-45-67',
    receiver_number: '+7 (495) 987-65-43',
    timestamp: new Date().toISOString()
  };
  
  setIncomingCall(testCall);
  setShowCallModal(true);
};
```

## Устранение неполадок

### 1. Проблемы подключения к Asterisk
```bash
# Проверка доступности AMI
telnet asterisk_ip 5038

# Проверка логов Asterisk
tail -f /var/log/asterisk/messages

# Проверка конфигурации
asterisk -rx "manager show connected"
```

### 2. Проблемы с записями
```bash
# Проверка прав доступа
ls -la /var/spool/asterisk/monitor/

# Проверка места на диске
df -h /var/spool/asterisk/

# Тестирование записи
asterisk -rx "core show channels"
```

### 3. Отладка WebSocket
```javascript
// Включение детального логирования
const socket = io(WEBSOCKET_URL, {
  forceNew: true,
  transports: ['websocket'],
  debug: true
});

socket.on('connect_error', (error) => {
  console.error('WebSocket connection error:', error);
});
```

## Масштабирование

### 1. Кластер Asterisk
- Настройка нескольких серверов Asterisk
- Балансировка нагрузки между серверами
- Синхронизация данных между узлами

### 2. База данных
- Репликация PostgreSQL
- Партиционирование таблицы звонков
- Архивирование старых записей

### 3. Файлы записей
- Распределенное хранение записей
- CDN для быстрой доставки
- Автоматическое сжатие и архивирование

Эта документация покрывает все аспекты интеграции с Asterisk и обеспечивает полную функциональность CRM системы управления звонками.