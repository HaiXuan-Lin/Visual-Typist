import AppKit
import Observation
import UniformTypeIdentifiers
import VisualTypistCore

extension UTType {
    static let visualTypistEquation = UTType(exportedAs: "io.github.visualtypist.equation", conformingTo: .json)
}

/// The state of one editor window: its document, file and editor.
@MainActor @Observable
final class EquationSession {
    var document = EquationDocument()
    var savedDocument = EquationDocument()
    var fileURL: URL?
    var editorReady = false
    var isExporting = false
    var pngScale = 2.0
    var errorMessage: String?

    @ObservationIgnored let bridge = EditorBridge(shortcuts: .shared)

    init() {
        bridge.onReady = { [weak self] in self?.editorReady = true }
        bridge.onChange = { [weak self] edited in
            guard let self else { return }
            // The page owns the equation and its look; export options stay native.
            self.document.latex = edited.latex
            self.document.fontSize = edited.fontSize
            self.document.colorHex = edited.colorHex
            self.document.alignment = edited.alignment
        }
        bridge.onAction = { [weak self] name, body in self?.perform(name, body) }
        bridge.onError = { [weak self] message in self?.errorMessage = message }
        bridge.onCopyEquation = { [weak self] in self?.copyImage() }
    }

    var isDirty: Bool { document != savedDocument }

    var title: String { fileURL?.deletingPathExtension().lastPathComponent ?? "Untitled" }

    private func perform(_ action: String, _ body: [String: Any]) {
        switch action {
        case "new": newDocument()
        case "open": open()
        case "save": save()
        case "copyLatex": copyLaTeX()
        case "copyImage": copyImage()
        case "export":
            if let format = (body["format"] as? String).flatMap(ExportFormat.init(rawValue:)) { export(format) }
        default: break
        }
    }

    // MARK: Documents

    func newDocument() {
        guard confirmDiscardingChanges() else { return }
        replace(with: EquationDocument(fontSize: document.fontSize, colorHex: document.colorHex), url: nil)
        bridge.command("focus")
    }

    func open() {
        guard confirmDiscardingChanges() else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.visualTypistEquation, .json, .plainText,
                                     UTType(filenameExtension: "tex") ?? .plainText,
                                     UTType(filenameExtension: "latex") ?? .plainText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        load(url)
    }

    func load(_ url: URL) {
        do {
            let document = try EquationDocument.read(data: Data(contentsOf: url), fileExtension: url.pathExtension)
            let isNative = [EquationDocument.fileExtension, "json"].contains(url.pathExtension.lowercased())
            replace(with: document, url: isNative ? url : nil)
            // An imported .tex file has not been saved as a document yet.
            if !isNative { savedDocument = EquationDocument() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @discardableResult
    func save(as saveAs: Bool = false) -> Bool {
        var url = saveAs ? nil : fileURL
        if url == nil {
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.visualTypistEquation]
            panel.nameFieldStringValue = "\(title).\(EquationDocument.fileExtension)"
            guard panel.runModal() == .OK else { return false }
            url = panel.url
        }
        guard let url else { return false }
        do {
            try document.jsonData().write(to: url, options: .atomic)
            fileURL = url
            savedDocument = document
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    private func replace(with document: EquationDocument, url: URL?) {
        self.document = document
        savedDocument = document
        fileURL = url
        bridge.load(document)
    }

    /// Asks to save unsaved changes. Returns false if the user cancels.
    func confirmDiscardingChanges() -> Bool {
        guard isDirty, !document.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || fileURL != nil else {
            return true
        }
        let alert = NSAlert()
        alert.messageText = "Do you want to save the changes to “\(title)”?"
        alert.informativeText = "Your changes will be lost if you don’t save them."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Don’t Save")
        alert.addButton(withTitle: "Cancel")
        switch alert.runModal() {
        case .alertFirstButtonReturn: return save()
        case .alertSecondButtonReturn: return true
        default: return false
        }
    }

    // MARK: Format

    func setDisplayStyle(_ enabled: Bool) {
        document.displayStyle = enabled
        bridge.load(document)
    }

    func setAlignment(_ alignment: LineAlignment) {
        document.alignment = alignment
        bridge.load(document)
    }

    // MARK: Export and clipboard

    func export(_ format: ExportFormat) {
        guard !isExporting else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: format.fileExtension) ?? .data]
        panel.nameFieldStringValue = "\(title).\(format.fileExtension)"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        isExporting = true
        let snapshot = document
        Task {
            defer { isExporting = false }
            do {
                let data = try await Exporter(bridge: bridge).data(format, document: snapshot, scale: pngScale)
                try data.write(to: url, options: .atomic)
                bridge.toast("Exported \(url.lastPathComponent)")
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// The selected part of the equation as LaTeX, or nil when nothing is selected.
    private func selectedLaTeX() async -> String? {
        try? await bridge.call("return window.vt.selectionLatex()") as? String
    }

    /// Copies the selection's LaTeX, or the whole document's when nothing is selected.
    func copyLaTeX() {
        Task {
            // The selection, or the whole document, with raw text written as literal text.
            let latex = (try? await bridge.call("return window.vt.copyLatex()") as? String) ?? document.latex
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(latex, forType: .string)
            bridge.toast("LaTeX copied")
        }
    }

    func copyMathML() {
        let snapshot = document
        Task {
            do {
                let mathml = try await bridge.render(snapshot).mathml
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(mathml, forType: .string)
                bridge.toast("MathML copied")
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Copies the selection, or the whole document when nothing is selected, as an image.
    func copyImage() {
        var snapshot = document
        Task {
            if let selection = await selectedLaTeX() { snapshot.latex = selection }
            do {
                let exporter = Exporter(bridge: bridge)
                let svg = try await exporter.data(.svg, document: snapshot, scale: pngScale)
                let pdf = try await exporter.data(.pdf, document: snapshot, scale: pngScale)
                let png = try await exporter.data(.png, document: snapshot, scale: pngScale)
                // SVG first; PDF and PNG for apps that don't accept SVG.
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setData(svg, forType: NSPasteboard.PasteboardType("public.svg-image"))
                pasteboard.setData(pdf, forType: .pdf)
                pasteboard.setData(png, forType: .png)
                bridge.toast("Image copied")
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
