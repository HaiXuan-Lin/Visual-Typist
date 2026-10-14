import AppKit

/// Persists the user's changes to the default keyboard shortcuts.
///
/// The file maps key combos to bindings, layered over the defaults in `keymap.js`:
///
///     { "version": 1, "shortcuts": { "alt+k": { "insert": "ket" }, "ctrl+h": null } }
///
/// `null` removes a default shortcut. The file can also be edited by hand.
@MainActor
final class ShortcutStore {
    static let shared = ShortcutStore()
    static let didChange = Notification.Name("ShortcutStoreDidChange")

    let fileURL: URL
    private(set) var overrides: [String: Any] = [:]

    init(fileURL: URL = ShortcutStore.defaultURL) {
        self.fileURL = fileURL
        reload()
    }

    nonisolated static var defaultURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Visual Typist", isDirectory: true)
            .appendingPathComponent("shortcuts.json")
    }

    func reload() {
        guard let data = try? Data(contentsOf: fileURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let shortcuts = object["shortcuts"] as? [String: Any] else {
            overrides = [:]
            return
        }
        overrides = shortcuts
    }

    func overridesJSON() -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: overrides, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }

    func save(overrides: [String: Any]) {
        self.overrides = overrides
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            let object: [String: Any] = ["version": 1, "shortcuts": overrides]
            let data = try JSONSerialization.data(withJSONObject: object,
                                                  options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
            try data.write(to: fileURL, options: .atomic)
        } catch {
            NSAlert(error: error).runModal()
        }
        NotificationCenter.default.post(name: Self.didChange, object: self)
    }

    /// Shows the shortcuts file in Finder, creating it first if needed.
    func revealInFinder() {
        if !FileManager.default.fileExists(atPath: fileURL.path) { save(overrides: overrides) }
        NSWorkspace.shared.activateFileViewerSelecting([fileURL])
    }

    /// Re-reads the file after it was edited outside the app.
    func reloadFromDisk() {
        reload()
        NotificationCenter.default.post(name: Self.didChange, object: self)
    }
}
