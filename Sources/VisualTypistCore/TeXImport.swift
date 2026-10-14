import Foundation

/// Extracts a single equation from LaTeX source text.
enum TeXImport {
    static func decodeText(_ data: Data) throws -> String {
        let bytes = [UInt8](data)
        let text: String?
        if bytes.starts(with: [0xFF, 0xFE]) {
            guard bytes.count.isMultiple(of: 2) else { throw DocumentError.invalidTextEncoding }
            text = String(data: data.dropFirst(2), encoding: .utf16LittleEndian)
        } else if bytes.starts(with: [0xFE, 0xFF]) {
            guard bytes.count.isMultiple(of: 2) else { throw DocumentError.invalidTextEncoding }
            text = String(data: data.dropFirst(2), encoding: .utf16BigEndian)
        } else if bytes.contains(0), bytes.count.isMultiple(of: 2) {
            // UTF-16 without a byte-order mark: ASCII text leaves every other byte zero.
            let evenZeros = stride(from: 0, to: bytes.count, by: 2).filter { bytes[$0] == 0 }.count
            let oddZeros = stride(from: 1, to: bytes.count, by: 2).filter { bytes[$0] == 0 }.count
            if oddZeros > bytes.count / 8, oddZeros > evenZeros {
                text = String(data: data, encoding: .utf16LittleEndian)
            } else if evenZeros > bytes.count / 8, evenZeros > oddZeros {
                text = String(data: data, encoding: .utf16BigEndian)
            } else {
                text = nil
            }
        } else {
            text = String(data: data, encoding: .utf8)
        }
        guard let text,
              !text.unicodeScalars.contains(where: { $0.value < 32 && ![9, 10, 13].contains($0.value) }) else {
            throw DocumentError.invalidTextEncoding
        }
        return text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
    }

    static func equation(from text: String) -> String {
        var source = trim(text)
        if let body = unwrapEnvironment(source, named: "document", allowPreamble: true) {
            source = trim(body)
            if let equation = singleMathBlock(in: source) { return trim(equation) }
        }
        for name in ["equation", "equation*", "displaymath"] {
            if let inner = unwrapEnvironment(source, named: name) {
                return stripOuterDelimiters(trim(inner))
            }
        }
        return stripOuterDelimiters(source)
    }

    private static func trim(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Returns the contents of the only math block in a document body, or nil if there are zero or several.
    private static func singleMathBlock(in source: String) -> String? {
        let wrappers = [
            (#"\begin{equation}"#, #"\end{equation}"#),
            (#"\begin{equation*}"#, #"\end{equation*}"#),
            (#"\begin{displaymath}"#, #"\end{displaymath}"#),
            (#"\["#, #"\]"#), (#"\("#, #"\)"#), ("$$", "$$"), ("$", "$"),
        ]
        var cursor = source.startIndex
        var result: String?
        while cursor < source.endIndex {
            let candidates = wrappers.compactMap { opening, closing -> (String, String, Range<String.Index>)? in
                guard let range = firstUnescapedRange(of: opening, in: source, from: cursor) else { return nil }
                return (opening, closing, range)
            }
            guard let candidate = candidates.min(by: {
                $0.2.lowerBound == $1.2.lowerBound ? $0.0.count > $1.0.count : $0.2.lowerBound < $1.2.lowerBound
            }) else { break }
            guard result == nil,
                  let closing = firstUnescapedRange(of: candidate.1, in: source, from: candidate.2.upperBound) else { return nil }
            let inner = String(source[candidate.2.upperBound..<closing.lowerBound])
            if candidate.0 == "$$", firstUnescapedRange(of: "$", in: inner, from: inner.startIndex) != nil { return nil }
            if candidate.0 != candidate.1,
               firstUnescapedRange(of: candidate.0, in: inner, from: inner.startIndex) != nil { return nil }
            result = inner
            cursor = closing.upperBound
        }
        return result
    }

    /// Strips `$…$`, `$$…$$`, `\[…\]` or `\(…\)` only when the wrapper encloses the whole input.
    private static func stripOuterDelimiters(_ source: String) -> String {
        for (opening, closing) in [("$$", "$$"), ("$", "$"), (#"\["#, #"\]"#), (#"\("#, #"\)"#)] {
            guard source.hasPrefix(opening), source.hasSuffix(closing),
                  source.count >= opening.count + closing.count else { continue }
            let bodyStart = source.index(source.startIndex, offsetBy: opening.count)
            let closingStart = source.index(source.endIndex, offsetBy: -closing.count)
            guard let firstClosing = firstUnescapedRange(of: closing, in: source, from: bodyStart),
                  firstClosing.lowerBound == closingStart else { continue }
            let inner = String(source[bodyStart..<closingStart])
            if opening == "$$", firstUnescapedRange(of: "$", in: inner, from: inner.startIndex) != nil { continue }
            return trim(inner)
        }
        return source
    }

    private static func unwrapEnvironment(_ source: String, named name: String, allowPreamble: Bool = false) -> String? {
        let opening = "\\begin{\(name)}"
        let closing = "\\end{\(name)}"
        guard let openingRange = firstUnescapedRange(of: opening, in: source, from: source.startIndex),
              allowPreamble || openingRange.lowerBound == source.startIndex,
              let closingRange = firstUnescapedRange(of: closing, in: source, from: openingRange.upperBound),
              trim(String(source[closingRange.upperBound...])).isEmpty else { return nil }
        let body = String(source[openingRange.upperBound..<closingRange.lowerBound])
        guard firstUnescapedRange(of: opening, in: body, from: body.startIndex) == nil else { return nil }
        return body
    }

    private static func firstUnescapedRange(of token: String, in source: String, from start: String.Index) -> Range<String.Index>? {
        var cursor = start
        while cursor < source.endIndex, let range = source.range(of: token, range: cursor..<source.endIndex) {
            if precedingBackslashes(before: range.lowerBound, in: source, limit: source.startIndex).isMultiple(of: 2),
               !isCommented(range.lowerBound, in: source) {
                return range
            }
            cursor = range.upperBound
        }
        return nil
    }

    private static func isCommented(_ position: String.Index, in source: String) -> Bool {
        let lineStart = source.range(of: "\n", options: .backwards, range: source.startIndex..<position)?.upperBound
            ?? source.startIndex
        var cursor = lineStart
        while let percent = source.range(of: "%", range: cursor..<position) {
            if precedingBackslashes(before: percent.lowerBound, in: source, limit: lineStart).isMultiple(of: 2) {
                return true
            }
            cursor = percent.upperBound
        }
        return false
    }

    private static func precedingBackslashes(before position: String.Index, in source: String, limit: String.Index) -> Int {
        var count = 0
        var index = position
        while index > limit {
            let previous = source.index(before: index)
            guard source[previous] == "\\" else { break }
            count += 1
            index = previous
        }
        return count
    }
}
