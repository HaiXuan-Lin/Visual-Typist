import AppKit
import Carbon
import WebKit
import VisualTypistCore

struct RenderedEquation {
    let svg: String
    let mathml: String
    let width: Double
    let height: Double
}

enum EditorError: LocalizedError {
    case notReady, invalidResponse, message(String)

    var errorDescription: String? {
        switch self {
        case .notReady: return "The editor is still loading."
        case .invalidResponse: return "The renderer returned an incomplete result."
        case .message(let message): return message
        }
    }
}

/// Owns the web view that hosts the editor UI and translates between it and native code.
@MainActor
final class EditorBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: EditorWebView
    private(set) var isReady = false

    var onReady: (() -> Void)?
    var onChange: ((EquationDocument) -> Void)?
    var onAction: ((String, [String: Any]) -> Void)?
    var onError: ((String) -> Void)?

    private var pendingDocument: EquationDocument?

    init(shortcuts: ShortcutStore) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let contentController = WKUserContentController()
        // User shortcut overrides are available before any page script runs.
        contentController.addUserScript(WKUserScript(
            source: "window.VT_USER_SHORTCUTS = \(shortcuts.overridesJSON());",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController = contentController
        webView = EditorWebView(frame: .zero, configuration: configuration)
        self.shortcuts = shortcuts
        super.init()

        contentController.add(WeakMessageHandler(self), name: "vt")
        webView.navigationDelegate = self
        webView.onShortcut = { [weak self] combo in
            self?.evaluate("window.vt.runShortcut(combo)", ["combo": combo])
        }
        // Keep every open window's shortcuts in sync with edits made in any of them.
        NotificationCenter.default.addObserver(forName: ShortcutStore.didChange, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.evaluate("window.vt.setShortcutOverrides(overrides)", ["overrides": self.shortcuts.overrides])
            }
        }

        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web")
            ?? Bundle.module.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            preconditionFailure("Editor resources are missing from the app bundle.")
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    private let shortcuts: ShortcutStore

    // MARK: Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            isReady = true
            if let pendingDocument { load(pendingDocument) }
            pendingDocument = nil
            onReady?()
        case "change":
            if let document = Self.document(from: body) { onChange?(document) }
        case "shortcuts":
            webView.interceptedCombos = Set(body["combos"] as? [String] ?? [])
        case "focus":
            webView.restrictsToRomanInput = body["math"] as? Bool ?? false
        case "recording":
            webView.isRecordingShortcut = body["active"] as? Bool ?? false
        case "saveShortcuts":
            shortcuts.save(overrides: body["overrides"] as? [String: Any] ?? [:])
        case "action":
            if let name = body["name"] as? String { onAction?(name, body) }
        case "error":
            onError?(body["message"] as? String ?? "The editor failed to load.")
        default:
            break
        }
    }

    private static func document(from body: [String: Any]) -> EquationDocument? {
        guard let latex = body["latex"] as? String else { return nil }
        return EquationDocument(
            latex: latex,
            fontSize: body["fontSize"] as? Double ?? 32,
            colorHex: body["color"] as? String ?? "#17191D",
            displayStyle: body["displayStyle"] as? Bool ?? true)
    }

    // MARK: Calls into the page

    /// Replaces the editor contents; queued until the page is ready.
    func load(_ document: EquationDocument) {
        guard isReady else { pendingDocument = document; return }
        evaluate("return await window.vt.setState(state)", ["state": Self.state(document)])
    }

    func command(_ name: String) {
        evaluate("return await window.vt.command(name)", ["name": name])
    }

    func toast(_ message: String) {
        evaluate("window.vt.toast(message)", ["message": message])
    }

    func render(_ document: EquationDocument) async throws -> RenderedEquation {
        guard isReady else { throw EditorError.notReady }
        try document.validate()
        let result = try await call("return await window.vt.exportSVG(state)", ["state": Self.state(document)])
        guard let result = result as? [String: Any], let svg = result["svg"] as? String,
              let width = result["width"] as? Double, let height = result["height"] as? Double,
              width > 0, height > 0, width.isFinite, height.isFinite else { throw EditorError.invalidResponse }
        return RenderedEquation(svg: svg, mathml: result["mathml"] as? String ?? "", width: width, height: height)
    }

    func call(_ script: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        do {
            return try await webView.callAsyncJavaScript(script, arguments: arguments, in: nil, contentWorld: .page)
        } catch let error as NSError {
            // WebKit reports every script error as "A JavaScript exception occurred"; surface the real message.
            if let message = error.userInfo["WKJavaScriptExceptionMessage"] as? String {
                throw EditorError.message(message.replacingOccurrences(of: "Error: ", with: ""))
            }
            throw error
        }
    }

    private func evaluate(_ script: String, _ arguments: [String: Any]) {
        Task {
            do { _ = try await call(script, arguments) } catch { onError?(error.localizedDescription) }
        }
    }

    private static func state(_ document: EquationDocument) -> [String: Any] {
        ["latex": document.latex, "fontSize": document.fontSize, "color": document.colorHex,
         "displayStyle": document.displayStyle]
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        let scheme = navigationAction.request.url?.scheme
        decisionHandler(scheme == "file" || scheme == "about" || scheme == nil ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        onError?(error.localizedDescription)
    }
}

/// Handles editor shortcuts natively, so Option combinations reach the editor before macOS turns
/// them into characters or dead keys (Option-E, Option-I…), and Command combinations bound in the
/// editor win over menu items with the same keys while the equation has focus.
final class EditorWebView: WKWebView {
    var interceptedCombos: Set<String> = []

    /// While the visual editor has focus, an input method (Pinyin, Kana…) is swapped for a keyboard
    /// layout: composed text would otherwise arrive as text-mode characters instead of math. The
    /// previous input source returns when the LaTeX pane gets focus or the app is deactivated.
    var restrictsToRomanInput = false {
        didSet { updateInputSource() }
    }

    private var replacedInputSource: TISInputSource?
    private var activationObservers: [NSObjectProtocol] = []

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard activationObservers.isEmpty else { return }
        let center = NotificationCenter.default
        for name in [NSApplication.didBecomeActiveNotification, NSWindow.didBecomeKeyNotification] {
            activationObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.updateInputSource() }
            })
        }
        for name in [NSApplication.didResignActiveNotification, NSWindow.didResignKeyNotification] {
            activationObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.restoreInputSource() }
            })
        }
    }

    private func updateInputSource() {
        guard restrictsToRomanInput, NSApp.isActive, window?.isKeyWindow == true else {
            restoreInputSource()
            return
        }
        let current = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
        guard Self.isInputMethod(current),
              let layout = TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue() else { return }
        replacedInputSource = current
        TISSelectInputSource(layout)
    }

    private func restoreInputSource() {
        guard let source = replacedInputSource else { return }
        replacedInputSource = nil
        TISSelectInputSource(source)
    }

    private static func isInputMethod(_ source: TISInputSource) -> Bool {
        guard let pointer = TISGetInputSourceProperty(source, kTISPropertyInputSourceType) else { return false }
        let type = Unmanaged<CFString>.fromOpaque(pointer).takeUnretainedValue()
        return type != kTISTypeKeyboardLayout
    }

    var isRecordingShortcut = false
    var onShortcut: ((String) -> Void)?

    override func keyDown(with event: NSEvent) {
        if handleShortcut(event) { return }
        // macOS may restore the app's remembered input method after activation; check per key.
        if restrictsToRomanInput { updateInputSource() }
        super.keyDown(with: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.type == .keyDown, handleShortcut(event) { return true }
        return super.performKeyEquivalent(with: event)
    }

    private func handleShortcut(_ event: NSEvent) -> Bool {
        guard !isRecordingShortcut,
              let responder = window?.firstResponder as? NSView, responder.isDescendant(of: self) else { return false }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard !flags.intersection([.control, .option, .command]).isEmpty,
              let key = KeyCombo.keyName(forKeyCode: event.keyCode) else { return false }
        var modifiers: KeyCombo.Modifiers = []
        if flags.contains(.control) { modifiers.insert(.control) }
        if flags.contains(.option) { modifiers.insert(.option) }
        if flags.contains(.shift) { modifiers.insert(.shift) }
        if flags.contains(.command) { modifiers.insert(.command) }
        let combo = KeyCombo(modifiers: modifiers, key: key).description
        guard interceptedCombos.contains(combo) else { return false }
        onShortcut?(combo)
        return true
    }
}

@MainActor
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: EditorBridge?
    init(_ target: EditorBridge) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
