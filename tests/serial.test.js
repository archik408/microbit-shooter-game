import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MICROBIT_USB_PRODUCT_ID,
  MICROBIT_USB_VENDOR_ID,
  MicrobitConnector,
} from '../js/microbit/serial.js';

/** Минимальный фейк SerialPort: открытый порт отличается наличием readable. */
function fakeSerialPort({ info, openImpl } = {}) {
  return {
    getInfo: () =>
      info ?? { usbVendorId: MICROBIT_USB_VENDOR_ID, usbProductId: MICROBIT_USB_PRODUCT_ID },
    open: openImpl ?? vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    readable: null,
    writable: null,
  };
}

/** navigator.serial, достаточный для конструктора и конкретного теста. */
function stubSerial(overrides = {}) {
  vi.stubGlobal('navigator', {
    serial: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getPorts: vi.fn().mockResolvedValue([]),
      ...overrides,
    },
  });
}

beforeEach(() => {
  stubSerial();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MicrobitConnector: разбор строк протокола', () => {
  it('буферизует фрагменты до \\n и не теряет данные между чанками', () => {
    const connector = new MicrobitConnector();
    connector.handleChunk(new TextEncoder().encode('A:12,-3'));
    expect(connector.latest.ts).toBe(-Infinity);

    connector.handleChunk(new TextEncoder().encode('\nFI'));
    expect(connector.latest).toMatchObject({ roll: 12, pitch: -3 });
    expect(connector.latest.ts).not.toBe(-Infinity);

    const onFire = vi.fn();
    connector.on('fire', onFire);
    connector.handleChunk(new TextEncoder().encode('RE\n'));
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('гасит \\r в конце строк (прошивка шлёт CRLF)', () => {
    const connector = new MicrobitConnector();
    connector.handleChunk(new TextEncoder().encode('A:5,-7\r\n'));
    expect(connector.latest).toMatchObject({ roll: 5, pitch: -7 });
  });

  it('распознаёт START как событие и игнорирует мусор', () => {
    const connector = new MicrobitConnector();
    const onStart = vi.fn();
    connector.on('start', onStart);
    connector.handleChunk(new TextEncoder().encode('START\nNOISE\n'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(connector.status).toBe('disconnected');
  });
});

describe('MicrobitConnector: фильтр порта', () => {
  it('принимает только VID+PID micro:bit', () => {
    const connector = new MicrobitConnector();
    expect(connector.isMicrobitPort(fakeSerialPort())).toBe(true);
    expect(
      connector.isMicrobitPort(
        fakeSerialPort({ info: { usbVendorId: MICROBIT_USB_VENDOR_ID, usbProductId: 0x9999 } }),
      ),
    ).toBe(false);
    expect(
      connector.isMicrobitPort(
        fakeSerialPort({ info: { usbVendorId: 0x1234, usbProductId: 0x5678 } }),
      ),
    ).toBe(false);
  });
});

describe('MicrobitConnector: подключение', () => {
  it('отмена диалога (NotFoundError) — не ошибка: резолвится молча', async () => {
    const requestPort = vi.fn().mockRejectedValue(new DOMException('cancelled', 'NotFoundError'));
    stubSerial({ requestPort });
    const connector = new MicrobitConnector();
    const statuses = [];
    connector.on('status', (event) => statuses.push(event.status));

    await expect(connector.connect()).resolves.toBeUndefined();
    expect(connector.status).toBe('disconnected');
    expect(statuses).toEqual(['connecting', 'disconnected']);
  });

  it('занятый порт даёт понятную ошибку', async () => {
    const requestPort = vi
      .fn()
      .mockResolvedValue(
        fakeSerialPort({ openImpl: vi.fn().mockRejectedValue(new Error('busy')) }),
      );
    stubSerial({ requestPort });
    const connector = new MicrobitConnector();

    await expect(connector.connect()).rejects.toThrow('занят');
    expect(connector.status).toBe('error');
  });

  it('при уже открытом порте повторный connect не открывает диалог', async () => {
    const requestPort = vi.fn();
    stubSerial({ requestPort });
    const connector = new MicrobitConnector();
    const port = fakeSerialPort();
    port.readable = { getReader: vi.fn() };
    connector.port = port;
    connector.status = 'connected';

    await connector.connect();
    expect(requestPort).not.toHaveBeenCalled();
  });

  it('send падает без подключения', async () => {
    const connector = new MicrobitConnector();
    await expect(connector.send('BEEP')).rejects.toThrow('не подключён');
  });
});
