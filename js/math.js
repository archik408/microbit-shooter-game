/**
 * Общие математические хелперы игрового кода: без состояния и зависимостей,
 * нижний слой — импортируется game/input/render (см. ARCHITECTURE.md).
 */

/** Ограничить value диапазоном [min, max]. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Линейная интерполяция a → b по доле t (0..1). */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Случайное вещественное число в [min, max). */
export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
