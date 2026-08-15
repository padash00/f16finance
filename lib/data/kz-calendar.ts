/**
 * Справочники Казахстана: нерабочие праздничные дни и учебный календарь.
 *
 * Оба принёс владелец, оба с указанием источника и статуса проверки. Лежат
 *TypeScript-модулем, а не JSON: Node в тестах требует явного атрибута
 * `with { type: 'json' }`, Next — нет, и на этом расхождении сборка и тесты
 * начинают жить разной жизнью.
 *
 * Что важно знать про данные:
 *
 *   * День Конституции с 01.07.2026 перенесён на 15 марта. Тридцатое августа
 *     больше не праздник — в старом справочнике `kz_holidays` это ещё не
 *     учтено.
 *   * Курбан айт присутствует без дат: он плавает по лунному календарю, и
 *     составитель честно пометил его как требующий подтверждения.
 *   * Влияние на спрос в учебном календаре — оценка составителя, а не
 *     измерение на продажах точки.
 */

export type PublicHolidayEvent = {
  name: string
  category: string
  country?: string
  /** Год, на который событие ожидается: у Курбан айта даты плавают. */
  expected_year?: number | string
  official_start_date: string | null
  official_end_date: string | null
  audience: string
  non_working_day: boolean
  five_day_week?: {
    holiday_dates?: string[]
    transfer_days_off?: string[]
    continuous_rest_period?: { start: string; end: string; days: number } | null
  } | null
  six_day_week?: {
    holiday_dates?: string[]
    transfer_days_off?: string[]
    continuous_rest_period?: { start: string; end: string; days: number } | null
  } | null
  verification_status: string
  source_name: string
  source_url: string
  notes?: string | null
}

export type EducationCalendarEntry = {
  name: string
  type: string
  country?: string
  academic_year?: string
  last_verified_at?: string
  start_date: string
  end_date: string
  education_group: string
  audience: string
  verification_status: string
  source_name: string
  source_url: string
  description: string
  demand_effect: string
  demand_strength: number
  notes?: string | null
}

/** Период, который покрывают оба справочника. */
export const KZ_CALENDAR_PERIOD = {
  "start": "2026-06-01",
  "end": "2027-08-31"
}

export const KZ_PUBLIC_HOLIDAYS: PublicHolidayEvent[] = [
  {
    "name": "День Столицы",
    "category": "state_holiday",
    "official_start_date": "2026-07-06",
    "official_end_date": "2026-07-06",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2026-07-06"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2026-07-04",
        "end": "2026-07-06",
        "days": 3
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2026-07-06"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2026-07-05",
        "end": "2026-07-06",
        "days": 2
      }
    },
    "verification_status": "confirmed",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»; производственный календарь 2026",
    "source_url": "https://www.gov.kz/article/16887?lang=ru",
    "notes": "Общенациональный нерабочий праздничный день."
  },
  {
    "name": "День Республики Казахстан",
    "category": "national_holiday",
    "official_start_date": "2026-10-25",
    "official_end_date": "2026-10-25",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2026-10-25"
      ],
      "transfer_days_off": [
        "2026-10-26"
      ],
      "continuous_rest_period": {
        "start": "2026-10-24",
        "end": "2026-10-26",
        "days": 3
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2026-10-25"
      ],
      "transfer_days_off": [
        "2026-10-26"
      ],
      "continuous_rest_period": {
        "start": "2026-10-25",
        "end": "2026-10-26",
        "days": 2
      }
    },
    "verification_status": "confirmed",
    "source_name": "Производственный календарь Республики Казахстан на 2026 год",
    "source_url": "https://www.gov.kz/article/16887?lang=ru",
    "notes": "25 октября 2026 выпадает на воскресенье; выходной переносится на 26 октября и при пятидневке, и при шестидневке."
  },
  {
    "name": "День Независимости",
    "category": "state_holiday",
    "official_start_date": "2026-12-16",
    "official_end_date": "2026-12-16",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2026-12-16"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2026-12-16",
        "end": "2026-12-16",
        "days": 1
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2026-12-16"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2026-12-16",
        "end": "2026-12-16",
        "days": 1
      }
    },
    "verification_status": "confirmed",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»; производственный календарь 2026",
    "source_url": "https://www.gov.kz/article/16887?lang=ru",
    "notes": "Общенациональный нерабочий праздничный день."
  },
  {
    "name": "Новый год",
    "category": "state_holiday",
    "official_start_date": "2027-01-01",
    "official_end_date": "2027-01-02",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-01-01",
        "2027-01-02"
      ],
      "transfer_days_off": [
        "2027-01-04"
      ],
      "continuous_rest_period": {
        "start": "2027-01-01",
        "end": "2027-01-04",
        "days": 4
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-01-01",
        "2027-01-02"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-01-01",
        "end": "2027-01-03",
        "days": 3
      }
    },
    "verification_status": "preliminary",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "notes": "Даты праздника закреплены законом. Для пятидневки перенос 2 января (суббота) на 4 января рассчитан по действующему правилу совпадения праздника с выходным. Отдельный производственный календарь/спецпереносы на 2027 год на дату проверки не опубликованы."
  },
  {
    "name": "Православное Рождество",
    "category": "statutory_day_off",
    "official_start_date": "2027-01-07",
    "official_end_date": "2027-01-07",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-01-07"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-01-07",
        "end": "2027-01-07",
        "days": 1
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-01-07"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-01-07",
        "end": "2027-01-07",
        "days": 1
      }
    },
    "verification_status": "confirmed",
    "source_name": "Трудовой кодекс Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/K1500000414",
    "notes": "7 января является выходным днем. Автоматический перенос на другой день для этого выходного не применяется."
  },
  {
    "name": "Международный женский день",
    "category": "state_holiday",
    "official_start_date": "2027-03-08",
    "official_end_date": "2027-03-08",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-03-08"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-03-06",
        "end": "2027-03-08",
        "days": 3
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-03-08"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-03-07",
        "end": "2027-03-08",
        "days": 2
      }
    },
    "verification_status": "confirmed",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "notes": "8 марта 2027 приходится на понедельник."
  },
  {
    "name": "День Конституции Республики Казахстан",
    "category": "state_holiday",
    "official_start_date": "2027-03-15",
    "official_end_date": "2027-03-15",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-03-15"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-03-13",
        "end": "2027-03-15",
        "days": 3
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-03-15"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-03-14",
        "end": "2027-03-15",
        "days": 2
      }
    },
    "verification_status": "confirmed",
    "source_name": "Закон РК «О праздниках в Республике Казахстан» в редакции с 01.07.2026",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "notes": "С 1 июля 2026 День Конституции установлен на 15 марта. 30 августа больше не является государственным праздничным выходным."
  },
  {
    "name": "Наурыз мейрамы",
    "category": "state_holiday",
    "official_start_date": "2027-03-21",
    "official_end_date": "2027-03-23",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-03-21",
        "2027-03-22",
        "2027-03-23"
      ],
      "transfer_days_off": [
        "2027-03-24"
      ],
      "continuous_rest_period": {
        "start": "2027-03-20",
        "end": "2027-03-24",
        "days": 5
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-03-21",
        "2027-03-22",
        "2027-03-23"
      ],
      "transfer_days_off": [
        "2027-03-24"
      ],
      "continuous_rest_period": {
        "start": "2027-03-21",
        "end": "2027-03-24",
        "days": 4
      }
    },
    "verification_status": "preliminary",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "notes": "21 марта 2027 — воскресенье; следующий после праздничной серии рабочий день по действующему правилу становится выходным 24 марта. Отдельные спецпереносы 2027 еще могут быть утверждены."
  },
  {
    "name": "Праздник единства народа Казахстана",
    "category": "state_holiday",
    "official_start_date": "2027-05-01",
    "official_end_date": "2027-05-01",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-05-01"
      ],
      "transfer_days_off": [
        "2027-05-03"
      ],
      "continuous_rest_period": {
        "start": "2027-05-01",
        "end": "2027-05-03",
        "days": 3
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-05-01"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-05-01",
        "end": "2027-05-02",
        "days": 2
      }
    },
    "verification_status": "preliminary",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "notes": "1 мая 2027 — суббота. Для стандартной пятидневки ожидается перенос на 3 мая; для шестидневки суббота обычно рабочая, поэтому дополнительного переноса по базовому правилу нет. Спецпереносы 2027 могут изменить схему."
  },
  {
    "name": "День защитника Отечества",
    "category": "state_holiday",
    "official_start_date": "2027-05-07",
    "official_end_date": "2027-05-07",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-05-07"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-05-07",
        "end": "2027-05-10",
        "days": 4
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-05-07"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-05-07",
        "end": "2027-05-07",
        "days": 1
      }
    },
    "verification_status": "preliminary",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "notes": "7 мая — пятница. При пятидневке фактический общий блок отдыха 7–10 мая формируется вместе с выходными и Днем Победы 9 мая/переносом на 10 мая. Спецпереносы 2027 еще не опубликованы."
  },
  {
    "name": "День Победы",
    "category": "state_holiday",
    "official_start_date": "2027-05-09",
    "official_end_date": "2027-05-09",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-05-09"
      ],
      "transfer_days_off": [
        "2027-05-10"
      ],
      "continuous_rest_period": {
        "start": "2027-05-07",
        "end": "2027-05-10",
        "days": 4
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-05-09"
      ],
      "transfer_days_off": [
        "2027-05-10"
      ],
      "continuous_rest_period": {
        "start": "2027-05-09",
        "end": "2027-05-10",
        "days": 2
      }
    },
    "verification_status": "preliminary",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "notes": "9 мая 2027 — воскресенье, поэтому по действующему правилу следующий рабочий день 10 мая становится выходным. Спецпереносы 2027 еще не опубликованы."
  },
  {
    "name": "Первый день Курбан-айта",
    "category": "statutory_day_off",
    "official_start_date": null,
    "official_end_date": null,
    "expected_year": 2027,
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [],
      "transfer_days_off": [],
      "continuous_rest_period": null
    },
    "six_day_week": {
      "holiday_dates": [],
      "transfer_days_off": [],
      "continuous_rest_period": null
    },
    "verification_status": "requires_confirmation",
    "source_name": "Трудовой кодекс Республики Казахстан; дата ежегодно определяется по мусульманскому календарю",
    "source_url": "https://adilet.zan.kz/rus/docs/K1500000414",
    "notes": "Первый день Курбан-айта является выходным, но на дату проверки официальная дата на 2027 год еще не опубликована. Не подставлена неофициальная расчетная дата."
  },
  {
    "name": "День Столицы",
    "category": "state_holiday",
    "official_start_date": "2027-07-06",
    "official_end_date": "2027-07-06",
    "country": "Казахстан",
    "audience": "all",
    "non_working_day": true,
    "five_day_week": {
      "holiday_dates": [
        "2027-07-06"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-07-06",
        "end": "2027-07-06",
        "days": 1
      }
    },
    "six_day_week": {
      "holiday_dates": [
        "2027-07-06"
      ],
      "transfer_days_off": [],
      "continuous_rest_period": {
        "start": "2027-07-06",
        "end": "2027-07-06",
        "days": 1
      }
    },
    "verification_status": "confirmed",
    "source_name": "Закон РК «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "notes": "6 июля 2027 — вторник. Возможные специальные переносы рабочего/выходного дня на 2027 год на дату проверки не опубликованы."
  }
]

export const KZ_EDUCATION_CALENDAR: EducationCalendarEntry[] = [
  {
    "name": "Абитуриенты — основное ЕНТ 2026",
    "type": "Другое",
    "start_date": "2026-05-10",
    "end_date": "2026-07-10",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?custom_news_section=%F0%9F%8E%93%D0%B0%D0%B1%D0%B8%D1%82%D1%83%D1%80%D0%B8%D0%B5%D0%BD%D1%82%D1%8B-2026&lang=ru",
    "description": "Основной период ЕНТ 2026; часть события приходится на окно анализа с 1 июня.",
    "demand_effect": "negative",
    "demand_strength": -1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Событие началось до 01.06.2026, но пересекает заданный период анализа."
  },
  {
    "name": "Первый класс — приём документов 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-05-27",
    "end_date": "2026-08-31",
    "education_group": "school",
    "audience": "будущие первоклассники и родители",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Электронное правительство / Министерство просвещения РК",
    "source_url": "https://www.gov.kz/services/5219",
    "description": "Общереспубликанский период приёма документов в первый класс.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Событие началось до 01.06.2026, но пересекает заданный период анализа."
  },
  {
    "name": "Школы — летние каникулы 2026 (часть окна анализа)",
    "type": "Летние каникулы",
    "start_date": "2026-06-01",
    "end_date": "2026-08-31",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "estimated",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Летний неучебный период перед началом 2026–2027 учебного года.",
    "demand_effect": "positive",
    "demand_strength": 2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Отдельная общереспубликанская дата начала летних каникул в приказе на 2026–2027 не задаётся; запись ограничена окном анализа и подтверждённым началом нового учебного года 1 сентября."
  },
  {
    "name": "Вузы — творческая приёмная кампания 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-06-20",
    "end_date": "2026-08-15",
    "education_group": "university",
    "audience": "абитуриенты творческих направлений",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=15638",
    "description": "Период подачи заявлений и проведения творческих экзаменов.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Подача заявлений — до 10 августа; творческие экзамены проходят 7 июля–15 августа; для конкурса грантов сроки раньше."
  },
  {
    "name": "Вузы — специальные экзамены для педагогических и медицинских направлений 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-06-20",
    "end_date": "2026-08-20",
    "education_group": "university",
    "audience": "абитуриенты педагогических и медицинских направлений",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=15638",
    "description": "Общий период специальных экзаменов для соответствующих направлений.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Для участия в конкурсе государственных грантов действуют более ранние внутренние крайние сроки."
  },
  {
    "name": "Вузы — приём документов 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-06-20",
    "end_date": "2026-08-25",
    "education_group": "university",
    "audience": "абитуриенты вузов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Правила приёма в организации высшего и послевузовского образования",
    "source_url": "https://adilet.zan.kz/rus/docs/V1800017650",
    "description": "Общий период приёма документов и зачисления в вузы по действующим правилам.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Колледжи — приём на творческие специальности 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-06-25",
    "end_date": "2026-07-20",
    "education_group": "college",
    "audience": "абитуриенты творческих специальностей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Электронное правительство Республики Казахстан",
    "source_url": "https://www.gov.kz/services/3288",
    "description": "Общереспубликанский срок приёма документов на творческие специальности.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Колледжи — приём на педагогические и медицинские специальности 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-06-25",
    "end_date": "2026-08-15",
    "education_group": "college",
    "audience": "абитуриенты педагогических и медицинских специальностей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Электронное правительство Республики Казахстан",
    "source_url": "https://www.gov.kz/services/3288",
    "description": "Сводный национальный период для педагогических и медицинских специальностей.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Для педагогических и части медицинских программ крайний срок — 10 августа; для медицинских программ на базе общего среднего/ТиППО/послесреднего образования — до 15 августа."
  },
  {
    "name": "Колледжи — приём на специалистов среднего звена и прикладной бакалавриат 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-06-25",
    "end_date": "2026-08-22",
    "education_group": "college",
    "audience": "абитуриенты колледжей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Электронное правительство Республики Казахстан",
    "source_url": "https://www.gov.kz/services/3288",
    "description": "Общереспубликанский срок по государственному образовательному заказу.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Для платного обучения и отдельных форм обучения сроки могут быть длиннее."
  },
  {
    "name": "Колледжи — приём на рабочие квалификации 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-06-25",
    "end_date": "2026-08-27",
    "education_group": "college",
    "audience": "абитуриенты колледжей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Электронное правительство Республики Казахстан",
    "source_url": "https://www.gov.kz/services/3288",
    "description": "Общереспубликанский срок приёма документов на рабочие квалификации по очной форме.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Для вечерней формы действуют иные сроки, вплоть до 20 сентября."
  },
  {
    "name": "День столицы — длинные выходные 2026",
    "type": "Другое",
    "start_date": "2026-07-04",
    "end_date": "2026-07-06",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Производственный календарь Республики Казахстан на 2026 год",
    "source_url": "https://www.gov.kz/article/16887?lang=ru",
    "description": "День столицы 6 июля; для пятидневной рабочей недели образуется трёхдневный период с обычными выходными.",
    "demand_effect": "positive",
    "demand_strength": 2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Государственные образовательные гранты — подача заявлений 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-07-13",
    "end_date": "2026-07-20",
    "education_group": "applicant",
    "audience": "абитуриенты вузов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=15638",
    "description": "Приём заявлений на конкурс государственных образовательных грантов.",
    "demand_effect": "negative",
    "demand_strength": -1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Августовское ЕНТ — регистрация 2026",
    "type": "Приёмная кампания",
    "start_date": "2026-07-25",
    "end_date": "2026-08-05",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Регистрация на августовское ЕНТ.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Государственные образовательные гранты — публикация результатов 2026",
    "type": "Другое",
    "start_date": "2026-08-10",
    "end_date": "2026-08-10",
    "education_group": "applicant",
    "audience": "абитуриенты вузов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Правила присуждения образовательного гранта",
    "source_url": "https://adilet.zan.kz/rus/docs/V2000020939/compare",
    "description": "Предельная дата публикации/оформления результатов конкурса государственных образовательных грантов.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "По действующим правилам приказ о присуждении грантов издаётся до 10 августа."
  },
  {
    "name": "Абитуриенты — августовское ЕНТ 2026",
    "type": "Другое",
    "start_date": "2026-08-10",
    "end_date": "2026-08-14",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство науки и высшего образования Республики Казахстан",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Фактический период августовского ЕНТ 2026 по актуальному сообщению министерства.",
    "demand_effect": "negative",
    "demand_strength": -1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Более раннее сообщение НЦТ указывало срок до 15 августа; использован более поздний официальный срок министерства — до 14 августа."
  },
  {
    "name": "Колледжи — начало учебного года",
    "type": "Начало учебного года",
    "start_date": "2026-09-01",
    "end_date": "2026-09-01",
    "education_group": "college",
    "audience": "студенты колледжей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Государственный общеобязательный стандарт технического и профессионального образования",
    "source_url": "https://adilet.zan.kz/rus/docs/V2200028716",
    "description": "По государственному стандарту учебный год начинается 1 сентября.",
    "demand_effect": "negative",
    "demand_strength": -2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Школы — начало учебного года 2026–2027",
    "type": "Начало учебного года",
    "start_date": "2026-09-01",
    "end_date": "2026-09-01",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Официальное начало 2026–2027 учебного года в школах Казахстана.",
    "demand_effect": "negative",
    "demand_strength": -2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Студенты вузов — массовое начало учебного периода",
    "type": "Начало учебного года",
    "start_date": "2026-09-01",
    "end_date": "2026-09-15",
    "education_group": "university",
    "audience": "студенты вузов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "estimated",
    "source_name": "Правила организации учебного процесса по кредитной технологии обучения",
    "source_url": "https://adilet.zan.kz/rus/docs/V1100006976",
    "description": "Ориентировочное общенациональное окно начала занятий в вузах.",
    "demand_effect": "negative",
    "demand_strength": -2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Единой обязательной даты для всех вузов нет: конкретный академический календарь утверждает каждый вуз. Период оставлен только как ориентир для прогноза спроса."
  },
  {
    "name": "Школы — I четверть",
    "type": "Другое",
    "start_date": "2026-09-01",
    "end_date": "2026-10-25",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Первая учебная четверть.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Границы выведены из утверждённых дат начала учебного года и осенних каникул."
  },
  {
    "name": "День Республики — длинные выходные 2026",
    "type": "Другое",
    "start_date": "2026-10-24",
    "end_date": "2026-10-26",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Производственный календарь Республики Казахстан на 2026 год",
    "source_url": "https://www.gov.kz/article/16887?lang=ru",
    "description": "День Республики 25 октября 2026 приходится на воскресенье; выходной переносится на 26 октября при пятидневке.",
    "demand_effect": "positive",
    "demand_strength": 3,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Школы — осенние каникулы",
    "type": "Каникулы",
    "start_date": "2026-10-26",
    "end_date": "2026-11-01",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Официальные осенние каникулы школьников Казахстана.",
    "demand_effect": "positive",
    "demand_strength": 4,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Школы — II четверть",
    "type": "Другое",
    "start_date": "2026-11-02",
    "end_date": "2026-12-27",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Вторая учебная четверть.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Границы выведены из утверждённых дат осенних и зимних каникул."
  },
  {
    "name": "День Независимости 2026",
    "type": "Другое",
    "start_date": "2026-12-16",
    "end_date": "2026-12-16",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "Официальный праздничный нерабочий день — День Независимости.",
    "demand_effect": "positive",
    "demand_strength": 1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Январское ЕНТ 2027 — регистрация",
    "type": "Приёмная кампания",
    "start_date": "2026-12-20",
    "end_date": "2026-12-30",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Регистрация на январское ЕНТ по действующему календарю НЦТ.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Период основан на текущем общим календаре НЦТ и должен быть повторно проверен после публикации объявления именно на 2027 год."
  },
  {
    "name": "Школы — зимние каникулы",
    "type": "Каникулы",
    "start_date": "2026-12-28",
    "end_date": "2027-01-10",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Официальные зимние каникулы школьников Казахстана.",
    "demand_effect": "positive",
    "demand_strength": 4,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Новый год — праздничные выходные 2027",
    "type": "Другое",
    "start_date": "2027-01-01",
    "end_date": "2027-01-04",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "Новый год 1–2 января; при пятидневке 2 января приходится на субботу и даёт перенос.",
    "demand_effect": "positive",
    "demand_strength": 3,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Диапазон рассчитан по действующему закону и пятидневной рабочей неделе; сверить с производственным календарём 2027 после его публикации."
  },
  {
    "name": "Православное Рождество 2027",
    "type": "Другое",
    "start_date": "2027-01-07",
    "end_date": "2027-01-07",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "7 января — нерабочий день в Казахстане.",
    "demand_effect": "positive",
    "demand_strength": 1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Январское ЕНТ 2027",
    "type": "Другое",
    "start_date": "2027-01-10",
    "end_date": "2027-02-10",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Период январского ЕНТ по действующему календарю НЦТ.",
    "demand_effect": "negative",
    "demand_strength": -1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Требуется повторная проверка после отдельного официального объявления НЦТ на 2027 год."
  },
  {
    "name": "Школы — III четверть",
    "type": "Другое",
    "start_date": "2027-01-11",
    "end_date": "2027-03-21",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Третья учебная четверть.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Границы выведены из утверждённых дат зимних и весенних каникул."
  },
  {
    "name": "Первый класс — дополнительные каникулы",
    "type": "Каникулы",
    "start_date": "2027-02-08",
    "end_date": "2027-02-14",
    "education_group": "school",
    "audience": "1 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Дополнительные каникулы для учащихся первых классов.",
    "demand_effect": "positive",
    "demand_strength": 3,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Мартовское ЕНТ 2027 — регистрация",
    "type": "Приёмная кампания",
    "start_date": "2027-02-15",
    "end_date": "2027-02-25",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Регистрация на мартовское ЕНТ по действующему календарю НЦТ.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Повторно проверить после публикации объявления НЦТ на 2027 год."
  },
  {
    "name": "Мартовское ЕНТ 2027",
    "type": "Другое",
    "start_date": "2027-03-01",
    "end_date": "2027-04-06",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Период мартовского ЕНТ по действующему календарю НЦТ.",
    "demand_effect": "negative",
    "demand_strength": -1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Повторно проверить после публикации объявления НЦТ на 2027 год."
  },
  {
    "name": "Международный женский день — длинные выходные 2027",
    "type": "Другое",
    "start_date": "2027-03-06",
    "end_date": "2027-03-08",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "8 марта 2027 приходится на понедельник, образуя трёхдневный период с обычными выходными при пятидневке.",
    "demand_effect": "positive",
    "demand_strength": 2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Сверить с производственным календарём 2027."
  },
  {
    "name": "День Конституции — длинные выходные 2027",
    "type": "Другое",
    "start_date": "2027-03-13",
    "end_date": "2027-03-15",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "День Конституции отмечается 15 марта; в 2027 году это понедельник.",
    "demand_effect": "positive",
    "demand_strength": 2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "С 2026 года День Конституции установлен на 15 марта. Сверить режим выходных с производственным календарём 2027."
  },
  {
    "name": "Наурыз — праздничные выходные 2027",
    "type": "Другое",
    "start_date": "2027-03-20",
    "end_date": "2027-03-24",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "Праздник Наурыз 21–23 марта; 21 марта 2027 приходится на воскресенье, что по действующему правилу даёт перенос.",
    "demand_effect": "positive",
    "demand_strength": 3,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Диапазон рассчитан для пятидневной недели; сверить с производственным календарём 2027."
  },
  {
    "name": "Школы — весенние каникулы",
    "type": "Каникулы",
    "start_date": "2027-03-22",
    "end_date": "2027-03-28",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Официальные весенние каникулы школьников Казахстана.",
    "demand_effect": "positive",
    "demand_strength": 4,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Школы — IV четверть",
    "type": "Другое",
    "start_date": "2027-03-29",
    "end_date": "2027-05-25",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Четвёртая учебная четверть.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Граница завершения совпадает с официальным окончанием учебного года 25 мая."
  },
  {
    "name": "Основное ЕНТ 2027 — регистрация",
    "type": "Приёмная кампания",
    "start_date": "2027-04-10",
    "end_date": "2027-04-25",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Регистрация на основное ЕНТ по действующему календарю НЦТ.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Требуется сверка с отдельным объявлением НЦТ на 2027 год."
  },
  {
    "name": "День единства народа Казахстана — длинные выходные 2027",
    "type": "Другое",
    "start_date": "2027-05-01",
    "end_date": "2027-05-03",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "1 мая 2027 приходится на субботу; по действующему правилу перенос формирует дополнительный выходной.",
    "demand_effect": "positive",
    "demand_strength": 2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Сверить с производственным календарём 2027."
  },
  {
    "name": "День защитника Отечества 2027",
    "type": "Другое",
    "start_date": "2027-05-07",
    "end_date": "2027-05-07",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "Официальный праздничный нерабочий день 7 мая.",
    "demand_effect": "positive",
    "demand_strength": 1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "День Победы — праздник и перенос 2027",
    "type": "Другое",
    "start_date": "2027-05-09",
    "end_date": "2027-05-10",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "9 мая 2027 приходится на воскресенье; по действующему правилу следующий рабочий день становится выходным.",
    "demand_effect": "positive",
    "demand_strength": 2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "В сочетании с 7 мая и обычными выходными образуется длинный майский период; сверить с производственным календарём 2027."
  },
  {
    "name": "Абитуриенты — основное ЕНТ 2027",
    "type": "Другое",
    "start_date": "2027-05-10",
    "end_date": "2027-07-10",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Основной период ЕНТ по действующему календарю НЦТ.",
    "demand_effect": "negative",
    "demand_strength": -1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Требуется повторная проверка после публикации официального объявления НЦТ на 2027 год."
  },
  {
    "name": "Школы — последний учебный день и конец учебного года",
    "type": "Конец учебного года",
    "start_date": "2027-05-25",
    "end_date": "2027-05-25",
    "education_group": "school",
    "audience": "1–11 классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Официальное завершение 2026–2027 учебного года.",
    "demand_effect": "positive",
    "demand_strength": 1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Школы — летние каникулы 2027",
    "type": "Летние каникулы",
    "start_date": "2027-05-26",
    "end_date": "2027-08-31",
    "education_group": "school",
    "audience": "1–10 классы и невыпускные классы",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "estimated",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Летний неучебный период после официального завершения учебного года.",
    "demand_effect": "positive",
    "demand_strength": 2,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Начало следует из даты окончания учебного года 25 мая; конец ограничен заданным окном анализа. Начало следующего учебного года 2027–2028 в использованном приказе не устанавливается."
  },
  {
    "name": "Первый класс — приём документов 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-05-27",
    "end_date": "2027-08-31",
    "education_group": "school",
    "audience": "будущие первоклассники и родители",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Электронное правительство / Министерство просвещения РК",
    "source_url": "https://www.gov.kz/services/5219",
    "description": "Ожидаемый период приёма документов в первый класс по действующим правилам.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Срок 27 мая–31 августа следует из действующих правил; повторно проверить перед стартом кампании 2027."
  },
  {
    "name": "Выпускники 9(10) классов — итоговая аттестация",
    "type": "Другое",
    "start_date": "2027-05-31",
    "end_date": "2027-06-11",
    "education_group": "school",
    "audience": "выпускники 9(10) классов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Официальный период итоговых выпускных экзаменов для 9(10) классов.",
    "demand_effect": "negative",
    "demand_strength": -3,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Выпускники 11(12) классов — итоговая аттестация",
    "type": "Другое",
    "start_date": "2027-06-01",
    "end_date": "2027-06-17",
    "education_group": "school",
    "audience": "выпускники 11(12) классов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Министерство просвещения Республики Казахстан",
    "source_url": "https://adilet.zan.kz/rus/docs/G26HP000213",
    "description": "Официальный период государственной итоговой аттестации для 11(12) классов.",
    "demand_effect": "negative",
    "demand_strength": -3,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Вузы — творческая приёмная кампания 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-06-20",
    "end_date": "2027-08-15",
    "education_group": "university",
    "audience": "абитуриенты творческих направлений",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=15638",
    "description": "Окно творческой приёмной кампании по действующим правилам.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Период основан на действующих ежегодных сроках; требуется повторная проверка для 2027."
  },
  {
    "name": "Вузы — специальные экзамены для педагогических и медицинских направлений 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-06-20",
    "end_date": "2027-08-20",
    "education_group": "university",
    "audience": "абитуриенты педагогических и медицинских направлений",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=15638",
    "description": "Ориентир по действующим правилам для специальных экзаменов.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Повторно проверить после публикации календаря приёмной кампании 2027."
  },
  {
    "name": "Вузы — приём документов 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-06-20",
    "end_date": "2027-08-25",
    "education_group": "university",
    "audience": "абитуриенты вузов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Правила приёма в организации высшего и послевузовского образования",
    "source_url": "https://adilet.zan.kz/rus/docs/V1800017650",
    "description": "Общий период приёма документов в вузы по действующим правилам.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Даты следуют из действующих ежегодных правил; повторно проверить на случай нормативных изменений в 2027 году."
  },
  {
    "name": "Колледжи — приём на творческие специальности 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-06-25",
    "end_date": "2027-07-20",
    "education_group": "college",
    "audience": "абитуриенты творческих специальностей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Электронное правительство Республики Казахстан",
    "source_url": "https://www.gov.kz/services/3288",
    "description": "Окно приёма на творческие специальности по действующим правилам.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Повторно проверить приёмную кампанию 2027."
  },
  {
    "name": "Колледжи — приём на педагогические и медицинские специальности 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-06-25",
    "end_date": "2027-08-15",
    "education_group": "college",
    "audience": "абитуриенты педагогических и медицинских специальностей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Электронное правительство Республики Казахстан",
    "source_url": "https://www.gov.kz/services/3288",
    "description": "Сводный период по действующим национальным правилам.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Для части программ крайний срок 10 августа; для отдельных медицинских программ — 15 августа. Повторно проверить в 2027 году."
  },
  {
    "name": "Колледжи — приём на специалистов среднего звена и прикладной бакалавриат 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-06-25",
    "end_date": "2027-08-22",
    "education_group": "college",
    "audience": "абитуриенты колледжей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Электронное правительство Республики Казахстан",
    "source_url": "https://www.gov.kz/services/3288",
    "description": "Окно приёма по государственному образовательному заказу по действующим правилам.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Повторно проверить приёмную кампанию 2027."
  },
  {
    "name": "Колледжи — приём на рабочие квалификации 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-06-25",
    "end_date": "2027-08-27",
    "education_group": "college",
    "audience": "абитуриенты колледжей",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Электронное правительство Республики Казахстан",
    "source_url": "https://www.gov.kz/services/3288",
    "description": "Окно приёма документов по действующим национальным правилам.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Повторно проверить приёмную кампанию 2027."
  },
  {
    "name": "День столицы 2027",
    "type": "Другое",
    "start_date": "2027-07-06",
    "end_date": "2027-07-06",
    "education_group": "all",
    "audience": "все учащиеся и семьи",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "confirmed",
    "source_name": "Закон Республики Казахстан «О праздниках в Республике Казахстан»",
    "source_url": "https://adilet.zan.kz/rus/docs/Z010000267_",
    "description": "Официальный праздничный нерабочий день 6 июля.",
    "demand_effect": "positive",
    "demand_strength": 1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": null
  },
  {
    "name": "Государственные образовательные гранты — подача заявлений 2027",
    "type": "Приёмная кампания",
    "start_date": "2027-07-13",
    "end_date": "2027-07-20",
    "education_group": "applicant",
    "audience": "абитуриенты вузов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=15638",
    "description": "Срок подачи заявлений на гранты по действующим правилам.",
    "demand_effect": "negative",
    "demand_strength": -1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Повторно проверить после официального объявления кампании 2027."
  },
  {
    "name": "Августовское ЕНТ 2027 — регистрация",
    "type": "Приёмная кампания",
    "start_date": "2027-07-25",
    "end_date": "2027-08-05",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Регистрация на августовское ЕНТ по действующему календарю НЦТ.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Требуется повторная проверка по объявлению 2027."
  },
  {
    "name": "Государственные образовательные гранты — публикация результатов 2027",
    "type": "Другое",
    "start_date": "2027-08-10",
    "end_date": "2027-08-10",
    "education_group": "applicant",
    "audience": "абитуриенты вузов",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Правила присуждения образовательного гранта",
    "source_url": "https://adilet.zan.kz/rus/docs/V2000020939/compare",
    "description": "Предельная дата по действующим правилам для публикации/оформления результатов конкурса грантов.",
    "demand_effect": "neutral",
    "demand_strength": 0,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "Повторно проверить фактическую дату публикации в 2027 году."
  },
  {
    "name": "Абитуриенты — августовское ЕНТ 2027",
    "type": "Другое",
    "start_date": "2027-08-10",
    "end_date": "2027-08-20",
    "education_group": "applicant",
    "audience": "абитуриенты",
    "country": "Казахстан",
    "academic_year": "2026-2027",
    "verification_status": "preliminary",
    "source_name": "Национальный центр тестирования",
    "source_url": "https://testcenter.kz/?lang=ru&page_id=14929",
    "description": "Период августовского ЕНТ по действующему общему календарю НЦТ.",
    "demand_effect": "negative",
    "demand_strength": -1,
    "last_verified_at": "2026-08-16T02:18:00+05:00",
    "notes": "2026 фактический период был скорректирован до 10–14 августа; поэтому диапазон 2027 оставлен preliminary до отдельного объявления НЦТ."
  }
]
