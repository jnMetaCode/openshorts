import AVFoundation
import Foundation

guard CommandLine.arguments.count >= 3 else {
    FileHandle.standardError.write(Data("用法：swift scripts/macos-tts.swift <文字> <输出.wav> [语速]\n".utf8))
    exit(2)
}

let text = CommandLine.arguments[1]
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let rate = Float(CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "0.48") ?? 0.48
let synthesizer = AVSpeechSynthesizer()
let utterance = AVSpeechUtterance(string: text)
utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
utterance.rate = rate
utterance.pitchMultiplier = 0.92
var audioFile: AVAudioFile?
var writeError: Error?
var finished = false

synthesizer.write(utterance) { buffer in
    guard let pcm = buffer as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 { finished = true; return }
    do {
        if audioFile == nil {
            audioFile = try AVAudioFile(forWriting: output, settings: pcm.format.settings)
        }
        try audioFile?.write(from: pcm)
    } catch {
        writeError = error
        finished = true
    }
}

let deadline = Date().addingTimeInterval(30)
while !finished && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
}
if let error = writeError { throw error }
audioFile = nil
guard finished, FileManager.default.fileExists(atPath: output.path) else {
    throw NSError(domain: "OpenShortsTTS", code: 1, userInfo: [NSLocalizedDescriptionKey: "语音合成未生成文件"])
}
