import Foundation

/// An equation document as saved to disk (`.vteq`, JSON).
public struct EquationDocument: Codable, Equatable, Sendable {
    public static let schemaVersion = 1
    public static let fileExtension = "vteq"
    public static let fontSizes: ClosedRange<Double> = 12...96

    public var latex: String
    public var fontSize: Double
    public var colorHex: String
    public var displayStyle: Bool
    public var transparentBackground: Bool

    public init(
        latex: String = "",
        fontSize: Double = 32,
        colorHex: String = "#17191D",
        displayStyle: Bool = true,
        transparentBackground: Bool = true
    ) {
        self.latex = latex
        self.fontSize = fontSize
        self.colorHex = colorHex
        self.displayStyle = displayStyle
        self.transparentBackground = transparentBackground
    }

    public func validate() throws {
        guard fontSize.isFinite, Self.fontSizes.contains(fontSize) else {
            throw DocumentError.invalidSetting("Font size must be between 12 and 96 pixels.")
        }
        guard colorHex.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil else {
            throw DocumentError.invalidSetting("Color must be a six-digit hex value such as #17191D.")
        }
        guard !latex.unicodeScalars.contains(where: { $0.value == 0 }) else {
            throw DocumentError.invalidTextEncoding
        }
    }

    // MARK: Coding

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, latex, fontSize, colorHex, displayStyle, transparentBackground
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard let version = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) else {
            throw DocumentError.missingSchema
        }
        guard version == Self.schemaVersion else { throw DocumentError.unsupportedSchema(version) }
        let defaults = EquationDocument()
        latex = try container.decode(String.self, forKey: .latex)
        fontSize = try container.decodeIfPresent(Double.self, forKey: .fontSize) ?? defaults.fontSize
        colorHex = try container.decodeIfPresent(String.self, forKey: .colorHex) ?? defaults.colorHex
        displayStyle = try container.decodeIfPresent(Bool.self, forKey: .displayStyle) ?? defaults.displayStyle
        transparentBackground = try container.decodeIfPresent(Bool.self, forKey: .transparentBackground)
            ?? defaults.transparentBackground
        try validate()
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.schemaVersion, forKey: .schemaVersion)
        try container.encode(latex, forKey: .latex)
        try container.encode(fontSize, forKey: .fontSize)
        try container.encode(colorHex, forKey: .colorHex)
        try container.encode(displayStyle, forKey: .displayStyle)
        try container.encode(transparentBackground, forKey: .transparentBackground)
    }

    /// Reads a native document, or a single equation from a `.tex`, `.latex` or `.txt` file.
    public static func read(data: Data, fileExtension: String) throws -> EquationDocument {
        let ext = fileExtension.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        switch ext {
        case Self.fileExtension, "json":
            do {
                return try JSONDecoder().decode(Self.self, from: data)
            } catch let error as DocumentError {
                throw error
            } catch {
                throw DocumentError.malformedDocument
            }
        case "tex", "latex", "txt":
            let document = EquationDocument(latex: TeXImport.equation(from: try TeXImport.decodeText(data)))
            try document.validate()
            return document
        default:
            throw DocumentError.unsupportedFormat(ext)
        }
    }

    public func jsonData() throws -> Data {
        try validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    /// A standalone LaTeX document containing the equation.
    public func standaloneTeX() -> String {
        let color = colorHex.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil
            ? String(colorHex.dropFirst()).uppercased() : "17191D"
        let size = fontSize.isFinite ? min(Self.fontSizes.upperBound, max(Self.fontSizes.lowerBound, fontSize)) : 32
        let style = displayStyle ? #"\displaystyle"# : #"\textstyle"#
        // Several lines become a left-aligned array, one equation per row.
        let rows = lines.map(Self.trimmed).filter { !$0.isEmpty }
        let body = rows.count > 1 ? "\\begin{array}{l}\n" + rows.map { "\\displaystyle " + $0 }.joined(separator: " \\\\\n") + "\n\\end{array}" : latex
        return """
        \\documentclass[preview,border=2pt]{standalone}
        \\usepackage{amsmath,amssymb,xcolor}
        \\usepackage{fix-cm}
        \\providecommand{\\placeholder}[1]{\\square}
        \\definecolor{ink}{HTML}{\(color)}
        \\begin{document}
        \\color{ink}\\fontsize{\(Self.format(size))}{\(Self.format(size * 1.2))}\\selectfont
        \\everymath{\(style)}
        $\(body)$
        \\end{document}

        """
    }

    /// The document's equation lines. A newline inside braces or an environment (an `aligned`
    /// block written over several lines, say) belongs to its line rather than starting a new one.
    public var lines: [String] {
        var result: [String] = []
        var current: String?
        var depth = 0
        for raw in latex.components(separatedBy: "\n") {
            current = current.map { $0 + "\n" + raw } ?? raw
            var code = raw.replacingOccurrences(of: #"\\"#, with: "")
                .replacingOccurrences(of: #"\{"#, with: "").replacingOccurrences(of: #"\}"#, with: "")
            if let comment = code.firstIndex(of: "%") { code = String(code[..<comment]) }
            depth += code.filter { $0 == "{" }.count - code.filter { $0 == "}" }.count
            depth += code.components(separatedBy: #"\begin{"#).count - code.components(separatedBy: #"\end{"#).count
            if depth <= 0 {
                result.append(current ?? "")
                current = nil
                depth = 0
            }
        }
        if let current { result.append(current) }
        return result.isEmpty ? [""] : result
    }

    /// Removes surrounding whitespace, keeping a trailing escaped space (`\ `).
    private static func trimmed(_ line: String) -> String {
        var text = Substring(line.drop { $0.isWhitespace })
        while let last = text.last, last.isWhitespace, !text.dropLast().hasSuffix("\\") { text = text.dropLast() }
        return String(text)
    }

    private static func format(_ value: Double) -> String {
        String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), value)
            .replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
    }
}

public enum DocumentError: Error, Equatable, LocalizedError, Sendable {
    case unsupportedFormat(String)
    case unsupportedSchema(Int)
    case missingSchema
    case malformedDocument
    case invalidTextEncoding
    case invalidSetting(String)

    public var errorDescription: String? {
        switch self {
        case .unsupportedFormat(let ext):
            return "Files of type “.\(ext.isEmpty ? "unknown" : ext)” can’t be opened. Open a .vteq document, or a .tex, .latex or .txt file containing one equation."
        case .unsupportedSchema(let version):
            return "This document uses format version \(version); this version of Visual Typist reads version \(EquationDocument.schemaVersion)."
        case .missingSchema:
            return "This JSON file is not a Visual Typist document."
        case .malformedDocument:
            return "The document is damaged or missing its LaTeX source."
        case .invalidTextEncoding:
            return "The text must be UTF-8 or UTF-16 and must not contain binary data."
        case .invalidSetting(let message):
            return message
        }
    }
}
