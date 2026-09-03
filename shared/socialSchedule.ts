/** Resolve a wall-clock date/time in an IANA zone to its UTC instant. This is
 * for validation and storage; Zernio receives the original wall-clock text. */
export function zonedDateTimeToIso(date: string, time: string, timeZone: string): string {
  const match = `${date}T${time}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Fecha y hora de programación inválidas");
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, hour12: false, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { throw new Error("Zona horaria inválida"); }
  const displayed = Object.fromEntries(formatter.formatToParts(new Date(wallUtc)).map(part => [part.type, part.value]));
  const displayedUtc = Date.UTC(
    Number(displayed.year), Number(displayed.month) - 1, Number(displayed.day),
    Number(displayed.hour) % 24, Number(displayed.minute),
  );
  const instant = new Date(wallUtc - (displayedUtc - wallUtc));
  const verified = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  if (Number(verified.year) !== year || Number(verified.month) !== month || Number(verified.day) !== day
    || Number(verified.hour) % 24 !== hour || Number(verified.minute) !== minute) {
    throw new Error("Esa hora no existe en la zona seleccionada por el cambio horario");
  }
  return instant.toISOString();
}

/** Zernio interprets this wall clock using the separate `timezone` field. */
export function zernioScheduledFor(date: string, time: string, timeZone: string): string {
  zonedDateTimeToIso(date, time, timeZone);
  return `${date}T${time}:00`;
}
