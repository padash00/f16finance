// ВНИМАНИЕ: файл сгенерирован автоматически. Правки будут затёрты.
//
// Источник:  lib/core/capabilities.ts, lib/core/addons.ts
// Генератор: scripts/export-capabilities.mjs
//
// Обновить:  node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs
// Проверить: node --import ./scripts/test-register.mjs scripts/export-capabilities.mjs --check


extension AddonCatalog {
    /// Продаваемые модули, зеркало `ADDON_CATALOG` из веба.
    static let generatedAddons: [Addon] = [
        Addon(
            code: "shop.catalog",
            name: "Магазин / Склад",
            description: "Склад, витрина, движения, каталог, техкарты, заявки, план закупа, поставщики.",
            pages: ["/store", "/inventory"],
            grants: ["shop.catalog"],
            priceKzt: 0,
            billing: .flat
        ),
        Addon(
            code: "addon.webpos",
            name: "Web POS (веб-касса)",
            description: "Веб-касса оператора для планшета/браузера.",
            pages: ["/pos"],
            grants: ["addon.webpos"],
            priceKzt: 0,
            billing: .flat
        ),
        Addon(
            code: "addon.arena",
            name: "Арена / Игровой клуб",
            description: "Станции, зоны, тарифы, игровые сессии, зал.",
            pages: ["/stations"],
            grants: ["addon.arena"],
            priceKzt: 0,
            billing: .flat
        ),
        Addon(
            code: "addon.ai",
            name: "AI & Аналитика",
            description: "AI-копилот, AI-Финдиректор, Бизнес-аналитика, AI-разбор, прогноз.",
            pages: ["/analysis", "/forecast", "/business-intelligence", "/expense-analysis", "/team-analysis"],
            grants: ["addon.ai", "ai.cfo"],
            priceKzt: 0,
            billing: .flat
        ),
        Addon(
            code: "addon.hr",
            name: "HR",
            description: "Сотрудники, должности, оргструктура, карьера, кадры, дни рождения.",
            pages: ["/hr", "/staff", "/structure", "/operators", "/birthdays"],
            grants: ["addon.hr"],
            priceKzt: 0,
            billing: .flat
        ),
        Addon(
            code: "addon.salary",
            name: "Зарплата",
            description: "Начисление, правила зарплаты, долги сотрудников, внутренние переводы.",
            pages: ["/salary", "/point-debts"],
            grants: ["addon.salary"],
            priceKzt: 0,
            billing: .flat
        ),
        Addon(
            code: "addon.telegram",
            name: "Telegram-отчёты",
            description: "Авто-отчёты смен и дня в Telegram.",
            pages: ["/telegram"],
            grants: ["addon.telegram"],
            priceKzt: 0,
            billing: .flat
        ),
        Addon(
            code: "addon.branding",
            name: "White-label / брендинг",
            description: "Свой логотип, бренд и поддомен клиента.",
            pages: [],
            grants: ["addon.branding"],
            priceKzt: 0,
            billing: .flag
        ),
    ]
}
