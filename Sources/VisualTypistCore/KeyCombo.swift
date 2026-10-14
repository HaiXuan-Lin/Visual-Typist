import Foundation

/// A keyboard shortcut in canonical text form, e.g. `alt+k`, `ctrl+shift+p`, `ctrl+tab`.
///
/// Modifiers are always written in the order `ctrl+alt+shift+cmd`. Keys are named by their
/// physical position on an ANSI keyboard, so `alt+k` is the same shortcut regardless of the
/// character macOS would type for Option-K.
public struct KeyCombo: Hashable, Sendable, CustomStringConvertible {
    public struct Modifiers: OptionSet, Hashable, Sendable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let control = Modifiers(rawValue: 1)
        public static let option = Modifiers(rawValue: 2)
        public static let shift = Modifiers(rawValue: 4)
        public static let command = Modifiers(rawValue: 8)
    }

    public let modifiers: Modifiers
    public let key: String

    public init(modifiers: Modifiers, key: String) {
        self.modifiers = modifiers
        self.key = key
    }

    /// Parses `"Ctrl+Shift+P"`, `"alt+k"`, `"option+k"` and similar spellings.
    public init?(_ text: String) {
        var modifiers: Modifiers = []
        var key: String?
        let parts = text.lowercased().split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        for (index, part) in parts.enumerated() {
            // A trailing empty part means the key itself is "+", which is not a supported key.
            switch part.trimmingCharacters(in: .whitespaces) {
            case "ctrl", "control", "⌃": modifiers.insert(.control)
            case "alt", "option", "opt", "⌥": modifiers.insert(.option)
            case "shift", "⇧": modifiers.insert(.shift)
            case "cmd", "command", "⌘": modifiers.insert(.command)
            case let name where index == parts.count - 1 && Self.keyNames.contains(Self.alias(name)):
                key = Self.alias(name)
            default: return nil
            }
        }
        guard let key else { return nil }
        self.init(modifiers: modifiers, key: key)
    }

    public var description: String {
        var parts: [String] = []
        if modifiers.contains(.control) { parts.append("ctrl") }
        if modifiers.contains(.option) { parts.append("alt") }
        if modifiers.contains(.shift) { parts.append("shift") }
        if modifiers.contains(.command) { parts.append("cmd") }
        return (parts + [key]).joined(separator: "+")
    }

    /// The combo as macOS menus display it, e.g. `⌃⇧P`.
    public var displayString: String {
        var text = ""
        if modifiers.contains(.control) { text += "⌃" }
        if modifiers.contains(.option) { text += "⌥" }
        if modifiers.contains(.shift) { text += "⇧" }
        if modifiers.contains(.command) { text += "⌘" }
        let symbols = ["left": "←", "right": "→", "up": "↑", "down": "↓", "tab": "⇥", "enter": "↩",
                       "space": "Space", "backspace": "⌫", "escape": "⎋"]
        return text + (symbols[key] ?? key.uppercased())
    }

    /// Maps a macOS virtual key code (`NSEvent.keyCode`) to a key name.
    public static func keyName(forKeyCode code: UInt16) -> String? { keyCodes[code] }

    public static let keyNames: Set<String> = Set(keyCodes.values)

    private static func alias(_ name: String) -> String {
        ["return": "enter", "esc": "escape", "delete": "backspace", "quote": "'", "apostrophe": "'",
         "arrowleft": "left", "arrowright": "right", "arrowup": "up", "arrowdown": "down"][name] ?? name
    }

    private static let keyCodes: [UInt16: String] = [
        0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x", 8: "c", 9: "v",
        11: "b", 12: "q", 13: "w", 14: "e", 15: "r", 16: "y", 17: "t",
        18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7",
        27: "-", 28: "8", 29: "0", 30: "]", 31: "o", 32: "u", 33: "[", 34: "i", 35: "p",
        36: "enter", 37: "l", 38: "j", 39: "'", 40: "k", 41: ";", 42: "\\", 43: ",", 44: "/",
        45: "n", 46: "m", 47: ".", 48: "tab", 49: "space", 50: "`", 51: "backspace", 53: "escape",
        76: "enter", 123: "left", 124: "right", 125: "down", 126: "up",
    ]
}
