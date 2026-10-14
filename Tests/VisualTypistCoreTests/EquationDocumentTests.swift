import Foundation
import Testing
@testable import VisualTypistCore

struct EquationDocumentTests {
    @Test func roundTripPreservesEverySetting() throws {
        let document = EquationDocument(
            latex: "  \\begin{aligned}\nE &= mc^2 \\\\\np &= mv\n\\end{aligned}  ",
            fontSize: 47.5, colorHex: "#A1B2C3", displayStyle: false, transparentBackground: false)
        let data = try document.jsonData()
        #expect(try EquationDocument.read(data: data, fileExtension: ".VTEQ") == document)
        #expect(String(decoding: data, as: UTF8.self).contains(#""schemaVersion" : 1"#))
    }

    @Test func optionalSettingsUseDefaults() throws {
        let json = #"{"schemaVersion":1,"latex":"a+b"}"#
        #expect(try EquationDocument.read(data: Data(json.utf8), fileExtension: "vteq") == EquationDocument(latex: "a+b"))
    }

    @Test func unknownSchemaIsRejected() {
        expectError(.unsupportedSchema(73)) {
            try EquationDocument.read(data: Data(#"{"schemaVersion":73}"#.utf8), fileExtension: "vteq")
        }
    }

    @Test func jsonWithoutSchemaIsRejected() {
        expectError(.missingSchema) {
            try EquationDocument.read(data: Data(#"{"latex":"x"}"#.utf8), fileExtension: "json")
        }
    }

    @Test func malformedDocumentsAreRejected() {
        for json in ["{broken}", #"{"schemaVersion":1}"#, #"{"schemaVersion":1,"latex":9}"#] {
            expectError(.malformedDocument) {
                try EquationDocument.read(data: Data(json.utf8), fileExtension: "vteq")
            }
        }
    }

    @Test func unknownExtensionsAreRejected() {
        for ext in ["bin", "docx", ""] {
            expectError(.unsupportedFormat(ext)) {
                try EquationDocument.read(data: Data("x^2".utf8), fileExtension: ext)
            }
        }
    }

    @Test func invalidSettingsAreRejected() throws {
        for document in [EquationDocument(fontSize: 11), EquationDocument(fontSize: 97), EquationDocument(fontSize: .nan),
                         EquationDocument(colorHex: "red"), EquationDocument(colorHex: "#123"),
                         EquationDocument(colorHex: "#12345G")] {
            #expect(throws: DocumentError.self) { try document.validate() }
            #expect(throws: DocumentError.self) { try document.jsonData() }
        }
        try EquationDocument(fontSize: 12).validate()
        try EquationDocument(fontSize: 96, colorHex: "#abcdef").validate()
    }

    @Test func standaloneTeXContainsEquationAndSettings() {
        let document = EquationDocument(latex: #"\frac{a}{b}"#, fontSize: 45.5, colorHex: "#c0ffee", displayStyle: false)
        let tex = document.standaloneTeX()
        #expect(tex.contains(#"\documentclass[preview,border=2pt]{standalone}"#))
        #expect(tex.contains(#"\definecolor{ink}{HTML}{C0FFEE}"#))
        #expect(tex.contains(#"\fontsize{45.5}{54.6}\selectfont"#))
        #expect(tex.contains(#"\textstyle"#))
        #expect(tex.contains(document.latex))
        #expect(EquationDocument(latex: "x").standaloneTeX().contains(#"\displaystyle"#))
    }

    @Test func linesKeepMultiLineEnvironmentsTogether() {
        let document = EquationDocument(latex: "a+b\n\\begin{aligned}x&=1\\\\\ny&=2\\end{aligned}\n\\frac{1}{\n2}\n")
        #expect(document.lines == ["a+b", "\\begin{aligned}x&=1\\\\\ny&=2\\end{aligned}", "\\frac{1}{\n2}", ""])
        #expect(EquationDocument(latex: "").lines == [""])
        #expect(EquationDocument(latex: #"\{x\}"#).lines == [#"\{x\}"#])
    }

    @Test func multiLineDocumentsExportAsALeftAlignedArray() {
        let tex = EquationDocument(latex: "x=1\ny=2").standaloneTeX()
        #expect(tex.contains("\\begin{array}{l}\n\\displaystyle x=1 \\\\\n\\displaystyle y=2\n\\end{array}"))
        #expect(!EquationDocument(latex: "x=1").standaloneTeX().contains("array"))
        #expect(EquationDocument(latex: "a\\ \nb  ").standaloneTeX().contains("\\displaystyle a\\  \\\\\n\\displaystyle b\n"))
    }

    @Test func standaloneTeXReimportsAsTheSameEquation() throws {
        let document = EquationDocument(latex: #"\frac{x^2+1}{\sqrt{y}}"#)
        #expect(try imported(document.standaloneTeX()) == document.latex)
    }

    private func imported(_ source: String) throws -> String {
        try EquationDocument.read(data: Data(source.utf8), fileExtension: "tex").latex
    }

    private func expectError<T>(_ expected: DocumentError, _ action: () throws -> T) {
        do {
            _ = try action()
            Issue.record("Expected \(expected), but the operation succeeded.")
        } catch {
            #expect(error as? DocumentError == expected)
        }
    }
}

struct TeXImportTests {
    @Test func utf8KeepsUnicodeAndLineBreaks() throws {
        #expect(try imported("  \\text{能量} + \\alpha\n+ x  ") == "\\text{能量} + \\alpha\n+ x")
        let bom = Data([0xEF, 0xBB, 0xBF]) + Data("$x$".utf8)
        #expect(try EquationDocument.read(data: bom, fileExtension: "txt").latex == "x")
    }

    @Test func utf16WithAndWithoutByteOrderMark() throws {
        let source = #"\[\text{能量} = mc^2\]"#
        let little = try #require(source.data(using: .utf16LittleEndian))
        let big = try #require(source.data(using: .utf16BigEndian))
        let expected = #"\text{能量} = mc^2"#
        for data in [Data([0xFF, 0xFE]) + little, Data([0xFE, 0xFF]) + big, little, big] {
            #expect(try EquationDocument.read(data: data, fileExtension: "tex").latex == expected)
        }
    }

    @Test func binaryDataIsRejected() {
        for data in [Data([0, 1, 2, 3, 0, 0]), Data([0xFF, 0xFE, 0x61]), Data([0xFF, 0x00, 0x01])] {
            #expect(throws: DocumentError.invalidTextEncoding) {
                try EquationDocument.read(data: data, fileExtension: "txt")
            }
        }
    }

    @Test func singleDelimitersAreRemoved() throws {
        for source in ["$x^2$", "$$x^2$$", #"\(x^2\)"#, #"\[x^2\]"#, " \n$$\n x^2 \n$$ \n"] {
            #expect(try imported(source) == "x^2")
        }
    }

    @Test func multipleOrMalformedDelimitersAreKept() throws {
        for source in ["$x$ + $y$", "$$x$$ + $$y$$", #"\(x\) + \(y\)"#, #"\[x\] \[y\]"#, "$x", "x$", "$$x$", "$$x $ y$$"] {
            #expect(try imported(source) == source)
        }
    }

    @Test func escapedDollarDoesNotCloseMath() throws {
        let expression = #"\text{price: \$5} + x"#
        #expect(try imported("$" + expression + "$") == expression)
        #expect(try imported(#"\$x\$"#) == #"\$x\$"#)
    }

    @Test func equationEnvironmentsAreUnwrapped() throws {
        for environment in ["equation", "equation*", "displaymath"] {
            #expect(try imported("\\begin{\(environment)}\n\\frac{a}{b}\n\\end{\(environment)}") == #"\frac{a}{b}"#)
        }
        let multiple = #"\begin{equation}x\end{equation}\begin{equation}y\end{equation}"#
        #expect(try imported(multiple) == multiple)
        #expect(try imported(#"\begin{equation}x"#) == #"\begin{equation}x"#)
    }

    @Test func fullDocumentsYieldTheirEquation() throws {
        let source = #"\documentclass{article}\usepackage{amsmath}\begin{document}\begin{equation}E=mc^2\end{equation}\end{document}"#
        #expect(try imported(source) == "E=mc^2")
        let body = #"a+b \quad c+d"#
        #expect(try imported(#"\documentclass{article}\begin{document}"# + body + #"\end{document}"#) == body)
        let twoBlocks = #"\(x\) + \(y\)"#
        #expect(try imported(#"\documentclass{article}\begin{document}"# + twoBlocks + #"\end{document}"#) == twoBlocks)
    }

    @Test func commentsAreIgnored() throws {
        let latex = "x % ignored $\n+ y"
        #expect(try imported("$" + latex + "$") == latex)
        #expect(try imported("\\begin{document}\n% ignored \\(z\\)\n\\[x+y\\]\n\\end{document}") == "x+y")
    }

    private func imported(_ source: String) throws -> String {
        try EquationDocument.read(data: Data(source.utf8), fileExtension: "tex").latex
    }
}

struct KeyComboTests {
    @Test func parsesAndNormalizesSpellings() {
        #expect(KeyCombo("Option+K")?.description == "alt+k")
        #expect(KeyCombo("shift+ctrl+P")?.description == "ctrl+shift+p")
        #expect(KeyCombo("ctrl+'")?.description == "ctrl+'")
        #expect(KeyCombo("ctrl+Tab")?.description == "ctrl+tab")
        #expect(KeyCombo("cmd+alt+Return")?.description == "alt+cmd+enter")
    }

    @Test func rejectsInvalidCombos() {
        for text in ["", "ctrl+", "hyper+k", "ctrl+f13", "k+ctrl"] {
            #expect(KeyCombo(text) == nil)
        }
    }

    @Test func mapsPhysicalKeyCodes() {
        #expect(KeyCombo.keyName(forKeyCode: 40) == "k")
        #expect(KeyCombo.keyName(forKeyCode: 25) == "9")
        #expect(KeyCombo.keyName(forKeyCode: 39) == "'")
        #expect(KeyCombo.keyName(forKeyCode: 48) == "tab")
        #expect(KeyCombo.keyName(forKeyCode: 126) == "up")
        #expect(KeyCombo.keyName(forKeyCode: 200) == nil)
    }

    @Test func displaysMacSymbols() {
        #expect(KeyCombo("alt+shift+p")?.displayString == "⌥⇧P")
        #expect(KeyCombo("ctrl+alt+up")?.displayString == "⌃⌥↑")
    }
}
