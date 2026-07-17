//
//  VoiceCapabilityTests.swift
//  G1Tests
//
//  Unit tests for VoiceCapableChecking and session-driven voice capability.
//

import Foundation
import Testing
@testable import G1

@MainActor
struct VoiceCapabilityTests {

    // MARK: - Mocks

    private final class MockVoiceCapableChecking: VoiceCapableChecking {
        var stubbedResult = false
        private(set) var lastSessionManager: ChatSessionManager?

        func isVoiceCapable(sessionManager: ChatSessionManager) -> Bool {
            lastSessionManager = sessionManager
            return stubbedResult
        }
    }

    // MARK: - VoiceCapableChecking

    @Test("VoiceCapableChecking returns false when mock stub is false")
    func voiceCapableCheckingFalseStub() async {
        let mock = MockVoiceCapableChecking()
        mock.stubbedResult = false
        let manager = ChatSessionManager()
        #expect(mock.isVoiceCapable(sessionManager: manager) == false)
        #expect(mock.lastSessionManager === manager)
    }

    @Test("VoiceCapableChecking returns true when mock stub is true")
    func voiceCapableCheckingTrueStub() async {
        let mock = MockVoiceCapableChecking()
        mock.stubbedResult = true
        let manager = ChatSessionManager()
        #expect(mock.isVoiceCapable(sessionManager: manager) == true)
    }

    @Test("VoiceCapableChecking defaultVoiceCapable uses VoiceCapability implementation")
    func defaultVoiceCapableUsesDefaultImplementation() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "voice_assistant_agent", businessName: "Voice")

        #expect(VoiceCapableChecking.defaultVoiceCapable(sessionManager: manager) == true)
    }

    // MARK: - VoiceCapability (default struct)

    @Test("VoiceCapability is true for voice_assistant_agent profile")
    func voiceCapabilityTrueForVoiceAssistant() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "voice_assistant_agent", businessName: "Voice")

        #expect(VoiceCapability().isVoiceCapable(sessionManager: manager) == true)
    }

    @Test("VoiceCapability is false for emotional_intelligence_agent profile")
    func voiceCapabilityFalseForEmotionalIntelligence() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "emotional_intelligence_agent", businessName: "EI")

        #expect(VoiceCapability().isVoiceCapable(sessionManager: manager) == false)
    }

    @Test("VoiceCapability is false when no profile selected")
    func voiceCapabilityFalseWhenNoProfile() async {
        let manager = ChatSessionManager()
        #expect(VoiceCapability().isVoiceCapable(sessionManager: manager) == false)
    }

    @Test("VoiceCapability is false for unknown profile id")
    func voiceCapabilityFalseForUnknownProfile() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "unknown_agent", businessName: "Unknown")

        #expect(VoiceCapability().isVoiceCapable(sessionManager: manager) == false)
    }
}
