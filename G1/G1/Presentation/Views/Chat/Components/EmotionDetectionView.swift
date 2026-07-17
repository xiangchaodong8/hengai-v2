//
//  EmotionDetectionView.swift
//  G1
//
//  Compact emotion status indicator shown beside the message composer when the active profile supports affect metadata.
//

import SwiftUI

struct EmotionDetectionView: View {
    @EnvironmentObject private var sessionManager: ChatSessionManager

    /// Only shown for `emotional_intelligence_agent`.
    private var isEmotionCapableModel: Bool {
        guard let profileId = sessionManager.currentBusinessProfile?.profileId else { return false }
        return profileId.isEmotionCapableModel
    }

    private var emotionText: String {
        sessionManager.emotionDetector.currentPrimaryText
    }

    private var confidenceText: String {
        guard let value = sessionManager.emotionDetector.latest?.confidence else { return "—" }
        return String(format: "%.0f%%", value * 100)
    }

    var body: some View {
        if isEmotionCapableModel {
            HStack(spacing: 6) {
                Text(emotionText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)

                Text(confidenceText)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Detected emotion")
            .accessibilityValue("\(emotionText), confidence \(confidenceText)")
        }
    }
}
