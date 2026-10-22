import Foundation

/// How the lines of a document stand: at the left, or at their first relation (AxMath's Align At
/// Equal Symbols; see `EquationDocument.alignmentIndex`).
public enum LineAlignment: String, Codable, Sendable {
    case left, equals
}

/// An equation document as saved to disk (`.vteq`, JSON).
public struct EquationDocument: Codable, Equatable, Sendable {
    public static let schemaVersion = 1
    public static let fileExtension = "vteq"
    public static let fontSizes: ClosedRange<Double> = 12...96

    public var latex: String
    public var fontSize: Double
    public var colorHex: String
    public var displayStyle: Bool
    public var alignment: LineAlignment
    public var transparentBackground: Bool

    public init(
        latex: String = "",
        fontSize: Double = 32,
        colorHex: String = "#17191D",
        displayStyle: Bool = true,
        alignment: LineAlignment = .left,
        transparentBackground: Bool = true
    ) {
        self.latex = latex
        self.fontSize = fontSize
        self.colorHex = colorHex
        self.displayStyle = displayStyle
        self.alignment = alignment
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
        case schemaVersion, latex, fontSize, colorHex, displayStyle, alignment, transparentBackground
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
        // An alignment this version doesn't know reads as the default.
        alignment = (try? container.decodeIfPresent(LineAlignment.self, forKey: .alignment)) ?? defaults.alignment
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
        try container.encode(alignment, forKey: .alignment)
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
        // Several lines become a left-aligned array, one equation per row, or an array aligned at
        // each line's first relation (see alignmentIndex). Blank lines between equations stay (one
        // line high); blank lines around them go.
        var rows = lines.map(Self.trimmed)
        while rows.first?.isEmpty == true { rows.removeFirst() }
        while rows.last?.isEmpty == true { rows.removeLast() }
        let rowStyle = displayStyle ? #"\displaystyle "# : ""
        let splits = rows.map(Self.alignmentIndex)
        let body: String
        if rows.count <= 1 {
            body = latex
        } else if alignment == .equals, splits.contains(where: { $0 != nil }) {
            // The empty relation keeps TeX's space between the left side and the relation that
            // starts the right one.
            body = "\\begin{array}{r@{}l}\n" + zip(rows, splits).map { row, split in
                guard !row.isEmpty else { return #"&\strut"# }
                let at = split ?? row.startIndex
                let left = row[..<at].trimmingCharacters(in: .whitespaces)
                return (left.isEmpty ? "" : rowStyle + left + #"\mathrel{}"#) + "&" + rowStyle + row[at...]
            }.joined(separator: " \\\\\n") + "\n\\end{array}"
        } else {
            body = "\\begin{array}{l}\n" + rows.map { $0.isEmpty ? #"\strut"# : rowStyle + $0 }.joined(separator: " \\\\\n") + "\n\\end{array}"
        }
        return """
        \\documentclass[preview,border=2pt]{standalone}
        \\usepackage{amsmath,amssymb,xcolor}
        \\usepackage{fix-cm}
        \\providecommand{\\placeholder}[1]{\\square}
        \\providecommand{\\vtraw}[1]{\\mathrm{#1}}
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
        var brokenAtEnd = false // The previous line ended with \\ (the older style).
        for raw in latex.components(separatedBy: "\n") {
            // Lines are separated by \\ on a line of its own (as classic editors write it) or, in
            // older documents, by \\ at the end of a line.
            if current == nil, raw.trimmingCharacters(in: .whitespaces) == #"\\"#, !result.isEmpty, !brokenAtEnd {
                brokenAtEnd = true
                continue
            }
            current = current.map { $0 + "\n" + raw } ?? raw
            // Escaped braces and an escaped \% (text, not a comment) don't count.
            var code = raw.replacingOccurrences(of: #"\\"#, with: "")
                .replacingOccurrences(of: #"\{"#, with: "").replacingOccurrences(of: #"\}"#, with: "")
                .replacingOccurrences(of: #"\%"#, with: "")
            if let comment = code.firstIndex(of: "%") { code = String(code[..<comment]) }
            depth += code.filter { $0 == "{" }.count - code.filter { $0 == "}" }.count
            depth += code.components(separatedBy: #"\begin{"#).count - code.components(separatedBy: #"\end{"#).count
            if depth <= 0 {
                brokenAtEnd = (current ?? "").range(of: #"\\\\\s*$"#, options: .regularExpression) != nil
                result.append(Self.withoutLineBreak(current ?? ""))
                current = nil
                depth = 0
            }
        }
        if let current { result.append(Self.withoutLineBreak(current)) }
        return result.isEmpty ? [""] : result
    }

    /// Relations a line is aligned at, as in AxMath's Align At Equal Symbols: =, <, ≤, ≈, ≡, ≺ and
    /// their kin (not ∈, ⊂, ∝, →, ⊥ or negated relations, except ≠). The page uses the same list.
    static let alignmentRelations = Set([
        "=", "<", ">", #"\lt"#, #"\gt"#, #"\ne"#, #"\neq"#, #"\le"#, #"\leq"#, #"\ge"#, #"\geq"#,
        #"\leqslant"#, #"\geqslant"#, #"\leqq"#, #"\geqq"#, #"\ll"#, #"\gg"#, #"\approx"#, #"\thickapprox"#,
        #"\approxeq"#, #"\equiv"#, #"\sim"#, #"\thicksim"#, #"\backsim"#, #"\backsimeq"#, #"\simeq"#, #"\cong"#,
        #"\doteq"#, #"\doteqdot"#, #"\Doteq"#, #"\risingdotseq"#, #"\fallingdotseq"#, #"\eqcirc"#, #"\circeq"#,
        #"\triangleq"#, #"\prec"#, #"\succ"#, #"\preceq"#, #"\succeq"#, #"\preccurlyeq"#, #"\succcurlyeq"#,
        #"\curlyeqprec"#, #"\curlyeqsucc"#, #"\precsim"#, #"\succsim"#, #"\precapprox"#, #"\succapprox"#,
        #"\lesssim"#, #"\gtrsim"#, #"\lessapprox"#, #"\gtrapprox"#, #"\lessgtr"#, #"\gtrless"#, #"\lesseqgtr"#,
        #"\gtreqless"#, #"\lesseqqgtr"#, #"\gtreqqless"#, #"\lessdot"#, #"\gtrdot"#, #"\eqslantless"#, #"\eqslantgtr"#,
    ]).union("≠≤≥⩽⩾≦≧≪≫≈≊≡∼∽⋍≃≅≐≑≓≒≖≗≜≺≻⪯⪰≼≽⋞⋟≾≿⪷⪸≲≳⪅⪆≶≷⋚⋛⪋⪌⋖⋗⪕⪖".map(String.init))

    /// Where the line's first relation at its top level starts: beside a plain bracket, but not in
    /// braces (fractions, scripts, \text…), \left…\right or an environment. `\not=` counts as ≠.
    static func alignmentIndex(_ line: String) -> String.Index? {
        var depth = 0, nested = 0, skip = false
        var previous: (token: String, index: String.Index)?
        var index = line.startIndex
        while index < line.endIndex {
            let start = index
            var end = line.index(after: index)
            if line[start] == "\\", end < line.endIndex {
                if line[end].isASCII, line[end].isLetter {
                    while end < line.endIndex, line[end].isASCII, line[end].isLetter { end = line.index(after: end) }
                } else {
                    end = line.index(after: end)
                }
            }
            index = end
            let token = String(line[start..<end])
            if token.allSatisfy(\.isWhitespace) { continue }
            if token == "{" {
                if depth == 0 { skip = false } // The group is what the delimiter or script takes.
                depth += 1
            } else if token == "}" {
                depth -= 1
            } else if depth == 0, skip {
                skip = false
            } else if depth == 0 {
                if token == #"\left"# || token == #"\begin"# { nested += 1 }
                if token == #"\right"# || token == #"\end"# { nested -= 1 }
                if token.range(of: #"^(\\(left|right|middle|[bB]igg?[lmr]?)|[_^])$"#, options: .regularExpression) != nil {
                    skip = true // A delimiter or script follows.
                } else if nested == 0 {
                    let negated = previous?.token == #"\not"#
                    if negated ? token == "=" : alignmentRelations.contains(token) {
                        return negated ? previous?.index : start
                    }
                }
            }
            previous = (token, start)
        }
        return nil
    }

    /// Lines are separated by `\\` at the end of the line; the separator is not part of the line.
    private static func withoutLineBreak(_ line: String) -> String {
        line.replacingOccurrences(of: #"\s*\\\\\s*$"#, with: "", options: .regularExpression)
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
