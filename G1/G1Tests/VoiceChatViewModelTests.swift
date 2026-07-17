//
//  VoiceChatViewModelTests.swift
//  G1Tests
//
//  Unit tests for VoiceChatViewModel: call lifecycle, WebSocket voice stack, and error handling.
//

import Foundation
import Testing
@testable import G1

@MainActor
struct VoiceChatViewModelTests {

    private func makeViewModel(
        sessionManager: ChatSessionManager,
        webSocketService: MockWebSocketService? = nil,
        audioService: MockAudioService? = nil
    ) -> VoiceChatViewModel {
        VoiceChatViewModel(
            sessionManager: sessionManager,
            webSocketService: webSocketService ?? MockWebSocketService(),
            audioService: audioService ?? MockAudioService()
        )
    }

    // MARK: - Initial state

    @Test("Initial state: call inactive, not loading, no error")
    func initialState() async {
        let manager = ChatSessionManager()
        let viewModel = makeViewModel(sessionManager: manager)

        #expect(viewModel.isCallActive == false)
        #expect(viewModel.isLoading == false)
        #expect(viewModel.errorMessage == nil)
    }

    // MARK: - startCall

    @Test("startCall with no profile sets error and does not activate call")
    func startCallNoProfile() async {
        let manager = ChatSessionManager()
        let viewModel = makeViewModel(sessionManager: manager)

        viewModel.startCall()

        #expect(viewModel.isCallActive == false)
        #expect(viewModel.errorMessage == "No profile selected")
    }

    @Test("startCall with voice_assistant_agent profile activates call and connects WebSocket")
    func startCallWithVoiceAssistantProfile() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "voice_assistant_agent", businessName: "Voice")

        let mockWS = MockWebSocketService()
        let mockAudio = MockAudioService()
        let viewModel = makeViewModel(
            sessionManager: manager,
            webSocketService: mockWS,
            audioService: mockAudio
        )

        viewModel.startCall()

        #expect(viewModel.isCallActive == true)
        #expect(viewModel.errorMessage == nil)
        #expect(mockWS.connectCallCount == 1)
        #expect(mockAudio.startRecordingCallCount == 1)
    }

    @Test("startCall when already active is no-op")
    func startCallWhenAlreadyActive() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "voice_assistant_agent", businessName: "Voice")

        let mockWS = MockWebSocketService()
        let viewModel = makeViewModel(sessionManager: manager, webSocketService: mockWS)

        viewModel.startCall()
        #expect(viewModel.isCallActive == true)
        let connectCountAfterFirst = mockWS.connectCallCount

        viewModel.startCall()
        #expect(viewModel.isCallActive == true)
        #expect(mockWS.connectCallCount == connectCountAfterFirst)
    }

    // MARK: - endCall

    @Test("endCall deactivates call and disconnects WebSocket")
    func endCallDeactivatesAndDisconnects() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "voice_assistant_agent", businessName: "Voice")

        let mockWS = MockWebSocketService()
        let mockAudio = MockAudioService()
        let viewModel = makeViewModel(
            sessionManager: manager,
            webSocketService: mockWS,
            audioService: mockAudio
        )

        viewModel.startCall()
        #expect(viewModel.isCallActive == true)

        viewModel.endCall()

        #expect(viewModel.isCallActive == false)
        #expect(mockWS.disconnectCallCount >= 1)
        #expect(mockAudio.stopRecordingCallCount >= 1)
    }

    @Test("endCall when not active is safe no-op")
    func endCallWhenNotActive() async {
        let manager = ChatSessionManager()
        let viewModel = makeViewModel(sessionManager: manager)

        viewModel.endCall()

        #expect(viewModel.isCallActive == false)
    }

    // MARK: - WebSocket errors

    @Test("WebSocket error ends call and sets error message")
    func webSocketErrorEndsCall() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "voice_assistant_agent", businessName: "Voice")

        let mockWS = MockWebSocketService()
        let viewModel = makeViewModel(sessionManager: manager, webSocketService: mockWS)

        viewModel.startCall()
        #expect(viewModel.isCallActive == true)

        mockWS.simulateError(NSError(domain: "test", code: -1, userInfo: [NSLocalizedDescriptionKey: "Connection failed"]))

        #expect(viewModel.isCallActive == false)
        #expect(viewModel.errorMessage != nil)
    }

    // MARK: - Audio chunks

    @Test("Audio chunks are sent via WebSocket when call is active")
    func audioChunksSentWhenCallActive() async {
        let manager = ChatSessionManager()
        manager.selectProfile(profileId: "voice_assistant_agent", businessName: "Voice")

        let mockWS = MockWebSocketService()
        let mockAudio = MockAudioService()
        let viewModel = makeViewModel(
            sessionManager: manager,
            webSocketService: mockWS,
            audioService: mockAudio
        )

        viewModel.startCall()
        let chunk = Data([0x00, 0x01, 0x02])
        mockAudio.simulateAudioChunk(chunk)

        #expect(mockWS.sentAudioChunks.count >= 1)
        #expect(mockWS.sentAudioChunks.last == chunk)
    }
}
