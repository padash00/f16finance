import SwiftUI

/// Список слева — содержимое справа.
///
/// Раскладка для всего, что состоит из «выбрал элемент → смотришь его»:
/// задачи, статьи, чек-листы, акты ревизии. На большом экране переход
/// «открыл — вернулся — открыл следующий» лишний: обе части помещаются рядом,
/// и работа идёт без потери контекста.
///
/// На телефоне вырождается в обычный список с переходом — там колонки негде
/// взять.
public struct MasterDetail<Item: Identifiable & Hashable, Row: View, Detail: View, Empty: View>: View {
    private let items: [Item]
    @Binding private var selection: Item?
    private let row: (Item) -> Row
    private let detail: (Item) -> Detail
    private let empty: () -> Empty
    private let listWidth: CGFloat
    private let actions: (Item) -> [RowAction]

    @Environment(\.surface) private var surface

    public init(
        items: [Item],
        selection: Binding<Item?>,
        listWidth: CGFloat = 340,
        actions: @escaping (Item) -> [RowAction] = { _ in [] },
        @ViewBuilder row: @escaping (Item) -> Row,
        @ViewBuilder detail: @escaping (Item) -> Detail,
        @ViewBuilder empty: @escaping () -> Empty
    ) {
        self.items = items
        self._selection = selection
        self.listWidth = listWidth
        self.actions = actions
        self.row = row
        self.detail = detail
        self.empty = empty
    }

    public var body: some View {
        if surface.isCompact {
            compactList
        } else {
            wideSplit
        }
    }

    // ── Телефон ──────────────────────────────────────────────────────────────

    private var compactList: some View {
        Group {
            if items.isEmpty {
                empty()
            } else {
                // `List`, а не `LazyVStack`, ради свайпов: `swipeActions`
                // работает только внутри списка. Разделители, фон строк и
                // отступы сняты — карточки выглядят ровно так же, как раньше,
                // а жест появился.
                List(items) { item in
                    NavigationLink {
                        FreshDetail(id: item.id, fallback: item, items: items, detail: detail)
                    } label: {
                        row(item)
                    }
                    .listRowInsets(EdgeInsets(top: Spacing.xs, leading: Spacing.lg, bottom: Spacing.xs, trailing: Spacing.lg))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .rowActions(actions(item))
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Theme.background)
    }

    // ── iPad и Mac ───────────────────────────────────────────────────────────

    @ViewBuilder
    private var wideSplit: some View {
        // Делить нечего — не делим. Раньше разделитель и вторая колонка
        // рисовались даже при пустом списке: экран выглядел разрезанным
        // пополам без причины.
        if items.isEmpty {
            empty()
        } else {
            splitPanes
        }
    }

    private var splitPanes: some View {
        HStack(spacing: 0) {
            Group {
                    ScrollView {
                        LazyVStack(spacing: Spacing.sm) {
                            ForEach(items) { item in
                                Button {
                                    selection = item
                                } label: {
                                    row(item)
                                        .background(
                                            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                                                .fill(selection == item ? Theme.brand.opacity(0.14) : .clear)
                                        )
                                }
                                .buttonStyle(.plain)
                                .contextMenu { RowActionMenu(actions: actions(item)) }
                            }
                        }
                        .padding(Spacing.md)
                    }
            }
            .frame(width: listWidth)
            .background(Theme.elevated.opacity(0.4))

            Divider()

            Group {
                if let selection, let fresh = items.first(where: { $0.id == selection.id }) {
                    // Берём свежую запись из списка, а не сохранённую при
                    // нажатии: после действия список перечитывается, и снимок
                    // остался бы со старым статусом.
                    detail(fresh)
                } else {
                    // Пустая правая часть на широком экране выглядит как сбой —
                    // подсказываем, что делать.
                    VStack(spacing: Spacing.md) {
                        Image(systemName: "hand.point.left")
                            .font(.system(size: 26, weight: .light))
                            .foregroundStyle(Theme.textDim)
                        Text("Выберите из списка слева")
                            .font(Typography.callout)
                            .foregroundStyle(Theme.textDim)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.background)
        .onAppear {
            if selection == nil { selection = items.first }
        }
        .onChange(of: items.count) { _, _ in
            if selection == nil || !items.contains(where: { $0.id == selection?.id }) {
                selection = items.first
            }
        }
    }
}

/// Действие над строкой: свайп на телефоне, долгое нажатие на планшете.
///
/// Одно описание на оба жеста намеренно. Разводить их — значит однажды
/// добавить действие в свайп и забыть про меню, и человек с iPad не найдёт
/// того, что есть у коллеги с телефоном.
public struct RowAction: Identifiable {
    public let id = UUID()
    let title: String
    let icon: String
    let tint: Color
    let isDestructive: Bool
    let perform: () -> Void

    public init(
        _ title: String,
        icon: String,
        tint: Color = Theme.brand,
        isDestructive: Bool = false,
        perform: @escaping () -> Void
    ) {
        self.title = title
        self.icon = icon
        self.tint = tint
        self.isDestructive = isDestructive
        self.perform = perform
    }
}

/// Пункты действий для контекстного меню.
struct RowActionMenu: View {
    let actions: [RowAction]

    var body: some View {
        ForEach(actions) { action in
            Button(role: action.isDestructive ? .destructive : nil) {
                action.perform()
            } label: {
                Label(action.title, systemImage: action.icon)
            }
        }
    }
}

private extension View {
    /// Свайп и меню на одной строке.
    @ViewBuilder
    func rowActions(_ actions: [RowAction]) -> some View {
        if actions.isEmpty {
            self
        } else {
            self
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    ForEach(actions) { action in
                        Button(role: action.isDestructive ? .destructive : nil) {
                            action.perform()
                        } label: {
                            Label(action.title, systemImage: action.icon)
                        }
                        .tint(action.isDestructive ? Theme.negative : action.tint)
                    }
                }
                .contextMenu { RowActionMenu(actions: actions) }
        }
    }
}

/// Деталь, которая следит за списком.
///
/// `NavigationLink` захватывает запись значением, и после действия — закрыли
/// задачу, одобрили заявку — открытая карточка продолжала показывать прежнее
/// состояние, пока её не закроешь и не откроешь снова. Здесь запись каждый раз
/// разрешается заново по идентификатору.
///
/// Если она пропала из списка совсем (сменился фильтр, запись удалили),
/// показываем последний известный снимок: закрывать открытый экран под руками
/// человека — хуже, чем показать чуть устаревшее.
private struct FreshDetail<Item: Identifiable & Hashable, Detail: View>: View {
    let id: Item.ID
    let fallback: Item
    let items: [Item]
    let detail: (Item) -> Detail

    var body: some View {
        detail(items.first(where: { $0.id == id }) ?? fallback)
    }
}

/// Пустое состояние во всю доступную площадь.
///
/// Отдельно от `EmptyStateView`, потому что на большом экране одинокая иконка
/// посреди чёрного поля читается как поломка, а не как «пока пусто».
public struct WideEmptyState: View {
    private let icon: String
    private let title: String
    private let message: String

    public init(icon: String, title: String, message: String) {
        self.icon = icon
        self.title = title
        self.message = message
    }

    public var body: some View {
        VStack(spacing: Spacing.lg) {
            ZStack {
                Circle()
                    .fill(Theme.surfaceRaised)
                    .frame(width: 88, height: 88)
                Image(systemName: icon)
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(Theme.textDim)
            }

            VStack(spacing: Spacing.sm) {
                Text(title)
                    .font(Typography.title)
                    .foregroundStyle(Theme.text)
                Text(message)
                    .font(Typography.callout)
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 360)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }
}
