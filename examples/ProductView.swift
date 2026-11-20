import SwiftUI

struct ProductView: View {
    @StateObject private var model = ProductModel()
    private let ink = Color(red: 0.09, green: 0.24, blue: 0.20)
    private let paper = Color(red: 0.97, green: 0.96, blue: 0.92)
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Rectangle().fill(ink).frame(height: 4)
                HStack { Text("EVE  /  工作手记"); Spacer(); Text("NO. 01") }
                    .font(.caption.monospaced().weight(.semibold))
                Text("专注轮次").font(.largeTitle.bold())
                Image("BrandArtwork").resizable().aspectRatio(contentMode: .fill).frame(height: 110).clipped().clipShape(RoundedRectangle(cornerRadius: 12)).accessibilityHidden(true)
                Text("每完成一段专注工作，记下一轮。").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 14) {
                    Text("已完成  /  ROUNDS").font(.caption.monospaced())
                    Text("\(model.rounds)").font(.system(size: 80, weight: .semibold, design: .rounded)).monospacedDigit().accessibilityIdentifier("count")
                    Divider().overlay(.white.opacity(0.5))
                    Text("按自己的节奏积累。").font(.callout)
                }.padding(24).frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(.white).background(ink, in: RoundedRectangle(cornerRadius: 16))
                Button { model.record() } label: { Label("完成一轮", systemImage: "plus.circle.fill").foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 8) }.buttonStyle(.borderedProminent).tint(ink).accessibilityIdentifier("add")
                Button { model.undo() } label: { Label("撤销一轮", systemImage: "arrow.uturn.backward").frame(maxWidth: .infinity) }.tint(ink).disabled(model.rounds == 0).accessibilityIdentifier("undo")
                Text("记录自动保存在这台 iPhone 上。").font(.footnote).foregroundStyle(.secondary)
            }.padding(24)
        }.foregroundStyle(ink).background(paper).preferredColorScheme(.light)
    }
}
