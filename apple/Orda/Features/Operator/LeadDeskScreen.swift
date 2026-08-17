import OrdaKit
import OrdaUI
import SwiftUI

/// «Старший смены» — заявки команды и готовность недели.
///
/// Когда человек говорит «не смогу выйти», замену ищет не офис: там не знают,
/// кто уже отработал две ночи подряд и кто живёт в двух кварталах от точки.
/// Знает старший. Поэтому он предлагает решение, а руководитель его
/// утверждает — так это и устроено на сервере, просто в приложении этого не
/// было, и предложение передавалось голосом.
///
/// Раздел появляется только у старших: у остальных сервер отвечает отказом, и
/// пункта меню просто нет.
struct LeadDeskScreen: View {
    @Environment(CabinetStore.self) private var cabinet

    @State private var deciding: LeadShiftRequest?

    private var desk: LeadDesk? { cabinet.leadDesk }

    var body: some View {
        ScreenScroll {
            if let desk {
                if !desk.companies.isEmpty { readinessCard(desk) }

                section(
                    "Ждут решения",
                    requests: desk.awaitingProposal,
                    empty: "Заявок нет — команда выходит по графику.",
                    actionable: true
                )

                if !desk.awaitingDecision.isEmpty {
                    section(
                        "У руководителя",
                        requests: desk.awaitingDecision,
                        empty: "",
                        actionable: false
                    )
                }

                if !desk.settled.isEmpty {
                    section(
                        "Закрытые",
                        requests: Array(desk.settled.prefix(10)),
                        empty: "",
                        actionable: false
                    )
                }
            } else {
                LoadingRows(count: 3)
            }
        }
        .background(Theme.background)
        .navigationTitle("Старший смены")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .toolbar { LogoutToolbarItem() }
        .refreshable { await cabinet.loadLeadDesk() }
        .task { await cabinet.loadLeadDesk() }
        .sheet(item: $deciding) { request in
            LeadProposalSheet(
                request: request,
                candidates: desk?.replacements(
                    companyID: request.companyID,
                    excluding: request.operatorID
                ) ?? []
            )
        }
    }

    // ── Готовность недели ────────────────────────────────────────────────────

    /// Кто принял опубликованную неделю, а кто ещё нет.
    ///
    /// Это первое, что старший спрашивает у себя в понедельник: не «сколько у
    /// нас смен», а «все ли видели график». Неподтверждённая неделя — это
    /// человек, который в пятницу скажет «я не знал».
    @ViewBuilder
    private func readinessCard(_ desk: LeadDesk) -> some View {
        ForEach(desk.companies) { company in
            Card {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack {
                        Text(company.name)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Spacer()
                        if company.isDraft {
                            StatusChip("график не опубликован", kind: .neutral)
                        } else if company.pending == 0 {
                            StatusChip("неделя принята", kind: .good)
                        } else {
                            StatusChip("не подтвердили: \(company.pending)", kind: .warning)
                        }
                    }

                    if !company.isDraft {
                        ProgressView(
                            value: Double(company.confirmed),
                            total: Double(max(company.total, 1))
                        )
                        .tint(company.pending == 0 ? Theme.positive : Theme.warning)

                        Text("Подтвердили \(company.confirmed) из \(company.total)")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }

                    if company.issues > 0 {
                        RowDivider()
                        StatRow(
                            "Заявок открыто",
                            value: "\(company.issues)",
                            icon: "exclamationmark.bubble"
                        )
                    }
                }
            }
        }
    }

    // ── Заявки ───────────────────────────────────────────────────────────────

    @ViewBuilder
    private func section(
        _ title: String,
        requests: [LeadShiftRequest],
        empty: String,
        actionable: Bool
    ) -> some View {
        if requests.isEmpty {
            if !empty.isEmpty {
                SectionHeader(title)
                Card {
                    Text(empty)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } else {
            SectionHeader(title)
            ForEach(requests) { request in
                if actionable {
                    Button { deciding = request } label: {
                        requestCard(request, actionable: true)
                    }
                    .buttonStyle(.pressable)
                } else {
                    requestCard(request, actionable: false)
                }
            }
        }
    }

    private func requestCard(_ request: LeadShiftRequest, actionable: Bool) -> some View {
        Card(accent: actionable ? Theme.warning : nil) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(alignment: .firstTextBaseline) {
                    Text(request.operatorName)
                        .font(Typography.title)
                        .foregroundStyle(Theme.text)
                    Spacer()
                    if actionable {
                        Image(systemName: "chevron.right")
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                Text(
                    ScheduleScreen.dayTitle(request.shiftDate)
                        + (request.isNight ? ", ночная" : ", дневная")
                        + " · " + request.companyName
                )
                .font(Typography.callout)
                .foregroundStyle(Theme.textDim)

                if let reason = request.reason, !reason.isEmpty {
                    Text(reason)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: Spacing.xs) {
                    StatusChip(request.statusLabel, kind: request.isOpen ? .warning : .neutral)
                    if let proposal = request.proposalLabel {
                        StatusChip(proposal, kind: .info)
                    }
                }

                if let note = request.resolutionNote, !note.isEmpty {
                    Text("Решение: \(note)")
                        .font(Typography.caption)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// Предложение старшего по одной заявке.
struct LeadProposalSheet: View {
    let request: LeadShiftRequest
    let candidates: [LeadTeamMember]

    @Environment(\.dismiss) private var dismiss
    @Environment(CabinetStore.self) private var cabinet

    @State private var choice = "replace"
    @State private var replacement: String?
    @State private var note = ""
    @State private var isSaving = false
    @State private var error: String?

    private var canSubmit: Bool {
        if isSaving { return false }
        if choice == "replace" { return replacement != nil }
        return true
    }

    var body: some View {
        NavigationStack {
            ScreenScroll {
                Card {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(request.operatorName)
                            .font(Typography.title)
                            .foregroundStyle(Theme.text)
                        Text(
                            ScheduleScreen.dayTitle(request.shiftDate)
                                + (request.isNight ? ", ночная" : ", дневная")
                                + " · " + request.companyName
                        )
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textDim)
                        if let reason = request.reason, !reason.isEmpty {
                            Text(reason)
                                .font(Typography.callout)
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, Spacing.xxs)
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        FieldLabel("Что предлагаете")

                        Picker("", selection: $choice) {
                            Text("Замена").tag("replace")
                            Text("Оставить").tag("keep")
                            Text("Снять").tag("remove")
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()

                        Text(hint)
                            .font(Typography.caption)
                            .foregroundStyle(Theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if choice == "replace" { candidatesCard }

                Card {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        FieldLabel("Комментарий руководителю")
                        TextField("Необязательно", text: $note, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(2...4)
                            .padding(Spacing.md)
                            .background(
                                Theme.surfaceRaised,
                                in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                            )
                    }
                }

                if let error {
                    Text(error)
                        .font(Typography.callout)
                        .foregroundStyle(Theme.negative)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await submit() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Отправить руководителю")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit)
            }
            .background(Theme.background)
            .navigationTitle("Предложение")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
    }

    private var hint: String {
        switch choice {
        case "keep": "Причина не тянет на замену — смена остаётся за человеком."
        case "remove": "Смену снять, никем не закрывать. Точка останется без этого человека."
        default: "Кто выйдет вместо него. Предложение уходит руководителю на утверждение."
        }
    }

    /// Кандидаты — только состав этой точки: предлагать человека, у которого
    /// нет доступа к точке, сервер всё равно не даст.
    @ViewBuilder
    private var candidatesCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                FieldLabel("Кто выйдет")

                if candidates.isEmpty {
                    Text("На этой точке больше никого нет — предложите «оставить» или «снять», и руководитель решит.")
                        .font(Typography.callout)
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(Array(candidates.enumerated()), id: \.element.id) { index, member in
                        if index > 0 { RowDivider() }
                        Button {
                            replacement = member.operatorID
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(member.operatorName)
                                        .font(Typography.body)
                                        .foregroundStyle(Theme.text)
                                    Text(member.roleLabel)
                                        .font(Typography.caption)
                                        .foregroundStyle(Theme.textMuted)
                                }
                                Spacer()
                                Image(
                                    systemName: replacement == member.operatorID
                                        ? "checkmark.circle.fill"
                                        : "circle"
                                )
                                .foregroundStyle(
                                    replacement == member.operatorID ? Theme.brand : Theme.textMuted
                                )
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                    }
                }
            }
        }
    }

    private func submit() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        let failure = await cabinet.submitLeadProposal(
            requestID: request.id,
            action: choice,
            note: note.trimmingCharacters(in: .whitespaces),
            replacementOperatorID: choice == "replace" ? replacement : nil
        )

        if let failure {
            error = failure
            Haptics.error()
        } else {
            Haptics.success()
            dismiss()
        }
    }
}
