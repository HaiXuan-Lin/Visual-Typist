import AppKit
import WebKit
import VisualTypistCore

enum ExportFormat: String, CaseIterable, Identifiable {
    case pdf, png, svg, latex, mathml

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pdf: return "PDF"
        case .png: return "PNG"
        case .svg: return "SVG"
        case .latex: return "LaTeX"
        case .mathml: return "MathML"
        }
    }

    var fileExtension: String {
        switch self {
        case .latex: return "tex"
        case .mathml: return "mml"
        default: return rawValue
        }
    }
}

/// Produces export files from the editor's MathJax rendering.
@MainActor
struct Exporter {
    static let margin = 12.0

    let bridge: EditorBridge

    func data(_ format: ExportFormat, document: EquationDocument, scale: Double) async throws -> Data {
        if format == .latex { return Data(document.standaloneTeX().utf8) }
        let rendered = try await bridge.render(document)
        switch format {
        case .svg:
            return Data(svg(rendered, transparent: document.transparentBackground).utf8)
        case .mathml:
            guard !rendered.mathml.isEmpty else { throw EditorError.message("MathML is unavailable for this equation.") }
            return Data(rendered.mathml.utf8)
        case .png:
            return try await png(rendered, transparent: document.transparentBackground, scale: scale)
        case .pdf:
            return try await PDFRenderer().render(rendered, transparent: document.transparentBackground)
        case .latex:
            return Data(document.standaloneTeX().utf8)
        }
    }

    private func svg(_ equation: RenderedEquation, transparent: Bool) -> String {
        let width = equation.width + 2 * Self.margin
        let height = equation.height + 2 * Self.margin
        let background = transparent ? "" : #"<rect width="100%" height="100%" fill="white"/>"#
        // One unit is one point (the font size is in points, as in the PDF); a size without a unit
        // would be read as CSS pixels and come out at three quarters of the size.
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="\(width)pt" height="\(height)pt" viewBox="0 0 \(width) \(height)">
        \(background)<g transform="translate(\(Self.margin) \(Self.margin))">\(equation.svg)</g>
        </svg>

        """
    }

    private func png(_ equation: RenderedEquation, transparent: Bool, scale: Double) async throws -> Data {
        let width = equation.width + 2 * Self.margin
        let height = equation.height + 2 * Self.margin
        guard width * scale <= 16384, height * scale <= 16384, width * height * scale * scale <= 50_000_000 else {
            throw EditorError.message("The equation is too large for a PNG at this scale. Export SVG or PDF instead.")
        }
        let script = """
        return await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(width * scale);
            canvas.height = Math.ceil(height * scale);
            const context = canvas.getContext('2d');
            context.scale(scale, scale);
            if (!transparent) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
            context.drawImage(image, margin, margin);
            resolve(canvas.toDataURL('image/png').split(',')[1]);
          };
          image.onerror = () => reject(new Error('Could not rasterize the equation.'));
          image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
        """
        let result = try await bridge.call(script, ["svg": equation.svg, "width": width, "height": height,
                                                    "scale": scale, "transparent": transparent, "margin": Self.margin])
        guard let encoded = result as? String, let data = Data(base64Encoded: encoded) else { throw EditorError.invalidResponse }
        return data
    }
}

/// Prints the vector SVG into a single-page PDF sized to the equation.
@MainActor
private final class PDFRenderer: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Error>?

    func render(_ equation: RenderedEquation, transparent: Bool) async throws -> Data {
        let width = ceil(equation.width + 2 * Exporter.margin)
        let height = ceil(equation.height + 2 * Exporter.margin)
        guard width <= 14400, height <= 14400 else { throw EditorError.message("The equation exceeds the maximum PDF page size.") }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: configuration)
        view.navigationDelegate = self
        view.underPageBackgroundColor = transparent ? .clear : .white
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;width:\(width)px;height:\(height)px;overflow:hidden;background:\(transparent ? "transparent" : "white");}
        svg{position:absolute;left:\(Exporter.margin)px;top:\(Exporter.margin)px;}
        </style></head><body>\(equation.svg)</body></html>
        """
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.continuation = continuation
            view.loadHTMLString(html, baseURL: nil)
        }
        let configurationPDF = WKPDFConfiguration()
        configurationPDF.rect = CGRect(x: 0, y: 0, width: width, height: height)
        return try await view.pdf(configuration: configurationPDF)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        continuation?.resume()
        continuation = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
