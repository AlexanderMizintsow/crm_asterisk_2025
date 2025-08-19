import { useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

// Конфигурация подключения
const SOCKET_CONFIG = {
  transports: ['websocket', 'polling'],
  timeout: 10000,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  maxReconnectionAttempts: 5,
  forceNew: true
};

const useSocket = (url) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const eventListeners = useRef(new Map());
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    if (!url) {
      console.error('❌ URL для WebSocket не указан');
      return;
    }
    
    console.log('🔌 Подключение к WebSocket:', url);
    
    let socketInstance;
    
    try {
      socketInstance = io(url, SOCKET_CONFIG);
      
      socketInstance.on('connect', () => {
        console.log('✅ WebSocket подключен успешно');
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttempts.current = 0;
      });
      
      socketInstance.on('disconnect', (reason) => {
        console.log('❌ WebSocket отключен:', reason);
        setIsConnected(false);
        
        if (reason === 'io server disconnect') {
          console.log('🔄 Переподключение после отключения сервером');
          socketInstance.connect();
        }
      });
      
      socketInstance.on('connect_error', (error) => {
        reconnectAttempts.current++;
        console.error(`❌ Ошибка подключения WebSocket (попытка ${reconnectAttempts.current}):`, error.message);
        setIsConnected(false);
        setConnectionError(error.message);
        
        if (reconnectAttempts.current >= SOCKET_CONFIG.maxReconnectionAttempts) {
          console.error('❌ Превышено максимальное количество попыток переподключения');
          socketInstance.disconnect();
        }
      });
      
      socketInstance.on('reconnect', (attemptNumber) => {
        console.log(`✅ WebSocket переподключен после ${attemptNumber} попыток`);
        setConnectionError(null);
        reconnectAttempts.current = 0;
      });
      
      socketInstance.on('reconnect_failed', () => {
        console.error('❌ Не удалось переподключиться к WebSocket');
        setConnectionError('Не удалось переподключиться к серверу');
      });
      
      setSocket(socketInstance);
    } catch (error) {
      console.error('❌ Ошибка создания WebSocket:', error.message);
      setConnectionError(error.message);
    }
    
    return () => {
      if (socketInstance) {
        console.log('🔌 Закрытие WebSocket соединения');
        eventListeners.current.clear();
        socketInstance.disconnect();
      }
    };
  }, [url]);

  const emit = useCallback((event, data) => {
    if (!socket) {
      console.warn('⚠️ WebSocket не инициализирован, событие не отправлено:', event);
      return false;
    }
    
    if (!isConnected) {
      console.warn('⚠️ WebSocket не подключен, событие не отправлено:', event);
      return false;
    }
    
    try {
      socket.emit(event, data);
      console.log('📤 Отправлено WebSocket событие:', event, data ? '(с данными)' : '');
      return true;
    } catch (error) {
      console.error('❌ Ошибка отправки WebSocket события:', error.message);
      return false;
    }
  }, [socket, isConnected]);

  const on = useCallback((event, callback) => {
    if (!socket) {
      console.warn('⚠️ WebSocket не инициализирован, слушатель не добавлен:', event);
      return null;
    }
    
    if (typeof callback !== 'function') {
      console.error('❌ Callback должен быть функцией для события:', event);
      return null;
    }
    
    const wrappedCallback = (...args) => {
      try {
        console.log('📥 Получено WebSocket событие:', event, args.length ? '(с данными)' : '');
        callback(...args);
      } catch (error) {
        console.error('❌ Ошибка в обработчике события', event, ':', error.message);
      }
    };
    
    if (socket) {
      socket.on(event, wrappedCallback);
      
      // Сохраняем ссылку на слушатель для очистки
      eventListeners.current.set(event, wrappedCallback);
      
      return () => {
        socket.off(event, wrappedCallback);
        eventListeners.current.delete(event);
      };
    }
    
    return null;
  }, [socket]);

  return { 
    socket, 
    isConnected, 
    connectionError,
    emit, 
    on 
  };
};

export default useSocket;