import Foundation
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

    init(service: String = "kz.ordaops.apple.session", account: String = "supabase-session") {
        self.service = service
        self.account = account
    }

    func save(_ data: Data) {
        // Обновление вместо add: SecItemAdd на существующем ключе вернёт
        // errSecDuplicateItem, и сессия молча перестанет сохраняться.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        guard status != errSecSuccess else { return }

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

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

    func load() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

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
