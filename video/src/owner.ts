// Сценарій відео-навчалки власника. Кадри знімає tools/video-capture.js (тестові дані, екран ноутбука).
// Текст озвучки — у src/narration.json (генерує scripts/voice.mjs).
import type { Rect, Step, TourConfig } from "./Tour";
import data from "../public/owner/steps.json";
import voice from "../public/owner/voice/voice.json";

const rectOf = (file: string): Rect =>
  (data.steps.find((x) => x.file === file)?.rect as Rect) ?? null;
const withRects = (steps: Step[]): Step[] =>
  steps.map((s) => ({
    ...s,
    rect: s.rect !== undefined ? s.rect : rectOf(s.img),
  }));

export const owner: TourConfig = {
  folder: "owner",
  voice,
  size: data.size,
  intro: {
    line1: "Огляд сайту",
    line2: "для власника",
    subtitle: "Де що лежить · 2,5 хвилини",
    note: "Покажу головні розділи і як читати цифри. Усі суми у відео — тестові.",
  },
  outro: ["Тепер ти знаєш, де що лежить.", "Успіхів у бізнесі 🚛"],
  steps: withRects([
    {
      img: "step-02.png",
      title: "4 розділи сайту",
      text: "Панель, Рейси, Розрахунки і Витрати — усе в шапці сайту",
    },
    {
      img: "step-03.png",
      title: "Новий рейс",
      text: "Встав заявку з Телеграму — сайт сам візьме суми, маршрут і дату",
      tap: true,
    },
    {
      img: "step-04.png",
      title: "Водії та авто",
      text: "Почни звідси: водії, авто, ТО і страховка — сайт нагадає",
      tap: true,
    },
    {
      img: "step-05.png",
      title: "Ставки",
      text: "Добові, податок, % водія, компаньйона й логіста, Telegram, копія",
      tap: true,
    },
    {
      img: "step-06.png",
      title: "Фільтри",
      text: "Рік, місяць, водій чи авто — усі цифри перерахуються",
    },
    {
      img: "step-07.png",
      title: "Головні цифри",
      text: "Чистий прибуток бізнесу, частка компаньйона і твій прибуток",
    },
    {
      img: data.kpi.file,
      title: "Як порахувано?",
      text: "Натисни на будь-яку цифру — сайт розпише розрахунок по кроках",
      rect: data.kpi.rect,
      tap: true,
      then: "kpi-explain.png",
      dur: 165,
    },
    {
      img: "step-08.png",
      title: "Нагадування по авто",
      text: "Скоро ТО чи кінчається страховка — побачиш заздалегідь",
    },
    {
      img: "step-09.png",
      title: "Борги й прогноз",
      text: "Скільки замовники ще винні і прогноз на поточний місяць",
    },
    {
      img: "step-10.png",
      title: "Графік по місяцях",
      text: "Висота — фрахт, кольори — куди пішли гроші",
    },
    {
      img: "step-11.png",
      title: "Календар авто",
      text: "Де яке авто кожного дня. Клік по вільному дню — ремонт",
    },
    {
      img: "step-12.png",
      title: "Рейси",
      text: "Пошук, Excel, а в кожному рейсі — PDF, дублювати, редагувати",
    },
    {
      img: "step-13.png",
      title: "Розрахунки",
      text: "Хто кому винен: власники авто, компаньйон, водії, замовники",
    },
    {
      img: "step-14.png",
      title: "Витрати бізнесу",
      text: "Бухгалтер, штрафи — мінус твій прибуток, але не частка компаньйона",
    },
    {
      img: "step-15.png",
      title: "Меню «Дані»",
      text: "Звіт PDF за період, Excel і резервна копія",
      tap: true,
    },
    {
      img: "step-16.png",
      title: "Довідка завжди тут",
      text: "Пройти тур ще раз або знайти відповідь на питання",
      tap: true,
    },
  ]),
};
