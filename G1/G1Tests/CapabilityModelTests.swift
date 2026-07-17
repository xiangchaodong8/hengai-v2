//
//  CapabilityModelTests.swift
//  G1Tests
//
//  Unit tests for profile capability flags tied to BusinessProfileId and String helpers.
//

import Testing
@testable import G1

struct CapabilityModelTests {

    // MARK: - BusinessProfileId

    @Test("emotional_intelligence_agent is emotion-capable")
    func emotionalIntelligenceAgentIsEmotionCapable() {
        #expect(BusinessProfileId.emotionalIntelligenceAgent.isEmotionCapableModel == true)
    }

    @Test("voice_assistant_agent is not emotion-capable")
    func voiceAssistantAgentIsNotEmotionCapable() {
        #expect(BusinessProfileId.voiceAssistantAgent.isEmotionCapableModel == false)
    }

    @Test("Only voice_assistant_agent is voice-capable")
    func voiceCapabilityByProfileId() {
        #expect(BusinessProfileId.voiceAssistantAgent.isVoiceCapableModel == true)
        #expect(BusinessProfileId.emotionalIntelligenceAgent.isVoiceCapableModel == false)
    }

    // MARK: - String helpers (unknown / legacy ids)

    @Test("Unknown profile id: voice and emotion helpers are false")
    func unknownProfileIdCapabilitiesAreFalse() {
        let unknown = "some_legacy_profile"
        #expect(unknown.isVoiceCapableModel == false)
        #expect(unknown.isEmotionCapableModel == false)
    }

    @Test("String helper resolves emotional_intelligence_agent")
    func stringHelperEmotionalIntelligence() {
        #expect("emotional_intelligence_agent".isEmotionCapableModel == true)
        #expect("emotional_intelligence_agent".isVoiceCapableModel == false)
    }

    @Test("String helper resolves voice_assistant_agent")
    func stringHelperVoiceAssistant() {
        #expect("voice_assistant_agent".isVoiceCapableModel == true)
        #expect("voice_assistant_agent".isEmotionCapableModel == false)
    }

    // MARK: - BusinessProfile convenience

    @Test("BusinessProfile streaming vs ElevenLabs voice stacks")
    func businessProfileVoiceStackFlags() {
        let voice = BusinessProfile(id: "voice_assistant_agent", businessName: "Voice")
        #expect(voice.isVoiceCapable == true)
        #expect(voice.usesStreamingVoiceStack == true)
        #expect(voice.usesElevenLabsVoiceStack == false)
        #expect(voice.isEmotionCapable == false)

        let emotional = BusinessProfile(id: "emotional_intelligence_agent", businessName: "EI")
        #expect(emotional.isVoiceCapable == false)
        #expect(emotional.usesStreamingVoiceStack == false)
        #expect(emotional.isEmotionCapable == true)
    }
}
