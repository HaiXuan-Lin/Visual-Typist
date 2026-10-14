import SwiftUI
import AppKit

@main
struct VisualTypistApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup { EditorWindow() }
            .defaultSize(width: 1100, height: 720)
            .commands { EditorCommands() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        for window in sender.windows {
            if let guardian = window.delegate as? WindowGuard, !guardian.session.confirmDiscardingChanges() {
                return .terminateCancel
            }
        }
        return .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

// MARK: - Window

struct SessionKey: FocusedValueKey { typealias Value = EquationSession }

extension FocusedValues {
    var session: EquationSession? {
        get { self[SessionKey.self] }
        set { self[SessionKey.self] = newValue }
    }
}

struct EditorWindow: View {
    @State private var session = EquationSession()

    var body: some View {
        EditorView(bridge: session.bridge)
            .frame(minWidth: 640, minHeight: 420)
            .navigationTitle(session.title)
            .focusedSceneValue(\.session, session)
            .background(WindowGuardView(session: session))
            .onOpenURL { url in
                if session.confirmDiscardingChanges() { session.load(url) }
            }
            .alert("Something Went Wrong", isPresented: Binding(
                get: { session.errorMessage != nil }, set: { if !$0 { session.errorMessage = nil } })) {
                Button("OK") { session.errorMessage = nil }
            } message: {
                Text(session.errorMessage ?? "")
            }
    }
}

private struct EditorView: NSViewRepresentable {
    let bridge: EditorBridge
    func makeNSView(context: Context) -> EditorWebView { bridge.webView }
    func updateNSView(_ view: EditorWebView, context: Context) {}
}

/// Installs a window delegate that asks before closing a window with unsaved changes.
private struct WindowGuardView: NSViewRepresentable {
    let session: EquationSession
    func makeNSView(context: Context) -> NSView { GuardInstaller(guardian: WindowGuard(session: session)) }
    func updateNSView(_ view: NSView, context: Context) {}
}

private final class GuardInstaller: NSView {
    let guardian: WindowGuard

    init(guardian: WindowGuard) {
        self.guardian = guardian
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let window, window.delegate !== guardian else { return }
        guardian.original = window.delegate
        window.delegate = guardian
        window.isDocumentEdited = guardian.session.isDirty
        guardian.observe(window)
    }
}

@MainActor
final class WindowGuard: NSObject, NSWindowDelegate {
    let session: EquationSession
    weak var original: NSWindowDelegate?

    init(session: EquationSession) { self.session = session }

    func observe(_ window: NSWindow) {
        withObservationTracking { _ = session.isDirty } onChange: { [weak self, weak window] in
            Task { @MainActor in
                guard let self, let window else { return }
                window.isDocumentEdited = self.session.isDirty
                self.observe(window)
            }
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        session.confirmDiscardingChanges() && (original?.windowShouldClose?(sender) ?? true)
    }

    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || (original?.responds(to: selector) ?? false)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        original?.responds(to: selector) == true ? original : super.forwardingTarget(for: selector)
    }
}

// MARK: - Menus

struct EditorCommands: Commands {
    @FocusedValue(\.session) private var session

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Keyboard Shortcuts…") { session?.bridge.command("showShortcuts") }
                .keyboardShortcut(",")
            Button("Show Shortcuts File in Finder") { ShortcutStore.shared.revealInFinder() }
            Button("Reload Shortcuts File") { ShortcutStore.shared.reloadFromDisk() }
        }

        CommandGroup(replacing: .newItem) {
            // ⌘N types ν in the editor, so New uses ⇧⌘N.
            Button("New") { session?.newDocument() }.keyboardShortcut("n", modifiers: [.command, .shift])
            // ⌘O inserts ω in the editor (AxMath's Ctrl+O), so Open uses ⇧⌘O.
            Button("Open…") { session?.open() }.keyboardShortcut("o", modifiers: [.command, .shift])
        }

        CommandGroup(replacing: .saveItem) {
            Button("Save") { session?.save() }.keyboardShortcut("s")
            // ⇧⌘S inserts a sum, so Save As uses ⌥⇧⌘S.
            Button("Save As…") { session?.save(as: true) }.keyboardShortcut("s", modifiers: [.command, .option, .shift])
            Menu("Export") {
                ForEach(ExportFormat.allCases) { format in
                    Button("\(format.title)…") { session?.export(format) }
                }
            }
            .disabled(session?.editorReady != true)
        }

        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Copy LaTeX") { session?.copyLaTeX() }.keyboardShortcut("t")
            // ⌘C in the equation copies it as an image (SVG, PDF and PNG); ⌘T copies the LaTeX.
            Button("Copy as Image") { session?.copyImage() }
            Button("Copy MathML") { session?.copyMathML() }
        }

        CommandMenu("Format") {
            Toggle("Display Style", isOn: Binding(
                get: { session?.document.displayStyle ?? true },
                set: { session?.setDisplayStyle($0) }))
            Toggle("Transparent Background", isOn: Binding(
                get: { session?.document.transparentBackground ?? true },
                set: { session?.document.transparentBackground = $0 }))
            Picker("Image Scale", selection: Binding(
                get: { session?.pngScale ?? 2 }, set: { session?.pngScale = $0 })) {
                ForEach([1.0, 2.0, 3.0, 4.0], id: \.self) { scale in Text("\(Int(scale))×").tag(scale) }
            }
        }

        CommandGroup(before: .toolbar) {
            Button("Symbols") { session?.bridge.command("symbols") }
            Button("LaTeX Code") { session?.bridge.command("code") }
            Divider()
        }

        CommandGroup(replacing: .help) {
            Button("Visual Typist Help") { HelpPanel.show() }
        }
    }
}

@MainActor
enum HelpPanel {
    static func show() {
        let alert = NSAlert()
        alert.messageText = "Visual Typist"
        alert.informativeText = """
        Type math directly in the top pane. Click a symbol below to insert it; Tab moves between empty slots.

        ↩  new line · ⇥  next slot · ⌫  in an empty slot selects its structure
        ⌃⇥  switch between Symbols and LaTeX code
        ⌘G  type the next letter in Greek
        ⌥↑ ↓ ← →  add matrix rows and columns
        ⌘,  view and change keyboard shortcuts

        Right-click any symbol to give it a shortcut.
        """
        alert.runModal()
    }
}
