/**
 * Коннектор BBC micro:bit по USB-кабелю (Web Serial) — адаптация референса
 * nextjs-boilerplate/lib/microbit-connector/usb-transport.ts под нужды игры.
 *
 * Браузер открывает виртуальный COM-порт платы (DAPLink/CDC, 115200 бод)
 * и читает/пишет текстовые строки. Протокол идентичен прежнему BLE-варианту
 * (см. firmware/microbit-firmware.ts):
 *   A:<roll>,<pitch>  — углы наклона, ~10 раз в секунду
 *   FIRE              — нажаты кнопки A+B
 *   START             — встряхивание платы
 * От нас на плату:
 *   BEEP              — короткий гудок при сбитии самолёта
 */

/** USB Vendor ID DAPLink-контроллера BBC micro:bit (как в референсе). */
export const MICROBIT_USB_VENDOR_ID = 0x0d28;
/** USB Product ID стандартной платы BBC micro:bit. */
export const MICROBIT_USB_PRODUCT_ID = 0x0204;
/** Скорость виртуального COM-порта micro:bit. */
export const BAUD_RATE = 115200;

export class MicrobitConnector {
  constructor() {
    this.port = null;
    this.reader = null;
    this.lineBuffer = '';
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    /** Последние показания акселерометра и время их получения. */
    this.latest = { roll: 0, pitch: 0, ts: -Infinity };
    this.status = 'disconnected';
    this.listeners = { status: [], fire: [], start: [] };
    /** true, пока мы сами закрываем порт — чтобы читатель не счёл это обрывом. */
    this.closing = false;
    /** Был ли хоть один удачный коннект: для автоподнятия после переподключения USB. */
    this.everConnected = false;

    this.handleSerialDisconnect = this.handleSerialDisconnect.bind(this);
    this.handleSerialConnect = this.handleSerialConnect.bind(this);
    if (MicrobitConnector.isSupported()) {
      navigator.serial.addEventListener('disconnect', this.handleSerialDisconnect);
      navigator.serial.addEventListener('connect', this.handleSerialConnect);
    }
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.serial;
  }

  on(type, callback) {
    if (this.listeners[type]) this.listeners[type].push(callback);
  }

  off(type, callback) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((existing) => existing !== callback);
  }

  /** Полный teardown: снять слушатели и тихо закрыть порт. */
  destroy() {
    if (MicrobitConnector.isSupported()) {
      navigator.serial.removeEventListener('disconnect', this.handleSerialDisconnect);
      navigator.serial.removeEventListener('connect', this.handleSerialConnect);
    }
    this.listeners = { status: [], fire: [], start: [] };
    this.disconnect().catch(() => {});
  }

  emit(type, payload) {
    for (const callback of this.listeners[type]) callback(payload);
  }

  setStatus(status, message = null) {
    this.status = status;
    this.emit('status', { status, message });
  }

  isConnected() {
    return Boolean(this.port?.readable);
  }

  /** Ручное подключение: диалог выбора порта (требует клика пользователя). */
  async connect() {
    if (!MicrobitConnector.isSupported()) {
      throw new Error('Web Serial не поддерживается этим браузером — играйте с клавиатуры');
    }
    // Уже подключены — не даём открыть второй порт и не смешиваем читателей,
    // но переэмитим статус, чтобы UI-чип не застрял в «подключении…».
    if (this.isConnected()) {
      this.setStatus(this.status);
      return;
    }

    this.setStatus('connecting');
    try {
      const port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: MICROBIT_USB_VENDOR_ID, usbProductId: MICROBIT_USB_PRODUCT_ID }],
      });
      await this.openPort(port);
    } catch (error) {
      // Отмена диалога выбора порта — не ошибка: молча возвращаемся к клавиатуре.
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        this.setStatus('disconnected', 'Выбор порта отменён');
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Не удалось подключиться к micro:bit';
      this.setStatus('error', message);
      throw new Error(message, { cause: error });
    }
  }

  /** Порт принадлежит стандартной плате BBC micro:bit (VID+PID, как в фильтре requestPort). */
  isMicrobitPort(port) {
    const info = port.getInfo?.();
    return (
      info?.usbVendorId === MICROBIT_USB_VENDOR_ID && info?.usbProductId === MICROBIT_USB_PRODUCT_ID
    );
  }

  /**
   * Автоподключение к уже разрешённому ранее порту после перезагрузки страницы.
   * getPorts() не требует жеста пользователя; молча отступаем, если порт занят.
   */
  async autoConnect() {
    if (!MicrobitConnector.isSupported() || this.isConnected()) return false;
    const ports = await navigator.serial.getPorts();
    const port = ports.find((candidate) => this.isMicrobitPort(candidate));
    if (!port) return false;
    try {
      await this.openPort(port);
      return true;
    } catch {
      return false;
    }
  }

  async openPort(port) {
    try {
      await port.open({ baudRate: BAUD_RATE });
    } catch (error) {
      // Чаще всего значит, что порт уже открыт другой вкладкой или монитором порта.
      const reason = error instanceof Error ? `: ${error.message}` : '';
      throw new Error(
        `Не удалось открыть порт micro:bit${reason} — возможно, он занят другой программой`,
        { cause: error },
      );
    }

    this.port = port;
    this.reader = null;
    this.lineBuffer = '';
    this.everConnected = true;
    this.startReading();
    this.setStatus('connected');
  }

  /** Цикл чтения: живёт, пока воткнут кабель; обрыв = выдернули USB. */
  startReading() {
    const port = this.port;
    const run = async () => {
      if (!port.readable) return;
      this.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) return;
          if (value) this.handleChunk(value);
        }
      } catch {
        return;
      } finally {
        try {
          this.reader.releaseLock();
        } catch {
          // lock уже снят при разрыве потока
        }
      }
    };

    run().then(() => {
      if (!this.closing && this.status === 'connected') {
        this.cleanupState();
        this.setStatus('disconnected', 'micro:bit отключён');
      }
    });
  }

  handleChunk(chunk) {
    // Чанк ≠ строка протокола: копим буфер и режем строго по \n (\r гасим trim-ом).
    // stream:true страхует от разреза многобайтовых последовательностей между чанками.
    this.lineBuffer += this.decoder.decode(chunk, { stream: true });
    let newlineIndex = this.lineBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.lineBuffer.indexOf('\n');
    }
  }

  handleLine(line) {
    const accel = /^A:(-?\d+),(-?\d+)$/.exec(line);
    if (accel) {
      // Наклон не рассылаем событием: InputController опрашивает latest напрямую.
      this.latest = { roll: Number(accel[1]), pitch: Number(accel[2]), ts: performance.now() };
      return;
    }
    if (line === 'FIRE') {
      this.emit('fire');
      return;
    }
    if (line === 'START') {
      this.emit('start');
    }
  }

  /** Отправка строки на плату (best-effort, для гудка при сбитии). */
  async send(text) {
    if (!this.isConnected() || !this.port.writable) throw new Error('micro:bit не подключён');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(this.encoder.encode(`${text}\n`));
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    const port = this.port;
    if (!port) return;
    this.closing = true;
    this.everConnected = false;
    try {
      await this.reader?.cancel();
      await port.close();
    } catch {
      // порт уже закрыт — не страшно
    }
    this.closing = false;
    this.cleanupState();
    this.setStatus('disconnected');
  }

  handleSerialDisconnect(event) {
    if (event.target !== this.port) return;
    this.cleanupState();
    this.setStatus('disconnected', 'micro:bit отключён');
  }

  /** Плата снова воткнута в USB — поднимаем соединение без клика пользователя. */
  handleSerialConnect(event) {
    if (this.isConnected() || !this.everConnected) return;
    if (!this.isMicrobitPort(event.target)) return;
    this.openPort(event.target).catch(() => {});
  }

  cleanupState() {
    this.port = null;
    this.reader = null;
    this.lineBuffer = '';
  }
}
