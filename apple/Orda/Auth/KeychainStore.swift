import Foundation
import LocalAuthentication
import Security

/// Хранилище сессии в Keychain.
///
/// Прошлая версия приложения держала токены в AsyncStorage — то есть в обычном
/// файле песочницы. Для приложения, из которого можно выплатить зарплату и
/// выгрузить пароли всей команды, это неприемлемо. Keychain шифруется ключом
/// устройства, а `AfterFirstUnlock` не даёт прочитать данные, пока телефон
/// после перезагрузки ни разу не разблокировали.
struct KeychainStore: Sendable {
    let service: String
    let account: String
    /// Запись под биометрией: прочитать её нельзя без Face ID или кода
    /// устройства. Нужна для быстрого возврата после выхода — токен лежит
    /// рядом с сессией, но достать его может только владелец лица.
    let requiresBiometry: Bool

    init(
        service: String = "kz.ordaops.apple.session",
        account: String = "supabase-session",
        requiresBiometry: Bool = false
    ) {
        self.service = service
        self.account = account
        self.requiresBiometry = requiresBiometry
    }

    /// Правила доступа к записи.
    ///
    /// Обычная сессия — `AfterFirstUnlock`: приложение обновляет токен в фоне,
    /// и без этого фоновая работа ломалась бы после перезагрузки телефона.
    /// Быстрый вход — только с этого устройства, только при заданном коде и
    /// только по биометрии: это ключ от чужой зарплаты, а не удобство.
    private func accessAttributes() -> [String: Any] {
        guard requiresBiometry else {
            return [kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        }
        guard let control = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .userPresence,
            nil
        ) else {
            return [kSecAttrAccessible as String: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly]
        }
        return [kSecAttrAccessControl as String: control]
    }

    /// Есть ли запись, не спрашивая биометрию.
    ///
    /// Нужно, чтобы решить, показывать ли кнопку «Войти по Face ID». Спрашивать
    /// лицо ради того, чтобы узнать о существовании кнопки, — абсурд.
    func exists() -> Bool {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if requiresBiometry {
            // Просим систему не показывать запрос: наличие записи выдаст код
            // ошибки `interactionNotAllowed`.
            let context = LAContext()
            context.interactionNotAllowed = true
            query[kSecUseAuthenticationContext as String] = context
        }
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    func save(_ data: Data) {
        // Обновление вместо add: SecItemAdd на существующем ключе вернёт
        // errSecDuplicateItem, и сессия молча перестанет сохраняться.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        var attributes: [String: Any] = [kSecValueData as String: data]
        attributes.merge(accessAttributes()) { current, _ in current }

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        guard status != errSecSuccess else { return }

        var insert = query
        insert[kSecValueData as String] = data
        insert.merge(accessAttributes()) { current, _ in current }

        // Любая неудача обновления — не только «записи нет». Встречается и
        // errSecDuplicateItem от строки, оставшейся с прошлой установки, и
        // errSecInteractionNotAllowed на заблокированном устройстве. Раньше
        // разбирался ровно один код, а всё остальное молча теряло сессию:
        // человек закрывал приложение вошедшим и открывал на экране входа.
        if SecItemAdd(insert as CFDictionary, nil) == errSecDuplicateItem {
            SecItemDelete(query as CFDictionary)
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    /// Прочитать. У биометрической записи здесь и появится запрос Face ID.
    func load(prompt: String? = nil) -> Data? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let prompt {
            let context = LAContext()
            context.localizedReason = prompt
            query[kSecUseAuthenticationContext as String] = context
        }

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
