import { PostHog } from '../../posthog-core';
import { RemoteConfig } from '../../types';
import { LazyLoadedConversationsInterface } from '../../utils/globals';
export type ConversationsManager = LazyLoadedConversationsInterface;
export declare class PostHogConversations {
    private _instance;
    private _isConversationsEnabled?;
    private _conversationsManager;
    private _isInitializing;
    private _remoteConfig;
    constructor(_instance: PostHog);
    onRemoteConfig(response: RemoteConfig): void;
    reset(): void;
    loadIfEnabled(): void;
    /** Helper to finalize conversations initialization */
    private _completeInitialization;
    /** Helper to handle initialization errors */
    private _handleLoadError;
    /**
     * Show the conversations widget (button and chat panel)
     */
    enable(): void;
    /**
     * Hide the conversations widget completely (button and chat panel)
     */
    disable(): void;
    /**
     * Check if conversations are currently loaded and available
     */
    isLoaded(): boolean;
    /**
     * Check if conversations are enabled (based on remote config)
     */
    isEnabled(): boolean;
}
