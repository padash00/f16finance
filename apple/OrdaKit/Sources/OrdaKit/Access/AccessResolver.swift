import Foundation

/// Решает, что показывать пользователю. Самая ошибкоопасная часть приложения:
/// ошибка здесь либо прячет нужное, либо показывает кнопку, которую сервер
/// отвергнет с 403.
///
/// Зеркалит серверные проверки:
///   • `proxy.ts` — доступ к странице требует `<page>.view`;
///   • `lib/server/capabilities.ts` → `requireCapability()` — доступ к действию;
///   • `lib/nav/sections.tsx` → `getPathFeature()` — гейт по модулям организации.
///
/// Правило, которое нельзя нарушать: **скрытая кнопка — это не защита**.
/// Резолвер только убирает лишнее из интерфейса. Настоящая проверка живёт на
/// сервере, и приложение обязано корректно обрабатывать 403 (см. `APIError`).
public struct AccessResolver: Sendable {
    public let session: SessionRole

    public init(session: SessionRole) {
        self.session = session
    }

    // ── Базовое ──────────────────────────────────────────────────────────────

    /// Доступ без ограничений. Только суперадмин: сервер отдаёт ему `["*"]`.
    ///
    /// Владельца сюда НЕ добавляем, хотя соблазн есть. Сервер выдаёт владельцу
    /// весь каталог прав явным списком, но предварительно вычитает рубильник
    /// организации — а тот режет даже владельца. Поэтому доверяем списку, а не
    /// роли: иначе интерфейс покажет владельцу действие, отключённое
    /// суперадмином для всей организации.
    public var isAllAccess: Bool {
        session.capabilities.contains("*")
    }

    /// Есть ли конкретное право (`income.create`, `store-revisions.commit`).
    public func can(_ capability: String) -> Bool {
        if isAllAccess { return true }
        return session.capabilities.contains(capability)
    }

    /// Есть ли хотя бы одно из прав. Для экранов, которые обслуживают
    /// несколько источников данных.
    public func canAny(_ capabilities: [String]) -> Bool {
        if isAllAccess { return true }
        return capabilities.contains { session.capabilities.contains($0) }
    }

    public func canAll(_ capabilities: [String]) -> Bool {
        if isAllAccess { return true }
        return capabilities.allSatisfy { session.capabilities.contains($0) }
    }

    /// Требует ли право подтверждения биометрией. 106 прав уровня `.high` —
    /// необратимые операции.
    public func requiresConfirmation(_ capability: String) -> Bool {
        CapabilityCatalog.capability(id: capability)?.severity == .high
    }

    // ── Модули организации ───────────────────────────────────────────────────

    /// Оплачен ли модуль. Зеркало `hasFeature` из веба: пустой список фич
    /// означает «организация без пакета» → не ограничиваем.
    public func hasFeature(_ feature: String?) -> Bool {
        guard let feature, !feature.isEmpty else { return true }
        if isAllAccess { return true }
        if session.featuresAllAccess { return true }
        if session.orgFeatures.isEmpty { return true }
        return session.orgFeatures.contains(feature)
    }

    /// Доступен ли маршрут по модулям организации.
    public func hasFeature(forPath path: String) -> Bool {
        hasFeature(AddonCatalog.addonCode(forPath: path))
    }

    // ── Маршруты, выключенные вручную ────────────────────────────────────────

    /// Явное выключение маршрута для роли. При нескольких совпадениях побеждает
    /// самое длинное правило — как `findRolePermissionOverride` в вебе.
    public func pathOverride(for path: String) -> Bool? {
        var best: RolePermissionOverride?
        for override in session.rolePermissionOverrides where matches(path: path, rule: override.path) {
            if best == nil || override.path.count > best!.path.count {
                best = override
            }
        }
        return best?.enabled
    }

    private func matches(path: String, rule: String) -> Bool {
        if rule.hasSuffix("/*") {
            return path.hasPrefix(String(rule.dropLast(2)))
        }
        return path == rule || path.hasPrefix(rule + "/")
    }

    // ── Видимость страниц ────────────────────────────────────────────────────

    /// Видна ли страница каталога. Требуется `<page>.view` — ровно то же, что
    /// проверяет серверный proxy.
    public func canSeePage(id pageID: String) -> Bool {
        guard let page = CapabilityCatalog.page(id: pageID) else { return false }
        return canSee(page: page)
    }

    public func canSee(page: CapabilityPage) -> Bool {
        if let override = pathOverride(for: page.path), !override { return false }
        guard hasFeature(forPath: page.path) else { return false }
        if isAllAccess { return true }
        return session.capabilities.contains(page.viewCapabilityID)
    }

    /// Видна ли страница по маршруту. Если маршрута нет в каталоге прав —
    /// решают только модули и ручные выключения (так же ведёт себя proxy,
    /// уходя в фоллбэк `canAccessPath`).
    public func canSee(path: String) -> Bool {
        if let page = CapabilityCatalog.page(path: path) {
            return canSee(page: page)
        }
        if let override = pathOverride(for: path), !override { return false }
        return hasFeature(forPath: path)
    }

    /// Страницы группы, доступные пользователю.
    public func visiblePages(in group: CapabilityGroup) -> [CapabilityPage] {
        group.pages.filter { canSee(page: $0) }
    }

    /// Разделы с хотя бы одной доступной страницей. Пустые не показываем.
    public func visibleGroups() -> [(group: CapabilityGroup, pages: [CapabilityPage])] {
        CapabilityCatalog.groups.compactMap { group in
            let pages = visiblePages(in: group)
            return pages.isEmpty ? nil : (group, pages)
        }
    }

    /// Разделы, у которых есть нативный экран и доступ.
    ///
    /// В приложении показываем только их. Раньше остальные открывались
    /// веб-версией портала — это давало доступ к функции, но не приложение:
    /// жесты, поиск и раскладка оставались браузерными. Показывать пункт,
    /// который ведёт в браузер, хуже, чем не показывать вовсе.
    ///
    /// Гейт по подписке при этом сохраняется целиком: `canSee` уже отсекает
    /// страницы, чей модуль организация не оплатила, — раздел не появится,
    /// даже если нативный экран для него написан.
    public func nativeGroups() -> [(group: CapabilityGroup, pages: [CapabilityPage])] {
        CapabilityCatalog.groups.compactMap { group in
            let pages = group.pages.filter { page in
                canSee(page: page) && NativeSection.forPage(id: page.id) != nil
            }
            return pages.isEmpty ? nil : (group, pages)
        }
    }

    /// Действия страницы, доступные пользователю. Для сборки меню и свайпов.
    public func availableActions(on page: CapabilityPage) -> [Capability] {
        page.capabilities.filter { can($0.id) }
    }

    // ── Корневой интерфейс ───────────────────────────────────────────────────

    /// Какой интерфейс строить после входа. Порядок совпадает с приоритетом
    /// персон на сервере.
    public var workspace: Workspace {
        if session.isSuperAdmin || isAllAccess { return .platform }
        if session.isOperator && !session.isStaff { return .operator }
        if session.isStaff {
            return session.staffRole == "owner" ? .owner : .staff
        }
        if session.isCustomer { return .customer }
        return .none
    }

    public enum Workspace: String, Sendable {
        /// Суперадмин: управление организациями поверх всего остального.
        case platform
        /// Владелец организации.
        case owner
        /// Сотрудник — интерфейс собирается из его прав.
        case staff
        /// Оператор: смена, продажа, ревизия.
        case `operator`
        /// Гость клуба.
        case customer
        /// Прав нет вообще — экран «обратитесь к владельцу».
        case none
    }

    /// Совсем ничего не доступно. Повод показать объясняющий экран вместо
    /// пустого таб-бара.
    public var hasNoAccess: Bool {
        workspace == .none || (workspace == .staff && visibleGroups().isEmpty)
    }
}
