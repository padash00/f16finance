import OrdaKit
import OrdaUI
import SwiftUI

/// Пункт бокового меню / вкладки.
struct WorkspaceItem: Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String
    /// Значок с числом — «требует внимания».
    var badge: Int?

    static func == (lhs: WorkspaceItem, rhs: WorkspaceItem) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Раздел меню.
struct WorkspaceSection: Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String
    let items: [WorkspaceItem]

    static func == (lhs: WorkspaceSection, rhs: WorkspaceSection) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Каркас рабочего пространства, одинаковый для всех ролей и всех платформ.
///
/// Один и тот же код даёт три раскладки:
///   • iPhone — таб-бар снизу, разделы в отдельной вкладке «Ещё»;
///   • iPad — выдвижная боковая панель и две колонки;
///   • Mac — постоянная боковая панель, панель инструментов и меню.
///
/// Разделяет их только `horizontalSizeClass`, поэтому «мак-версия» не может
/// незаметно отстать от айфонной: экраны у них общие.
struct AdaptiveWorkspace<Detail: View>: View {
    let sections: [WorkspaceSection]
    let accent: Color
    /// Заголовок боковой панели — имя организации или роль.
    let title: String
    @Binding var selection: WorkspaceItem?
    @ViewBuilder let detail: (WorkspaceItem?) -> Detail

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        #if os(iOS)
        if sizeClass == .compact {
            compactLayout
        } else {
            splitLayout
        }
        #else
        splitLayout
        #endif
    }

    // ── iPhone ───────────────────────────────────────────────────────────────

    // Компактная раскладка существует только на iOS: `insetGrouped` и таб-бар
    // на macOS недоступны, и без этой границы Mac-сборка не компилируется.
    #if os(iOS)

    /// Таб-бар вмещает пять пунктов. Первые четыре раздела попадают туда
    /// целиком, остальное уходит в «Ещё» — иначе подписи не читаются.
    private var compactLayout: some View {
        TabView {
            ForEach(sections.prefix(4)) { section in
                NavigationStack {
                    sectionList(section)
                        .navigationTitle(section.title)
                }
                .tabItem {
                    Label(section.title, systemImage: section.icon)
                }
            }

            if sections.count > 4 {
                NavigationStack {
                    List {
                        ForEach(sections.dropFirst(4)) { section in
                            Section(section.title) {
                                ForEach(section.items) { item in
                                    NavigationLink(value: item) {
                                        itemLabel(item)
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .navigationTitle("Ещё")
                    .navigationDestination(for: WorkspaceItem.self) { item in
                        detail(item)
                    }
                }
                .tabItem {
                    Label("Ещё", systemImage: "ellipsis.circle")
                }
            }
        }
    }

    private func sectionList(_ section: WorkspaceSection) -> some View {
        Group {
            // Раздел из одного пункта не заслуживает промежуточного списка —
            // открываем содержимое сразу.
            if section.items.count == 1, let only = section.items.first {
                detail(only)
            } else {
                List(section.items) { item in
                    NavigationLink(value: item) {
                        itemLabel(item)
                    }
                }
                .listStyle(.insetGrouped)
                .navigationDestination(for: WorkspaceItem.self) { item in
                    detail(item)
                }
            }
        }
    }

    #endif

    // ── iPad и Mac ───────────────────────────────────────────────────────────

    private var splitLayout: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(sections) { section in
                    Section {
                        ForEach(section.items) { item in
                            NavigationLink(value: item) {
                                itemLabel(item)
                            }
                        }
                    } header: {
                        Label(section.title, systemImage: section.icon)
                            .font(Typography.label)
                            .foregroundStyle(accent)
                    }
                }
            }
            .navigationTitle(title)
            #if os(macOS)
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 340)
            #else
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 380)
            #endif
        } detail: {
            // Стек обязателен: без него переход внутрь записи в правой колонке
            // происходит, но рисуется без панели навигации — и вернуться
            // назад нечем. Экран открывался в тупик.
            NavigationStack {
                detail(selection)
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private func itemLabel(_ item: WorkspaceItem) -> some View {
        HStack {
            Label(item.title, systemImage: item.icon)
            if let badge = item.badge, badge > 0 {
                Spacer()
                Text("\(badge)")
                    .font(Typography.caption.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.negative)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, 2)
                    .background(Theme.negative.opacity(0.15), in: Capsule())
            }
        }
    }
}

// ── Меню macOS ───────────────────────────────────────────────────────────────

#if os(macOS)
/// Команды строки меню. Без них Mac-версия читается как «айпад на мониторе»:
/// на Mac ожидают горячие клавиши и полноценное меню, а не только мышь.
struct OrdaCommands: Commands {
    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("Обновить") {
                NotificationCenter.default.post(name: .ordaRefreshRequested, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)
        }

        CommandGroup(replacing: .help) {
            Link("Открыть веб-версию", destination: URL(string: "https://www.ordaops.kz")!)
        }
    }
}

extension Notification.Name {
    /// ⌘R — обновить активный экран.
    static let ordaRefreshRequested = Notification.Name("kz.ordaops.refreshRequested")
}
#endif
