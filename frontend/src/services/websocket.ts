import { WebSocketTelemetryMessage } from '../types/telemetry';

type MessageHandler = (msg: WebSocketTelemetryMessage) => void;
type StatusHandler = (status: 'LIVE' | 'RECONNECTING' | 'OFFLINE') => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private reconnectInterval: number = 3000;
  private reconnectTimer: any = null;
  private isExplicitlyClosed: boolean = false;
  private url: string;

  constructor() {
    // Determine WS URL
    if (import.meta.env.VITE_WS_URL) {
      this.url = import.meta.env.VITE_WS_URL;
    } else {
      const loc = window.location;
      const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${protocol}//${loc.host}/ws`;
    }
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    this.notifyStatus('RECONNECTING');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected to', this.url);
        this.notifyStatus('LIVE');
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'telemetry') {
            this.messageHandlers.forEach((handler) => handler(parsed));
          }
        } catch (e) {
          // Ignore non-JSON or ping responses
        }
      };

      this.ws.onclose = () => {
        if (!this.isExplicitlyClosed) {
          console.warn('WebSocket closed. Reconnecting in', this.reconnectInterval, 'ms...');
          this.notifyStatus('RECONNECTING');
          this.scheduleReconnect();
        } else {
          this.notifyStatus('OFFLINE');
        }
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket encountered an error:', err);
        this.ws?.close();
      };
    } catch (err) {
      console.error('Failed to initiate WebSocket connection:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  public subscribe(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  public onStatusChange(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  private notifyStatus(status: 'LIVE' | 'RECONNECTING' | 'OFFLINE') {
    this.statusHandlers.forEach((h) => h(status));
  }

  public disconnect() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsClient = new WebSocketClient();
