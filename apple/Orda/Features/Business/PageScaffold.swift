import OrdaKit
import OrdaUI
import SwiftUI

/// Каркас страницы каталога прав.
///
/// Показывает, какие действия доступны пользователю на этой странице — то есть
/// делает видимой работу резолвера прав. Экраны с данными подключаются сюда по
/// одному, не меняя навигацию.
///
/// Плашка о незавершённости стоит намеренно: выдавать каркас за готовый экран
/// хуже, чем честно сказать, что данные ещё не подключены.
struct PageScaffold: View {
    let page: CapabilityPage
    let resolver: AccessResolver

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                let actions = resolver.availableActions(on: page)

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(page.label)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text(page.path)
                            .font(Typography.caption)
                            .monospaced()
                            .foregroundStyle(Theme.textDim)
                    }
                }

                if actions.isEmpty {
                    EmptyStateView(
                        icon: "lock",
                        title: "Только просмотр",
                        message: "Действий на этой странице вам не выдано."
                    )
                } else {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            Text("Доступные действия")
                                .font(Typography.label)
                                .foregroundStyle(Theme.textDim)
                                .textCase(.uppercase)

                            ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                                if index > 0 { RowDivider() }
                                HStack(spacing: Spacing.md) {
                                    Image(systemName: action.severity == .high ? "exclamationmark.shield.fill" : "checkmark.circle")
                                        .foregroundStyle(action.severity == .high ? Theme.negative : Theme.positive)
                                        .frame(width: 20)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(action.label)
                                            .font(Typography.body)
                                            .foregroundStyle(Theme.text)
                                        Text(action.id)
                                            .font(Typography.caption)
                                            .monospaced()
                                            .foregroundStyle(Theme.textDim)
                                    }
                                    Spacer()
                                    if action.severity == .high {
                                        StatusChip("опасное", kind: .danger)
                                    }
                                }
                                .staggeredAppear(index: index)
                            }
                        }
                    }
                }

                Card(accent: Theme.warning) {
                    Label("Экран данных подключается на следующем этапе", systemImage: "hammer")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Theme.background)
        .navigationTitle(page.label)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { LogoutToolbarItem() }
    }
}
