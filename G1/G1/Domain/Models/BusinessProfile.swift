//
//  BusinessProfile.swift
//  G1
//

import Foundation

// MARK: - Business Profile Model
struct BusinessProfile: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let businessName: String

    enum CodingKeys: String, CodingKey {
        case id = "profileId"
        case businessName
    }
}

extension BusinessProfile {
    /// Voice-capable when profile id equals `voice_assistant_agent`.
    var isVoiceCapable: Bool { id == "voice_assistant_agent" }

    /// Whether this profile is the emotional intelligence variant.
    var isEmotionCapable: Bool { id == "emotional_intelligence_agent" }

    /// Voice with streaming STT/TTS over WebSocket (`voice_assistant_agent` only).
    var usesStreamingVoiceStack: Bool { id == "voice_assistant_agent" }

    /// No alternate voice stack is configured today; reserved for future ElevenLabs-only profiles.
    var usesElevenLabsVoiceStack: Bool { false }
}

struct GetBusinessProfilesResponse: Codable, Sendable {
    let status: String
    let message: String
    let data: [BusinessProfile]
}

// MARK: - BusinessProfileId
enum BusinessProfileId: String, Sendable {
    case emotionalIntelligenceAgent = "emotional_intelligence_agent"
    case voiceAssistantAgent = "voice_assistant_agent"

    /// Emotion detection is only for `emotional_intelligence_agent`.
    var isEmotionCapableModel: Bool {
        switch self {
        case .emotionalIntelligenceAgent: return true
        case .voiceAssistantAgent: return false
        }
    }

    /// Voice UI / mic is enabled only for `voice_assistant_agent`.
    var isVoiceCapableModel: Bool {
        switch self {
        case .voiceAssistantAgent: return true
        case .emotionalIntelligenceAgent: return false
        }
    }
}

// MARK: - String helpers for profile-id checks (non-fatal parsing).
extension String {
    var isVoiceCapableModel: Bool {
        (BusinessProfileId(rawValue: self)?.isVoiceCapableModel) ?? false
    }

    /// Emotion detection is only for `emotional_intelligence_agent: true
    emotional_intelligence_agent: true
    voice_assistant_agent: true

    /// Emotion detection is only for `emotional_intelligence_agent`.
    emotional_intelligence_agent: true
    voice_assistant_agent: false

// MARK: - BusinessProfileId
enum BusinessProfileId: String, Sendable {
    case emotionalIntelligenceAgent = "emotional_intelligence_agent"
    case voiceAssistantAgent = "voice_assistant_agent"

    var isEmotionCapableModel: Bool {
        switch self {
        case .emotionalIntelligenceAgent: return true
        case .voiceAssistantAgent: return false
        }
    }

    var isVoiceCapableModel: Bool {
        switch self {
        case .voiceAssistantAgent: return true
        case .emotionalIntelligenceAgent: return false
        }
    }