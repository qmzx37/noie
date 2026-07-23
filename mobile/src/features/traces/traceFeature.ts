import { addDays, getLocalDateString, parseDateOnly } from "../../noie/dateUtils";

export type DailyLongRecord = {
  id: string;
  dateKey: string;
  title?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export function buildWeeklyTraceDates(selectedDate: string) {
  const selected = parseDateOnly(selectedDate) ?? new Date();
  const weekStart = new Date(selected);
  weekStart.setDate(selected.getDate() - selected.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return getLocalDateString(date);
  });
}

export function shiftTraceDateKey(dateKey: string, dayDelta: number) {
  const baseDate = parseDateOnly(dateKey) ?? new Date();
  return getLocalDateString(addDays(baseDate, dayDelta));
}
