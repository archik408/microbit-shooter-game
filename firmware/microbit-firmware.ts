/**
 * Прошивка «Защитник Неба» для BBC micro:bit (MakeCode TypeScript), USB-вариант.
 *
 * Как залить: открыть https://makecode.microbit.org → новый проект →
 * переключиться в JavaScript → вставить этот файл → Download →
 * скопировать полученный .hex на подключённую плату (она монтируется как флешка).
 * Игра общается с платой по USB-кабелю через Web Serial (115200 бод).
 *
 * Протокол (строки, разделитель \n):
 *   A:<roll>,<pitch>  — углы наклона, ~10 раз в секунду (управление прицелом)
 *   FIRE              — нажаты кнопки A+B (выстрел)
 *   START             — встряхивание платы (старт партии)
 *   BEEP (входящая)   — короткий гудок 147 Гц при сбитии самолёта
 */

// Скорость виртуального COM-порта; задаём явно, хотя это и значение по умолчанию.
serial.setBaudRate(BaudRate.BaudRate115200);

// Признак того, что прошивка жива: алмаз на старте.
basic.showIcon(IconNames.Diamond);

// Поток наклонов для прицела. 100 мс — компромисс между отзывчивостью
// и загрузкой USB-порта.
basic.forever(function () {
  serial.writeLine('A:' + input.rotation(Rotation.Roll) + ',' + input.rotation(Rotation.Pitch));
  basic.pause(100);
});

input.onButtonPressed(Button.AB, function () {
  serial.writeLine('FIRE');
});

input.onGesture(Gesture.Shake, function () {
  serial.writeLine('START');
});

// Короткий тон в фоне: длинная мелодия UntilDone тормозит поток наклонов.
serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
  const cmd = serial.readUntil(serial.delimiters(Delimiters.NewLine));
  if (cmd == 'BEEP') {
    music.play(
      music.tonePlayable(147, music.beat(BeatFraction.Whole)),
      music.PlaybackMode.InBackground,
    );
  }
});
