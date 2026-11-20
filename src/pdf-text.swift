import Foundation
import PDFKit

// Text only: PDF annotations, actions and embedded files are not project instructions.
guard let document = PDFDocument(data: FileHandle.standardInput.readDataToEndOfFile()),
      !document.isLocked else { exit(1) }
for index in 0..<document.pageCount {
    if let text = document.page(at: index)?.string { print(text) }
}
