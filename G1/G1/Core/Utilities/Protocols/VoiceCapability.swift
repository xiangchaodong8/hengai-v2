import Foundation

/// Protocol for determining voice chat capability on a business profile.
/// Allows injection and overrides in tests.
protocol VoiceCapableChecking {
    func isVoiceCapable(sessionManager: ChatSessionManager) -> Bool
}

/// Default implementation: capability is driven by the selected profile id in `ChatSessionManager`.
struct VoiceCapability: VoiceCapableChecking {
    func isVoiceCapable(sessionManager: ChatSessionManager) -> Bool {
        if let profileId = sessionManager.currentBusinessProfile?.profileId {
            return profileId.isVoiceCapableModel
        }
        return false
    }
}

extension VoiceCapableChecking {
    /// Convenience entry point for call sites using a default checker.
    static func defaultVoiceCapable(sessionManager: ChatSessionManager) -> Bool {
        VoiceCapability().isVoiceCapable(sessionManager: sessionManager)
    }
}
