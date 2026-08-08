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

    @Environment(\.surface) private var surface

    public init(
        items: [Item],
        selection: Binding<Item?>,
        listWidth: CGFloat = 340,
        @ViewBuilder row: @escaping (Item) -> Row,
        @ViewBuilder detail: @escaping (Item) -> Detail,
        @ViewBuilder empty: @escaping () -> Empty
    ) {
        self.items = items
        self._selection = selection
        self.listWidth = listWidth
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
                ScrollView {
                    LazyVStack(spacing: Spacing.md) {
                        ForEach(items) { item in
                            NavigationLink { detail(item) } label: { row(item) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(Spacing.lg)
                }
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
                            }
                        }
                        .padding(Spacing.md)
                    }
            }
            .frame(width: listWidth)
            .background(Theme.elevated.opacity(0.4))

            Divider()

            Group {
                if let selection, items.contains(selection) {
                    detail(selection)
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
            if selection == nil || !(selection.map(items.contains) ?? false) {
                selection = items.first
            }
        }
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
